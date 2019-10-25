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

  clusters = {}

  constructor(props) {
    super(props)

    this.state = {
      data: [], // helds renderable clusters and markers
      region: props.region || props.initialRegion, // helds current map region
    }

    this.isAndroid = Platform.OS === 'android'
    this.dimensions = [props.width, props.height]

    this.mapRef = this.mapRef.bind(this)
    this.onClusterPress = this.onClusterPress.bind(this)
    this.onRegionChangeComplete = this.onRegionChangeComplete.bind(this)
  }

  componentDidMount() {
    this.clusterize(this.props.data, this.props.groupKey)
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.data !== nextProps.data || this.props.groupKey !== nextProps.groupKey)
      this.clusterize(nextProps.data, nextProps.groupKey)
  }

  componentWillUpdate(nextProps, nextState) {
    if (!this.isAndroid && this.props.animateClusters && this.clustersChanged(nextState))
      LayoutAnimation.configureNext(this.props.layoutAnimationConf)
  }

  mapRef(ref) {
    this.mapview = ref
  }

  getMapRef() {
    return this.mapview
  }

  getClusteringEngine = (groupKey = 0) => this.clusters[groupKey]

  getAllFromClusterEngine = (getFn = (x) => []) => Object.values(this.clusters).map(getFn).reduce((a, b) => a.concat(b), [])

  groupBy = (xs, key) => xs.reduce((rv, x) => { (rv[x[key]] = rv[x[key]] || []).push(x); return rv; }, {});

  clusterize = (dataset, groupKey = 0) => {
    dataset = dataset || []
    let dataGroups = groupKey ? this.groupBy(dataset, groupKey) : { 0: dataset };

    Object.keys(dataGroups).forEach(groupValue => { 
        const dataGroup = dataGroups[groupValue];
        let cluster = new SuperCluster({ // eslint-disable-line new-cap
            extent: this.props.extent,
            minZoom: this.props.minZoom,
            maxZoom: this.props.maxZoom,
            radius: this.props.radius || (this.dimensions[0] * .045), // 4.5% of screen width
        })

        // get formatted GeoPoints for cluster
        const rawGroupData = dataGroup.map(item => itemToGeoJSONFeature(item, this.props.accessor))

        // load geopoints into SuperCluster
        cluster.load(rawGroupData)

        this.clusters[groupValue] = cluster;
    });

    const data = this.getClusters(this.state.region)
    this.setState({ data })
  }

  clustersChanged(nextState) {
    return this.state.data.length !== nextState.data.length
  }

  onRegionChangeComplete(region) {
    let data = this.getClusters(region)
    this.setState({ region, data }, () => {
        this.props.onRegionChangeComplete && this.props.onRegionChangeComplete(region, data)
    })
  }

  getClusters(region) {
    const bbox = regionToBoundingBox(region),
          viewport = (region.longitudeDelta) >= 40 ? { zoom: this.props.minZoom } : GeoViewport.viewport(bbox, this.dimensions)

    // Get all clusters from each group and set the grouped by value as a property
    return Object.keys(this.clusters)
            .map(groupValue => ({ groupValue, clusters: this.clusters[groupValue].getClusters(bbox, viewport.zoom)}))
            .reduce((a, b) => {
                b.clusters.forEach(x => x.properties['groupValue'] = b.groupValue)
                return a.concat(b.clusters);
            }, [])
  }

  onClusterPress(cluster) {

    // cluster press behavior might be extremely custom.
    if (!this.props.preserveClusterPressBehavior) {
      this.props.onClusterPress && this.props.onClusterPress(cluster.properties.cluster_id)
      return
    }

    // //////////////////////////////////////////////////////////////////////////////////
    // NEW IMPLEMENTATION (with fitToCoordinates)
    // //////////////////////////////////////////////////////////////////////////////////
    // get cluster children
    const children = this.getAllFromClusterEngine(x => x.getLeaves(cluster.properties.cluster_id, this.props.clusterPressMaxChildren))
    const markers = children.map(c => c.properties.item)

    const coordinates = markers.map(item => getCoordinatesFromItem(item, this.props.accessor, false))

    // fit right around them, considering edge padding
    this.mapview.fitToCoordinates(coordinates, { edgePadding: this.props.edgePadding })

    this.props.onClusterPress && this.props.onClusterPress(cluster.properties.cluster_id, markers)
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
          this.props.clusteringEnabled && this.state.data.map((d) => {
            if (d.properties.point_count === 0)
              return this.props.renderMarker(d.properties.item)

            return (
              <ClusterMarker
                {...d}
                onPress={this.onClusterPress}
                renderCluster={this.props.renderCluster}
                key={`cluster-${d.properties.groupValue}-${d.properties.cluster_id}`} />
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
  groupKey: PropTypes.string,
  // mutiple
  accessor: PropTypes.oneOfType([PropTypes.string, PropTypes.func])
}
