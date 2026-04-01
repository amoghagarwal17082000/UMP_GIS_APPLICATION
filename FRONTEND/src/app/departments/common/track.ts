import { GeoJsonObject } from 'geojson';
import * as L from 'leaflet';
import { Api } from '../../api/api';
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
  private requestSeq = 0;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: pathStyleFromLegend(this.legend),
    });
  }

  addTo(map: L.Map) {
    if (this.visible) {
      this.layer.addTo(map);
      this.layer.bringToFront();
    }
  }

  removeFrom(map: L.Map) {
    map.removeLayer(this.layer);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;

    if (bbox === this.lastBbox) return;
    this.lastBbox = bbox;
    const requestId = ++this.requestSeq;

    this.api.getTracks(bbox).subscribe({
      next: (geojson: GeoJsonObject) => {
        if (requestId !== this.requestSeq) return;
        this.layer.clearLayers();
        this.layer.addData(geojson);
        this.layer.bringToFront();
        this.onData?.(geojson);
      },
      error: (err: any) => console.error('Track layer error', err),
    });
  }
}
