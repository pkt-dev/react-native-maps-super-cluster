'use-strict'

// base libs
import PropTypes from 'prop-types'
import React, { PureComponent } from 'react'
import {
  Platform,
  Dimensions,
  LayoutAnimation
} from 'react-native'
// map-related libs
import MapView from 'react-native-maps'
import SuperCluster from 'supercluster'
import GeoViewport from '@mapbox/geo-viewport'
// components / views
import ClusterMarker from './ClusterMarker'
// libs / utils
import {
  regionToBoundingBox,
  itemToGeoJSONFeature,
  getCoordinatesFromItem,
} from './util'

export default class ClusteredMapView extends PureComponent {

  constructor(props) {
    super(props)

    this.state = {
      data: [],
      clusterData: [], // helds renderable clusters and markers
      region: props.region || props.initialRegion, // helds current map region
    }

    this.isAndroid = Platform.OS === 'android'
    this.dimensions = [props.width, props.height]

    this.mapRef = this.mapRef.bind(this)
    this.onClusterPress = this.onClusterPress.bind(this)
    this.onRegionChangeComplete = this.onRegionChangeComplete.bind(this)

    this.clusterIdMap = new Map();
    this.currentDateString = new Date().toISOString();
  }

  static getDerivedStateFromProps(nextProps, prevState){
    if(nextProps.data !== prevState.data){
      return { data: nextProps.data };
   }
   else return null;
 }
 
 componentDidUpdate(prevProps, prevState) {
   if(prevProps.data !== this.props.data){
     this.clusterize(this.props.data)
   }
 }

  componentDidMount() {
    this.clusterize(this.props.data)
  }

  mapRef(ref) {
    this.mapview = ref
  }

  getMapRef() {
    return this.mapview
  }

  getClusteringEngine() {
    return this.superCluster
  }

  getClusterKey(clusterId, dateString) {
      return `cluster-${clusterId}-${dateString}`;
  }

  forceRedrawCluster(clusterId) {
    const dateString = new Date().toISOString();
    this.clusterIdMap.set(clusterId, dateString);
    const cluster = this.state.clusterData.find(c => c.id === clusterId);
    if (cluster) cluster.key = this.getClusterKey(cluster.id, dateString);
    this.forceUpdate();
  }

  clusterize(dataset) {
    this.superCluster = new SuperCluster({ // eslint-disable-line new-cap
      extent: this.props.extent,
      minZoom: this.props.minZoom,
      maxZoom: this.props.maxZoom,
      radius: this.props.radius || (this.dimensions[0] * .045), // 4.5% of screen width
    })

    // get formatted GeoPoints for cluster
    const rawData = dataset.map(item => itemToGeoJSONFeature(item, this.props.accessor))

    // load geopoints into SuperCluster
    this.superCluster.load(rawData)
    this.currentDateString = new Date().toISOString();
    this.clusterIdMap.clear();
    const clusterData = this.getClusters(this.state.region)
    this.setState({ clusterData, data: this.props.data })
  }

  clustersChanged(nextState) {
    return this.state.data.length !== nextState.data.length
  }

  onRegionChangeComplete(region) {
    let clusterData = this.getClusters(region)
    this.setState({ region, clusterData }, () => {
        this.props.onRegionChangeComplete && this.props.onRegionChangeComplete(region, data)
    })
  }

  getClusters(region) {
    const bbox = regionToBoundingBox(region),
          viewport = (region.longitudeDelta) >= 40 ? { zoom: this.props.minZoom } : GeoViewport.viewport(bbox, this.dimensions)

    const clusters = this.superCluster.getClusters(bbox, viewport.zoom);
    clusters.forEach(c => {
        if (c.id) {
            let dateString = this.clusterIdMap.get(c.id);
            if (!dateString) {
                this.clusterIdMap.set(c.id, this.currentDateString);
                dateString = this.currentDateString;
            }
            c.key = this.getClusterKey(c.id, dateString);
        }
    });
    return clusters;
  }

  onClusterPress(cluster) {

    // cluster press behavior might be extremely custom.
    if (!this.props.preserveClusterPressBehavior) {
        this.props.onClusterPress && this.props.onClusterPress(cluster.properties.cluster_id)
    } else {
        // //////////////////////////////////////////////////////////////////////////////////
        // NEW IMPLEMENTATION (with fitToCoordinates)
        // //////////////////////////////////////////////////////////////////////////////////
        // get cluster children
        const children = this.superCluster.getLeaves(cluster.properties.cluster_id, this.props.clusterPressMaxChildren)
        const markers = children.map(c => c.properties.item)
    
        const coordinates = markers.map(item => getCoordinatesFromItem(item, this.props.accessor, false))
    
        // fit right around them, considering edge padding
        this.mapview.fitToCoordinates(coordinates, { edgePadding: this.props.edgePadding })
    
        this.props.onClusterPress && this.props.onClusterPress(cluster.properties.cluster_id, markers)
    }
    // This is to keep react native maps from changing the z-index on the cluster marker if the "tap" event had overlapping hitboxes
    this.forceRedrawCluster(cluster.id);
  }

  render() {
    const { style, ...props } = this.props

    return (
      <MapView
        {...props}
        style={style}
        ref={this.mapRef}
        onRegionChangeComplete={this.onRegionChangeComplete}>
        {
          this.props.clusteringEnabled && this.state.clusterData.map((d) => {
            if (d.properties.point_count === 0)
              return this.props.renderMarker(d.properties.item)

            return (
              <ClusterMarker
                {...d}
                onPress={this.onClusterPress}
                renderCluster={this.props.renderCluster}
                key={d.key} />
            )
          })
        }
        {
          !this.props.clusteringEnabled && this.props.data.map(d => this.props.renderMarker(d))
        }
        {this.props.children}
      </MapView>
    )
  }
}

ClusteredMapView.defaultProps = {
  minZoom: 1,
  maxZoom: 16,
  extent: 512,
  accessor: 'location',
  animateClusters: true,
  clusteringEnabled: true,
  clusterPressMaxChildren: 100,
  preserveClusterPressBehavior: true,
  width: Dimensions.get('window').width,
  height: Dimensions.get('window').height,
  layoutAnimationConf: LayoutAnimation.Presets.spring,
  edgePadding: { top: 10, left: 10, right: 10, bottom: 10 }
}

ClusteredMapView.propTypes = {
  ...MapView.propTypes,
  // number
  radius: PropTypes.number,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  extent: PropTypes.number.isRequired,
  minZoom: PropTypes.number.isRequired,
  maxZoom: PropTypes.number.isRequired,
  clusterPressMaxChildren: PropTypes.number.isRequired,
  // array
  data: PropTypes.array.isRequired,
  // func
  onExplode: PropTypes.func,
  onImplode: PropTypes.func,
  onClusterPress: PropTypes.func,
  renderMarker: PropTypes.func.isRequired,
  renderCluster: PropTypes.func.isRequired,
  // bool
  animateClusters: PropTypes.bool.isRequired,
  clusteringEnabled: PropTypes.bool.isRequired,
  preserveClusterPressBehavior: PropTypes.bool.isRequired,
  // object
  layoutAnimationConf: PropTypes.object,
  edgePadding: PropTypes.object.isRequired,
  // string
  // mutiple
  accessor: PropTypes.oneOfType([PropTypes.string, PropTypes.func])
}
