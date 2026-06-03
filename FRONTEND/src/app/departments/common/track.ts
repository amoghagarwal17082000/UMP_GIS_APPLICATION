import { GeoJsonObject } from 'geojson';
import * as L from 'leaflet';
import { Api } from '../../api/api';
import { bindAssetDetailsPopup } from '../../components/asset-popup/asset-popup';
import { defineLegend, MapLayer, pathStyleFromLegend } from '../../services/interface';

const TRACK_LEGEND = defineLegend({
  type: 'line' as const,
  color: 'black',
  label: 'Railway Track',
  strokeColor: 'black',
  strokeWidth: 2,
});


export class TrackLayer implements MapLayer {
  id = 'tracks';
  title = 'Railway Tracks';
  visible = true;
  layerGroup = 'common' as const;
  legend = TRACK_LEGEND;

  private layer!: L.GeoJSON;
  private lastBbox = '';
  private loadedBounds?: L.LatLngBounds;
  private requestSeq = 0;
  private isOnMap = false;
  private lastDetailKey = '';

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: pathStyleFromLegend(this.legend),
      interactive: true,
      onEachFeature: (feature: any, layer: any) => {
        bindAssetDetailsPopup(layer, 'Railway Track Details', feature?.properties || {});
      },
    });
  }

  addTo(map: L.Map) {
    if (this.visible && !this.isOnMap) {
      this.layer.addTo(map);
      this.layer.bringToFront();
      this.isOnMap = true;
    }
  }

  removeFrom(map: L.Map) {
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.isOnMap = false;
    this.lastBbox = '';
    this.lastDetailKey = '';
    this.loadedBounds = undefined;
  }

  private getBufferedBounds(map: L.Map): L.LatLngBounds {
    return map.getBounds().pad(0.5);
  }

  private getDetailKey(zoom: number): string {
    if (zoom < 6) return 'country';
    if (zoom < 8) return 'zone';
    if (zoom < 10) return 'division';
    return 'full';
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);

    const currentBounds = map.getBounds();
    const detailKey = this.getDetailKey(map.getZoom());

    if (
      this.loadedBounds &&
      this.loadedBounds.contains(currentBounds) &&
      this.lastDetailKey === detailKey
    ) {
      return;
    }

    const b = this.getBufferedBounds(map);
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const bboxKey = `${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}`;
    const requestKey = `${detailKey}|${bboxKey}`;

    if (requestKey === this.lastBbox) return;
    this.lastBbox = requestKey;
    this.lastDetailKey = detailKey;
    const requestId = ++this.requestSeq;

    this.api.getTracks(bbox, map.getZoom()).subscribe({
      next: (geojson: GeoJsonObject) => {
        if (requestId !== this.requestSeq) return;
        this.loadedBounds = b;
        this.layer.clearLayers();
        this.layer.addData(geojson);
        this.layer.bringToFront();
        this.onData?.(geojson);
      },
      error: (err: any) => console.error('Track layer error', err),
    });
  }

}

