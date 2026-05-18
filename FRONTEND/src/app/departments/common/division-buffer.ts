import * as L from 'leaflet';
import { Api } from '../../api/api';
import { defineLegend, MapLayer } from '../../services/interface';

const DIVISION_BUFFER_LEGEND = defineLegend({
  type: 'polygon' as const,
  color: '#111827',
  label: 'Division Buffer',
  fillColor: '#111827',
  fillOpacity: 0.04,
  strokeColor: '#111827',
  strokeWidth: 1.4,
  symbolKind: 'square' as const,
});

const DIVISION_BUFFER_PANE = 'DivisionBufferPane';

function ensureDivisionBufferPane(map: L.Map): void {
  if (!map.getPane(DIVISION_BUFFER_PANE)) {
    map.createPane(DIVISION_BUFFER_PANE);
  }
  const pane = map.getPane(DIVISION_BUFFER_PANE)!;
  pane.style.zIndex = '650';
  pane.style.pointerEvents = 'none';
}

export class DivisionBufferLayer implements MapLayer {
  id = 'division_buffer';
  title = 'Division Buffer';
  visible = true;
  layerGroup = 'common' as const;
  legend = DIVISION_BUFFER_LEGEND;
  private layer: L.FeatureGroup;
  private lastKey = '';
  private fittedOnce = false;
  private geometries: any[] = [];

  constructor(private api: Api, private onInitialBounds?: (bounds: L.LatLngBounds) => void) {
    this.layer = L.featureGroup();
  }

  addTo(map: L.Map) {
    if (!this.visible) return;
    ensureDivisionBufferPane(map);
    if (!map.hasLayer(this.layer)) this.layer.addTo(map);
    (this.layer as any).bringToFront?.();
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

  private normalizeGeoJson(response: any): any {
    const candidate =
      response?.type ? response :
      response?.geojson?.type ? response.geojson :
      response?.data?.type ? response.data :
      response?.data?.geojson?.type ? response.data.geojson :
      null;

    if (!candidate) return { type: 'FeatureCollection', features: [] };
    if (candidate.type === 'Feature') return { type: 'FeatureCollection', features: [candidate] };
    if (candidate.type === 'FeatureCollection') return { ...candidate, features: candidate.features || [] };
    return { type: 'FeatureCollection', features: [] };
  }

  private collectLatLngsFromGeometry(geometry: any, out: L.LatLng[] = []): L.LatLng[] {
    const type = String(geometry?.type || '');
    const coordinates = geometry?.coordinates;

    const collectPosition = (position: any) => {
      const lng = Number(position?.[0]);
      const lat = Number(position?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out.push(L.latLng(lat, lng));
      }
    };

    if (type === 'Polygon' && Array.isArray(coordinates)) {
      coordinates.forEach((ring: any[]) => ring?.forEach(collectPosition));
      return out;
    }

    if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
      coordinates.forEach((polygon: any[]) => {
        polygon?.forEach((ring: any[]) => ring?.forEach(collectPosition));
      });
      return out;
    }

    return out;
  }

