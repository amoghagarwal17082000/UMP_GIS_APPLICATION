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
  symbolKind: 'square' as const,
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
  private geometries: any[] = [];

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

  containsLatLng(latlng: L.LatLng): boolean {
    const lat = Number(latlng?.lat);
    const lng = Number(latlng?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return this.geometries.some((geometry) => this.geometryContainsPoint(geometry, lng, lat));
  }

  private geometryContainsPoint(geometry: any, lng: number, lat: number): boolean {
    const type = String(geometry?.type || '');
    const coordinates = geometry?.coordinates;
    if (!coordinates) return false;

    if (type === 'Polygon') {
      return this.polygonContainsPoint(coordinates, lng, lat);
    }

    if (type === 'MultiPolygon') {
      return coordinates.some((polygon: any) => this.polygonContainsPoint(polygon, lng, lat));
    }

    return false;
  }

  private polygonContainsPoint(rings: any[], lng: number, lat: number): boolean {
    if (!Array.isArray(rings) || !rings.length) return false;
    if (!this.ringContainsPoint(rings[0], lng, lat)) return false;

    for (let i = 1; i < rings.length; i += 1) {
      if (this.ringContainsPoint(rings[i], lng, lat)) return false;
    }

    return true;
  }

  private ringContainsPoint(ring: any[], lng: number, lat: number): boolean {
    if (!Array.isArray(ring) || ring.length < 3) return false;

    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = Number(ring[i]?.[0]);
      const yi = Number(ring[i]?.[1]);
      const xj = Number(ring[j]?.[0]);
      const yj = Number(ring[j]?.[1]);

      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

      const intersects = ((yi > lat) !== (yj > lat))
        && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);

      if (intersects) inside = !inside;
    }

    return inside;
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
        this.geometries = Array.isArray(geojson?.features)
          ? geojson.features.map((feature: any) => feature?.geometry).filter(Boolean)
          : [];
        this.layer.clearLayers();
        this.layer.addData(geojson);
        this.layer.bringToFront();

        if (!this.fittedOnce) {
          const b = (this.layer as any).getBounds?.();
          if (b?.isValid?.()) {
            map.fitBounds(b, { padding: [20, 20], animate: false });
            map.setZoom(8.8, { animate: false });
          }
          this.fittedOnce = true;
        }
      },
      error: (err: any) => console.error('Division buffer error', err),
    });
  }
}
