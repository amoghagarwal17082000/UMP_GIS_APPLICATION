import { GeoJsonObject } from 'geojson';
import * as L from 'leaflet';
import 'leaflet-polylinedecorator';
import { NgZone } from '@angular/core';
import { Api } from '../../../api/api';
import { LayerLegend, defineLegend, MapLayer, pathStyleFromLegend, pointLayerFromLegend } from '../../../services/interface';

const STATION_LEGEND: LayerLegend = defineLegend({
  type: 'point' as const,
  color: '#d32f2f',
  label: 'Railway Station',
  fillColor: '#d32f2f',
  fillOpacity: 0.9,
  strokeColor: '#ffffff',
  strokeWidth: 1,
  radius: 5,
  symbolKind: 'circle' as const,
  imageUrl: 'assets/images/download.png',
  imageWidth: 26,
  imageHeight: 26,
});

const LANDPLAN_ONTRACK_LEGEND = defineLegend({
  type: 'polygon' as const,
  color: '#FFA500',
  label: 'Landplan Ontrack',
  fillColor: '#fff59d',
  fillOpacity: 0.72,
  strokeColor: '#d4a017',
  strokeWidth: 2,
  symbolKind: 'square' as const,
});

const LAND_OFFSET_LEGEND = defineLegend({
  type: 'line' as const,
  color: '#000000',
  label: 'Land Offset',
  strokeColor: '#000000',
  strokeWidth: 2,
  symbolKind: 'line' as const,
});

const LAND_BOUNDARY_LEGEND = defineLegend({
  type: 'line' as const,
  color: 'orange',
  label: 'Land Boundary',
  strokeColor: 'orange',
  strokeWidth: 3,
  symbolKind: 'line' as const,
});

const DEFAULT_DYNAMIC_LEGEND: LayerLegend = defineLegend({
  type: 'polygon' as const,
  color: '#4dd0e1',
  label: 'Department Layer',
  fillColor: '#4dd0e1',
  fillOpacity: 0.35,
  strokeColor: '#4dd0e1',
  strokeWidth: 2,
  radius: 6,
  symbolKind: 'square' as const,
});

const DEPARTMENT_POLYGON_PANE = 'DepartmentPolygonPane';
const DEPARTMENT_LINE_PANE = 'DepartmentLinePane';
const DEPARTMENT_DECORATOR_PANE = 'DepartmentDecoratorPane';
const DEPARTMENT_POINT_PANE = 'DepartmentPointPane';

function paneZIndex(paneName: string): number {
  if (paneName === DEPARTMENT_POLYGON_PANE) return 390;
  if (paneName === DEPARTMENT_LINE_PANE) return 440;
  if (paneName === DEPARTMENT_DECORATOR_PANE) return 445;
  return 460;
}

function ensurePane(map: L.Map, paneName: string, pointerEvents = 'none'): void {
  if (!map.getPane(paneName)) {
    map.createPane(paneName);
  }
  const pane = map.getPane(paneName)!;
  pane.style.zIndex = String(paneZIndex(paneName));
  pane.style.pointerEvents = pointerEvents;
}

function paneNameForLegend(legend: LayerLegend): string {
  if (legend.type === 'polygon') return DEPARTMENT_POLYGON_PANE;
  if (legend.type === 'line') return DEPARTMENT_LINE_PANE;
  return DEPARTMENT_POINT_PANE;
}

function orderLayerInPane(layer: L.GeoJSON, legend: LayerLegend): void {
  if (legend.type === 'polygon') layer.bringToBack();
  else layer.bringToFront();
}

