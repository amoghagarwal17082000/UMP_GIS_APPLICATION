import * as L from 'leaflet';
import { Api } from '../../api/api';
import { defineLegend, MapLayer, pathStyleFromLegend } from '../../services/interface';

const DIVISION_BUFFER_LEGEND = defineLegend({
  type: 'polygon' as const,
  color: 'black',
  label: 'Division Buffer',
  fillColor: '#93c5fd',
  fillOpacity: 0.1,
  strokeColor: 'black',
  strokeWidth: 2,
});

export class DivisionBufferLayer implements MapLayer {
  id = 'division_buffer';
  title = 'Division Buffer';
  visible = true;
  layerGroup = 'common' as const;
  legend = DIVISION_BUFFER_LEGEND;

  private layer: L.GeoJSON;
  private lastKey = '';
  private fittedOnce = false;

  constructor(private api: Api) {
    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      interactive: false,
    });
  }

  addTo(map: L.Map) {
    if (!this.visible) return;
    if (!map.hasLayer(this.layer)) this.layer.addTo(map);
    this.layer.bringToFront();
  }

  removeFrom(map: L.Map) {
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);

    const z = map.getZoom();
    const key = this.api.getDivisionBufferKey(z);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.api.getDivisionBuffer().subscribe({
      next: (res: any) => {
        const geojson = res || { type: 'FeatureCollection', features: [] };
        this.layer.clearLayers();
        this.layer.addData(geojson);
        this.layer.bringToFront();

        if (!this.fittedOnce) {
          const b = (this.layer as any).getBounds?.();
          if (b?.isValid?.()) {
            map.fitBounds(b, { padding: [20, 20] });
            this.fittedOnce = true;
          }
        }
      },
      error: (err: any) => console.error('Division buffer error', err),
    });
  }
}