  private polygonRingsToLatLngs(rings: any[]): L.LatLngExpression[][] {
    if (!Array.isArray(rings)) return [];

    return rings
      .map((ring: any[]) => {
        if (!Array.isArray(ring)) return [];
        return ring
          .map((position: any) => {
            const lng = Number(position?.[0]);
            const lat = Number(position?.[1]);
            return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] as L.LatLngExpression : null;
          })
          .filter(Boolean) as L.LatLngExpression[];
      })
      .filter((ring) => ring.length >= 3);
  }

  private addManualBufferPolygon(geometry: any): L.Layer | null {
    const style: L.PathOptions = {
      pane: DIVISION_BUFFER_PANE,
      color: this.legend.strokeColor || this.legend.color,
      weight: this.legend.strokeWidth || 2,
      opacity: 1,
      fill: true,
      fillColor: this.legend.fillColor || this.legend.color,
      fillOpacity: this.legend.fillOpacity ?? 0.12,
      interactive: false,
    } as any;

    const type = String(geometry?.type || '');
    const coordinates = geometry?.coordinates;

    if (type === 'Polygon') {
      const rings = this.polygonRingsToLatLngs(coordinates);
      return rings.length ? L.polygon(rings, style) : null;
    }

    if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
      const group = L.featureGroup();
      coordinates.forEach((polygon: any[]) => {
        const rings = this.polygonRingsToLatLngs(polygon);
        if (rings.length) group.addLayer(L.polygon(rings, style));
      });
      return group.getLayers().length ? group : null;
    }

    return null;
  }

  private collectPolygonRings(geometry: any): L.LatLng[][] {
    const rings: L.LatLng[][] = [];
    const type = String(geometry?.type || '');
    const coordinates = geometry?.coordinates;

    const toLatLngRing = (ring: any[]): L.LatLng[] => {
      if (!Array.isArray(ring)) return [];
      return ring
        .map((position: any) => {
          const lng = Number(position?.[0]);
          const lat = Number(position?.[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null;
        })
        .filter(Boolean) as L.LatLng[];
    };

    if (type === 'Polygon' && Array.isArray(coordinates)) {
      coordinates.forEach((ring: any[]) => {
        const latLngRing = toLatLngRing(ring);
        if (latLngRing.length >= 3) rings.push(latLngRing);
      });
    }

    if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
      coordinates.forEach((polygon: any[]) => {
        polygon?.forEach((ring: any[]) => {
          const latLngRing = toLatLngRing(ring);
          if (latLngRing.length >= 3) rings.push(latLngRing);
        });
      });
    }

    return rings;
  }

  private addSvgBufferOverlay(geojson: any, bounds: L.LatLngBounds): L.Layer | null {
    if (!bounds.isValid()) return null;

    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const width = Math.max(east - west, Number.EPSILON);
    const height = Math.max(north - south, Number.EPSILON);

    const pointsToPath = (ring: L.LatLng[]) => ring
      .map((latLng, index) => {
        const x = ((latLng.lng - west) / width) * 1000;
        const y = ((north - latLng.lat) / height) * 1000;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
      })
      .join(' ') + ' Z';

    const polygonToCompoundPath = (polygon: any[]) => {
      const rings = this.polygonRingsToLatLngs(polygon)
        .map((ring) => ring.map((value) => L.latLng(value as any)));
      if (!rings.length) return '';
      return rings.map(pointsToPath).join(' ');
    };

    const paths: string[] = [];
    (geojson.features || []).forEach((feature: any) => {
      const geometry = feature?.geometry;
      const type = String(geometry?.type || '');
      const coordinates = geometry?.coordinates;

      if (type === 'Polygon' && Array.isArray(coordinates)) {
        const path = polygonToCompoundPath(coordinates);
        if (path) paths.push(path);
      }

      if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
        coordinates.forEach((polygon: any[]) => {
          const path = polygonToCompoundPath(polygon);
          if (path) paths.push(path);
        });
      }
    });

    if (!paths.length) return null;

    const pathMarkup = paths
      .map((path) => `<path d="${path}" fill="#111827" fill-opacity="0.04" fill-rule="evenodd" stroke="#111827" stroke-width="1.8" stroke-opacity="0.85" vector-effect="non-scaling-stroke"/>`)
      .join('');

    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">',
      pathMarkup,
      '</svg>',
    ].join('');

    return L.imageOverlay(
      `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      bounds,
      {
        pane: 'markerPane',
        opacity: 1,
        interactive: false,
      } as any,
    );
  }

  private getManualBounds(geojson: any): L.LatLngBounds | null {
    const latLngs: L.LatLng[] = [];
    (geojson.features || []).forEach((feature: any) => {
      this.collectLatLngsFromGeometry(feature?.geometry, latLngs);
    });

    if (!latLngs.length) return null;
    return L.latLngBounds(latLngs);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);

    const z = map.getZoom();
    const key = this.api.getDivisionBufferKey(z);
    if (key === this.lastKey) return;

    this.api.getDivisionBuffer().subscribe({
      next: (res: any) => {
        this.lastKey = key;
        const geojson = this.normalizeGeoJson(res);
        console.info('Division buffer features loaded:', geojson.features?.length || 0);
        this.geometries = Array.isArray(geojson?.features)
          ? geojson.features.map((feature: any) => feature?.geometry).filter(Boolean)
          : [];
        if (!this.geometries.length) {
          console.warn('Division buffer returned no geometries for the current user/division.');
        }
        this.layer.clearLayers();
        ensureDivisionBufferPane(map);
        const manualBounds = this.getManualBounds(geojson);
        const rendered = L.featureGroup();
        (geojson.features || []).forEach((feature: any) => {
          const polygon = this.addManualBufferPolygon(feature?.geometry);
          if (polygon) rendered.addLayer(polygon);
        });
        this.layer.addLayer(rendered);
        if (manualBounds) {
          const svgOverlay = this.addSvgBufferOverlay(geojson, manualBounds);
          if (svgOverlay) this.layer.addLayer(svgOverlay);
        }
        if (!map.hasLayer(this.layer)) this.layer.addTo(map);
        (rendered as any).bringToFront?.();
        (this.layer as any).bringToFront?.();

        if (!this.fittedOnce) {
          const b = manualBounds || rendered.getBounds?.();
          if (b?.isValid?.()) {
            map.fitBounds(b.pad(0.08), { padding: [24, 24], animate: false, maxZoom: 10 });
            this.onInitialBounds?.(b);
          }
          this.fittedOnce = true;
        }
      },
      error: (err: any) => {
        this.lastKey = '';
        console.error('Division buffer error', err);
      },
    });
  }
}