function inferLegendFromTitle(title: string, type: 'point' | 'line' | 'polygon'): LayerLegend {
  const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const entries: Array<{ match: string[]; legend: LayerLegend }> = [
    { match: ['railway track', 'track'], legend: defineLegend({ type: 'line' as const, color: '#111827', label: title, strokeColor: '#111827', strokeWidth: 2, symbolKind: 'track' as const }) },
    { match: ['km post'], legend: defineLegend({ type: 'point' as const, color: '#2563eb', label: title, fillColor: '#2563eb', fillOpacity: 0.95, strokeColor: '#ffffff', strokeWidth: 1, radius: 6, symbolKind: 'diamond' as const }) },
    { match: ['point & crossing', 'point and crossing'], legend: defineLegend({ type: 'point' as const, color: '#d97706', label: title, strokeColor: '#d97706', strokeWidth: 2, radius: 7, symbolKind: 'ring-slash' as const }) },
    { match: ['level crossing'], legend: defineLegend({ type: 'point' as const, color: '#f59e0b', label: title, fillColor: '#fbbf24', strokeColor: '#d97706', strokeWidth: 2, symbolText: '!', textColor: '#1f2937', symbolKind: 'triangle' as const }) },
    { match: ['switch expansion joint', '(sej)', 'sej'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: 'S', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['buffer rail', 'buffer rails'], legend: defineLegend({ type: 'point' as const, color: '#65a30d', label: title, fillColor: '#84cc16', strokeColor: '#65a30d', strokeWidth: 1, radius: 5, symbolKind: 'diamond' as const }) },
    { match: ['gradient start'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: '+', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['gradient end'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: 'G', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['curve start'], legend: defineLegend({ type: 'point' as const, color: '#d97706', label: title, fillColor: '#f59e0b', strokeColor: '#d97706', strokeWidth: 2, radius: 7, symbolText: 'C', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['curve end'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: 'C', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['cutting start'], legend: defineLegend({ type: 'point' as const, color: '#84a65b', label: title, fillColor: '#eef7d0', strokeColor: '#84a65b', strokeWidth: 2, radius: 7, symbolText: 'C', textColor: '#84a65b', symbolKind: 'ring' as const }) },
    { match: ['cutting end'], legend: defineLegend({ type: 'point' as const, color: '#e57373', label: title, fillColor: '#fff1f1', strokeColor: '#e57373', strokeWidth: 2, radius: 7, symbolText: 'C', textColor: '#e57373', symbolKind: 'ring' as const }) },
    { match: ['bridge'], legend: defineLegend({ type: 'point' as const, color: '#66bb6a', label: title, fillColor: '#9be59d', strokeColor: '#66bb6a', strokeWidth: 2, radius: 7, symbolText: 'B', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['tunnel start'], legend: defineLegend({ type: 'point' as const, color: '#ff8a65', label: title, fillColor: '#ffab91', strokeColor: '#ff8a65', strokeWidth: 2, radius: 7, symbolText: 'T', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['tunnel end'], legend: defineLegend({ type: 'point' as const, color: '#0f172a', label: title, fillColor: '#0f172a', strokeColor: '#0f172a', strokeWidth: 2, radius: 7, symbolText: 'T', textColor: '#38bdf8', symbolKind: 'circle' as const }) },
    { match: ['rob'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: 'R', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['rub_lhs', 'rub lhs', 'rub'], legend: defineLegend({ type: 'point' as const, color: '#f59e0b', label: title, fillColor: '#fbbf24', strokeColor: '#d97706', strokeWidth: 2, radius: 7, symbolText: 'X', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['fob'], legend: defineLegend({ type: 'point' as const, color: '#eab308', label: title, fillColor: '#fde047', strokeColor: '#eab308', strokeWidth: 2, radius: 7, symbolText: 'F', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['land boundary'], legend: defineLegend({ type: 'line' as const, color: '#f59e0b', label: title, strokeColor: '#f59e0b', strokeWidth: 3, symbolKind: 'line' as const }) },
    { match: ['land offset'], legend: defineLegend({ type: 'line' as const, color: '#111827', label: title, strokeColor: '#111827', strokeWidth: 2, symbolKind: 'line' as const }) },
    { match: ['landplan ontrack', 'land plan ontrack', 'land plans (on-track)', 'land plans on-track'], legend: defineLegend({ type: 'polygon' as const, color: '#FFA500', label: title, fillColor: '#FFA500', fillOpacity: 0.15, strokeColor: '#FFA500', strokeWidth: 3, symbolKind: 'square' as const }) },
    { match: ['land plans (off-track)', 'land plans off-track', 'land plan offtrack', 'landplan offtrack'], legend: defineLegend({ type: 'polygon' as const, color: '#f59e0b', label: title, fillColor: '#f59e0b', fillOpacity: 0.15, strokeColor: '#f59e0b', strokeWidth: 2, symbolKind: 'square' as const }) },
    { match: ['land parcels', 'land parcel'], legend: defineLegend({ type: 'polygon' as const, color: '#818cf8', label: title, fillColor: '#818cf8', fillOpacity: 0.15, strokeColor: '#818cf8', strokeWidth: 2, symbolKind: 'square' as const }) },
  ];

  const matched = entries.find((entry) => entry.match.some((token) => normalized.includes(token)));
  if (matched) return matched.legend;

  if (type === 'point') {
    return defineLegend({ type: 'point' as const, color: '#f97316', label: title, fillColor: '#f97316', fillOpacity: 0.9, strokeColor: '#ffffff', strokeWidth: 1, radius: 7, symbolKind: 'circle' as const });
  }

  if (type === 'line') {
    return defineLegend({ type: 'line' as const, color: '#facc15', label: title, strokeColor: '#facc15', strokeWidth: 3, symbolKind: 'line' as const });
  }

  return defineLegend({ type: 'polygon' as const, color: '#4dd0e1', label: title, fillColor: '#4dd0e1', fillOpacity: 0.15, strokeColor: '#4dd0e1', strokeWidth: 2, symbolKind: 'square' as const });
}

function inferMinZoomFromTitle(title: string): number {
  const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.includes('station')) return 0;
  if (normalized.includes('track')) return 0;
  if (normalized.includes('km post')) return 0;
  return 13;
}

function inferLegendFromFeatureCollection(title: string, geojson: any): LayerLegend {
  const feature = geojson?.features?.find((f: any) => !!f?.geometry?.type);
  const type = String(feature?.geometry?.type || '').toLowerCase();
  const resolvedType: 'point' | 'line' | 'polygon' = type.includes('point') ? 'point' : type.includes('line') ? 'line' : 'polygon';
  return inferLegendFromTitle(title, resolvedType);
}

export class StationViewingLayer implements MapLayer {
  id = 'stations';
  title = 'Stations';
  visible = true;
  layerGroup = 'department' as const;

  protected readonly LABEL_ZOOM = 12;

  legend: LayerLegend = STATION_LEGEND;

  protected layer: L.FeatureGroup;
  private lastBbox = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private onMoveStartHandler?: () => void;
  private onMoveEndHandler?: () => void;
  private requestSeq = 0;

  constructor(
    protected api: Api,
    protected zone: NgZone,
    protected onData?: (geojson: any) => void
  ) {
    this.layer = L.featureGroup();
  }

  protected onMarkerCreated(_feature: any, _marker: L.Marker) {}

  protected onFeatureReady(_feature: any, _layer: any) {}

  addTo(map: L.Map) {
    if (this.visible && !this.isOnMap) {
      ensurePane(map, DEPARTMENT_POINT_PANE);
      this.layer.addTo(map);
      this.isOnMap = true;

      if (!this.onZoomEndHandler) {
        this.onZoomEndHandler = () => this.updateLabels(map);
      }
      if (!this.onMoveStartHandler) {
        this.onMoveStartHandler = () => this.closeLabels();
      }
      if (!this.onMoveEndHandler) {
        this.onMoveEndHandler = () => this.updateLabels(map);
      }
      map.on('zoomend', this.onZoomEndHandler);
      map.on('zoomstart', this.onMoveStartHandler);
      map.on('movestart', this.onMoveStartHandler);
      map.on('moveend', this.onMoveEndHandler);
      this.layer.bringToFront();
      this.updateLabels(map);
    }
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
    }
    if (this.onMoveStartHandler) {
      map.off('zoomstart', this.onMoveStartHandler);
      map.off('movestart', this.onMoveStartHandler);
    }
    if (this.onMoveEndHandler) {
      map.off('moveend', this.onMoveEndHandler);
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.isOnMap = false;
  }

  protected closeLabels() {
    this.layer.eachLayer((l: any) => {
      if (l.getTooltip?.()) l.closeTooltip();
    });
  }

  protected updateLabels(map: L.Map) {
    const show = map.getZoom() >= this.LABEL_ZOOM;
    this.layer.eachLayer((l: any) => {
      const tooltip = l.getTooltip?.();
      if (!tooltip) return;
      show ? l.openTooltip() : l.closeTooltip();
    });
  }

  protected beforeRender(_geojson: any) {}


  protected createStationMarker(feature: any, latlng: L.LatLng): L.Layer {
    const p = feature?.properties || {};
    const name = (p.sttnname || '').toString().trim();
    const code = (p.sttncode || '').toString().trim();
    const stationLabel = code && name ? code + ' : ' + name : (code || name);
    const iconWidth = this.legend.imageWidth ?? 20;
    const iconHeight = this.legend.imageHeight ?? 20;
    const marker = L.marker(latlng, {
      pane: DEPARTMENT_POINT_PANE,
      keyboard: false,
      interactive: true,
      icon: L.divIcon({
        className: 'map-symbol-icon station-symbol-icon',
        html: '<img src="' + (this.legend.imageUrl || 'assets/images/download.png') + '" style="display:block;width:' + iconWidth + 'px;height:' + iconHeight + 'px;object-fit:contain;" alt="Station">',
        iconSize: [iconWidth, iconHeight],
        iconAnchor: [iconWidth / 2, iconHeight / 2],
        popupAnchor: [0, -Math.round(iconHeight / 2)],
      }),
    }) as any;
    this.onMarkerCreated(feature, marker as any);

    if (stationLabel && marker.bindTooltip) {
      marker.bindTooltip(stationLabel, {
        permanent: false,
        direction: 'top',
        offset: L.point(0, -8),
        opacity: 0.95,
        className: 'station-label',
      });
    }

    if (marker.bindPopup) {
      marker.bindPopup('<b>' + (p.sttnname || 'Station') + '</b><br>Code: ' + (p.sttncode || '-'));
    }

    this.onFeatureReady(feature, marker);
    return marker;
  }

  protected renderStationFeatures(_map: L.Map, geojson: any): void {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];

    this.layer.clearLayers();
    features.forEach((feature: any) => {
      const coords = feature?.geometry?.coordinates || [];
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      this.layer.addLayer(this.createStationMarker(feature, L.latLng(lat, lng)));
    });
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);

    const b = map.getBounds();
    const bbox = b.getWest() + ',' + b.getSouth() + ',' + b.getEast() + ',' + b.getNorth();

    if (bbox === this.lastBbox) return;
    this.lastBbox = bbox;
    const requestId = ++this.requestSeq;

    this.api.getStations(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.zone.run(() => {
          this.beforeRender(geojson);
          this.renderStationFeatures(map, geojson);
          this.onData?.(geojson);
          this.updateLabels(map);
        });
      },
      error: (err: any) => console.error('Station layer error', err),
    });
  }
}
export class LandPlanOntrackViewingLayer implements MapLayer {
  id = 'landplan_ontrack';
  title = 'Landplan Ontrack';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = 13;

  legend = LANDPLAN_ONTRACK_LEGEND;

  protected layer: L.GeoJSON;
  private lastKey = '';

  private onZoomEndHandler?: () => void;
  private requestSeq = 0;

  constructor(protected api: Api, protected onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      interactive: this.isInteractive(),
      onEachFeature: (feature: any, layer: any) => {
        this.onFeatureReady(feature, layer);
      },
    });
  }

  protected isInteractive(): boolean {
    return false;
  }

  protected panePointerEvents(): string {
    return 'none';
  }

  protected onFeatureReady(_feature: any, _layer: any): void {}

  private canShow(map: L.Map) {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map) {
    this.onZoomEndHandler = () => this.syncVisibility(map);
    map.on('zoomend', this.onZoomEndHandler);
    this.syncVisibility(map);
  }

  private syncVisibility(map: L.Map) {
    const shouldShow = this.canShow(map);

    if (shouldShow) {
      if (!map.hasLayer(this.layer)) {
        this.layer.addTo(map);
        this.layer.bringToBack();
      }
      this.loadForMap(map);
    } else {
      if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
      this.lastKey = '';
    }
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) map.off('zoomend', this.onZoomEndHandler);

    this.onZoomEndHandler = undefined;

    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    const zActual = map.getZoom();
    const zForQuery = Math.max(zActual, this.minZoom);

    const b = map.getBounds();
    const bboxKey = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
    const key = `${zForQuery}|${bboxKey}`;

    if (key === this.lastKey) return;
    this.lastKey = key;
    const requestId = ++this.requestSeq;

    this.api.getLandPlanOntrack(zForQuery).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        if (!geojson || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
          console.error('LandPlanOntrack invalid GeoJSON returned:', geojson);
          return;
        }

        const fc =
          geojson.type === 'Feature'
            ? { type: 'FeatureCollection', features: [geojson] }
            : geojson;

        fc.features = (fc.features ?? []).map((f: any) => ({
          ...f,
          properties: f?.properties ?? f?.attributes ?? {},
        }));

        this.onData?.(fc);

        if (zActual < this.minZoom) {
          this.layer.clearLayers();
          return;
        }

        this.layer.clearLayers();
        this.layer.addData(fc);
        this.layer.bringToBack();
      },
      error: (err: any) => {
        console.error('LandPlanOntrack API error', err);
      },
    });
  }
}
export class LandOffsetLayer implements MapLayer {
  id = 'land_offset';
  title = 'Land Offset';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = 13;

  legend = LAND_OFFSET_LEGEND;

  private layer: L.GeoJSON;
  private decorators: L.LayerGroup;
  private lastKey = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private onInteractionStartHandler?: () => void;
  private requestSeq = 0;
  private readonly DECORATOR_ZOOM = 13;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.decorators = L.layerGroup();

    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      interactive: false,
    });
  }

  private canShow(map: L.Map): boolean {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map) {
    if (!this.onZoomEndHandler) {
      this.onZoomEndHandler = () => this.syncVisibility(map);
    }

    if (!this.isOnMap) {
      map.on('zoomend', this.onZoomEndHandler);
      if (!this.onInteractionStartHandler) {
        this.onInteractionStartHandler = () => {
          if (map.hasLayer(this.decorators)) map.removeLayer(this.decorators);
        };
      }
      map.on('zoomstart', this.onInteractionStartHandler);
      map.on('movestart', this.onInteractionStartHandler);
      this.isOnMap = true;
    }

    this.syncVisibility(map);
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
    }
    if (this.onInteractionStartHandler) {
      map.off('zoomstart', this.onInteractionStartHandler);
      map.off('movestart', this.onInteractionStartHandler);
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    if (map.hasLayer(this.decorators)) map.removeLayer(this.decorators);
    this.layer.clearLayers();
    this.decorators.clearLayers();
    this.lastKey = '';
    this.isOnMap = false;
  }

  private syncVisibility(map: L.Map) {
    if (this.canShow(map)) {
      if (!map.hasLayer(this.layer)) this.layer.addTo(map);
      if (map.getZoom() >= this.DECORATOR_ZOOM) {
        if (!map.hasLayer(this.decorators)) this.decorators.addTo(map);
      } else if (map.hasLayer(this.decorators)) {
        map.removeLayer(this.decorators);
        this.decorators.clearLayers();
      }
      return;
    }

    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    if (map.hasLayer(this.decorators)) map.removeLayer(this.decorators);
    this.layer.clearLayers();
    this.decorators.clearLayers();
    this.lastKey = '';
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;
    if (!this.canShow(map)) {
      this.syncVisibility(map);
      return;
    }

    this.syncVisibility(map);

    const b = map.getBounds();
    const z = map.getZoom();
    const bbox = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;

    const key = `${bbox}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const requestId = ++this.requestSeq;

    this.api.getLandOffset(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        if (!geojson) return;

        const fc =
          geojson.type === 'Feature'
            ? { type: 'FeatureCollection', features: [geojson] }
            : geojson;

        fc.features = (fc.features ?? []).map((f: any) => ({
          ...f,
          properties: f?.properties ?? f?.attributes ?? {},
        }));

        this.onData?.(fc);

        if (z < this.minZoom) {
          this.layer.clearLayers();
          this.decorators.clearLayers();
          return;
        }

        this.layer.clearLayers();
        this.decorators.clearLayers();
        this.layer.addData(fc);

        if (z < this.DECORATOR_ZOOM) {
          return;
        }

        this.layer.eachLayer((lyr: any) => {
          if (!(lyr instanceof L.Polyline) || lyr instanceof L.Polygon) return;

          const decorator = (L as any).polylineDecorator(lyr, {
            patterns: [
              {
                offset: '0%',
                repeat: 0,
                symbol: (L as any).Symbol.arrowHead({
                  pixelSize: 10,
                  polygon: true,
                  pathOptions: { color: this.legend.strokeColor || this.legend.color, fillColor: this.legend.strokeColor || this.legend.color, opacity: 1 },
                }),
              },
              {
                offset: '100%',
                repeat: 0,
                symbol: (L as any).Symbol.arrowHead({
                  pixelSize: 10,
                  polygon: true,
                  pathOptions: { color: this.legend.strokeColor || this.legend.color, fillColor: this.legend.strokeColor || this.legend.color, opacity: 1 },
                }),
              },
            ],
          });

          this.decorators.addLayer(decorator);
        });
      },
      error: (err: any) => console.error('Land Offset error', err),
    });
  }
}

export class LandBoundaryLayer implements MapLayer {
  id = 'landboundary';
  title = 'Land Boundary';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = 13;

  legend = LAND_BOUNDARY_LEGEND;

  private layer!: L.GeoJSON;
  private lastBbox = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private requestSeq = 0;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: pathStyleFromLegend(this.legend),
    });
  }

  private canShow(map: L.Map) {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map) {
    if (!this.onZoomEndHandler) {
      this.onZoomEndHandler = () => {
        if (this.canShow(map)) {
          if (!map.hasLayer(this.layer)) this.layer.addTo(map);
        } else if (map.hasLayer(this.layer)) {
          map.removeLayer(this.layer);
        }
      };
    }

    if (!this.isOnMap) {
      map.on('zoomend', this.onZoomEndHandler);
      this.isOnMap = true;
    }

    if (this.canShow(map)) {
      if (!map.hasLayer(this.layer)) this.layer.addTo(map);
    }
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.isOnMap = false;
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    const z = map.getZoom();
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;

    if (bbox === this.lastBbox) {
      if (z < this.minZoom) {
        this.layer.clearLayers();
      } else {
        if (!map.hasLayer(this.layer)) this.layer.addTo(map);
      }
      return;
    }
    this.lastBbox = bbox;
    const requestId = ++this.requestSeq;

    this.api.getlandboundary(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.onData?.(geojson);

        if (z < this.minZoom) {
          this.layer.clearLayers();
          return;
        }

        if (!map.hasLayer(this.layer)) this.layer.addTo(map);
        this.layer.clearLayers();
        this.layer.addData(geojson);
      },
      error: (err: any) => console.error('Land Boundary layer error', err),
    });
  }
}

export class DynamicDepartmentLayer implements MapLayer {
  visible = true;
  layerGroup = 'department' as const;
  legend = DEFAULT_DYNAMIC_LEGEND;

  private layer: L.GeoJSON;
  private lastBbox = '';
  private requestSeq = 0;
  private added = false;
  private readonly minZoom: number;
  private onZoomEndHandler?: () => void;

  constructor(
    public id: string,
    public title: string,
    private api: Api,
    private departmentRef: string,
    private layerKey: string,
    private onData?: (geojson: any) => void
  ) {
    this.minZoom = inferMinZoomFromTitle(title);
    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      pointToLayer: (_feature: any, latlng: L.LatLng) =>
        pointLayerFromLegend(this.legend, latlng),
      onEachFeature: (feature: any, layer: any) => {
        const props = feature?.properties || {};
        const firstKeys = Object.keys(props).slice(0, 5);
        if (!firstKeys.length) return;
        const html = firstKeys
          .map((key) => `<b>${key}</b>: ${props[key] ?? '-'}`)
          .join('<br>');
        layer.bindPopup(html);
      },
    });
  }

  private canShow(map: L.Map): boolean {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map): void {
    if (!this.visible || this.added) return;
    if (!this.onZoomEndHandler) {
      this.onZoomEndHandler = () => {
        if (this.canShow(map)) {
          if (!map.hasLayer(this.layer)) this.layer.addTo(map);
          this.added = true;
        } else if (map.hasLayer(this.layer)) {
          map.removeLayer(this.layer);
          this.added = false;
        }
      };
      map.on('zoomend', this.onZoomEndHandler);
    }

    if (!this.canShow(map)) return;
    this.layer.addTo(map);
    this.added = true;
  }

  removeFrom(map: L.Map): void {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
      this.onZoomEndHandler = undefined;
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.added = false;
  }

  loadForMap(map: L.Map): void {
    if (!this.visible) return;

    this.addTo(map);
    if (!this.canShow(map)) {
      this.lastBbox = '';
      this.layer.clearLayers();
      return;
    }

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    if (bbox === this.lastBbox) return;
    this.lastBbox = bbox;
    const requestId = ++this.requestSeq;

    this.api.getDepartmentLayerData(this.departmentRef, this.layerKey, bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.legend = inferLegendFromFeatureCollection(this.title, geojson);
        this.layer.clearLayers();
        this.layer.addData(geojson);
        if (this.legend.type !== 'polygon') {
          this.layer.bringToFront();
        }
        this.onData?.(geojson);
      },
      error: (err: any) => console.error(`Dynamic department layer error (${this.layerKey})`, err),
    });
  }
}