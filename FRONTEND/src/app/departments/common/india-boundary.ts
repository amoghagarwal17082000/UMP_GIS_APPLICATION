import * as L from 'leaflet';
import { Api } from '../../api/api';
import { defineLegend, MapLayer, pathStyleFromLegend } from '../../services/interface';

const INDIA_BOUNDARY_LEGEND = defineLegend({
  type: 'polygon' as const,
  color: 'black',
  label: 'India Boundary',
  fillColor: 'transparent',
  fillOpacity: 0,
  strokeColor: 'black',
  strokeWidth: 2,
  symbolKind: 'line' as const,
});

export class IndiaBoundaryLayer implements MapLayer {
  id = 'india_boundary';
  title = 'India Boundary';
  visible = true;
  layerGroup = 'common' as const;
  legend = INDIA_BOUNDARY_LEGEND;
  private readonly MIN_ZOOM = 10;
  private layer: L.GeoJSON;
  private lastKey = '';

  constructor(private api: Api) {
    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      interactive: false,
    });
  }

  addTo(map: L.Map) {
    if (!this.visible) return;
    if (map.getZoom() < this.MIN_ZOOM) {
      this.removeFrom(map);
      return;
    }
    if (!map.hasLayer(this.layer)) this.layer.addTo(map);
    this.layer.bringToFront();
  }

  removeFrom(map: L.Map) {
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    if (map.getZoom() < this.MIN_ZOOM) {
      this.lastKey = '';
      this.layer.clearLayers();
      this.removeFrom(map);
      return;
    }

    this.addTo(map);

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const z = map.getZoom();

    const key = `${bbox}|${z}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.api.getIndiaBoundary(bbox).subscribe({
      next: (geojson: any) => {
        this.layer.clearLayers();
        this.layer.addData(geojson);
        this.layer.bringToFront();
      },
      error: (err: any) => console.error('India boundary error', err),
    });
  }
}
