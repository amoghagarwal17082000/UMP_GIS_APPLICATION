import { GeoJsonObject } from 'geojson';
import * as L from 'leaflet';
import 'leaflet-polylinedecorator';
import { NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { Api } from '../../../api/api';
import { LayerLegend, defineLegend, MapLayer, pathStyleFromLegend, pointLayerFromLegend, buildClusteredPointLayers } from '../../../services/interface';
import { inferCivilLegendFromFeatureCollection } from '../../../components/legend-panel/legend-panel';
import { bindAssetDetailsPopup } from '../../../components/asset-popup/asset-popup';
import { getStationCategoryIconConfig, normalizeStationCategory } from './station-category-config';
import { StationCategoryVisibilityService } from '../../../services/station-category-visibility';
import { isPortalAdminUser } from '../../../api/shared/api-utils';


const STATION_LEGEND: LayerLegend = defineLegend({
  type: 'point' as const,
  color: '#d32f2f',
  label: 'Railway Station',
  fillColor: '#d32f2f',
  fillOpacity: 0.9,
  strokeColor: '#ffffff',
  strokeWidth: 1,
  radius: 6,
  symbolKind: 'circle' as const,
  imageUrl: 'assets/images/download.png',
  imageWidth: 23,
  imageHeight: 23,
});

const STATION_CATEGORY_ZOOM_TIERS = [
  ['NSG1', 'NSG2', 'A1', 'A'],
  ['NSG3', 'SG1', 'B'],
  ['NSG4', 'NSG5', 'SG2', 'C'],
  ['NSG6', 'SG3', 'HG1', 'D'],
  ['HG2', 'HG3', 'E', 'F', 'NOT DEFINED'],
] as const;

const STATION_CATEGORY_ZOOM_BREAKS = [5, 7, 8.5, 10, 11.5];




const LANDPLAN_ONTRACK_LEGEND = defineLegend({
  type: 'polygon' as const,
  color: '#FFA500',
  label: 'Landplan Ontrack',
  fillColor: '#fff59d',
  fillOpacity: 0.3,
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
const TOWN_LEVEL_MIN_ZOOM = 10;

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

function bindAssetPopup(feature: any, layer: any, title: string, layerKey?: string): void {
  bindAssetDetailsPopup(layer, title, feature?.properties || {}, { layerKey });
}

function inferMinZoomFromTitle(title: string): number {
  const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.includes('station')) return 0;
  if (normalized.includes('track')) return 0;
  if (normalized.includes('km post')) return 0;
  return TOWN_LEVEL_MIN_ZOOM;
}

export class StationViewingLayer implements MapLayer {
  id = 'stations';
  title = 'Stations';
  visible = true;
  layerGroup = 'department' as const;

  protected readonly MIN_RENDER_ZOOM = 5;
  protected readonly LABEL_ZOOM = 12;

  legend: LayerLegend = STATION_LEGEND;

  protected layer: L.FeatureGroup;
  private lastBbox = '';
  private loadedBounds?: L.LatLngBounds;
  private lastCategoryKey = '';
  private isOnMap = false;
  private onMoveStartHandler?: () => void;
  private onMoveEndHandler?: () => void;
  private labelUpdateTimer: any = null;
  private requestSeq = 0;
  private visibilitySub?: Subscription;
  private lastGeojson: any = null;
  private lastMap?: L.Map;
  private responseCache = new Map<string, any>();
  private readonly MAX_RESPONSE_CACHE_SIZE = 12;

  private getBufferedBounds(map: L.Map): L.LatLngBounds {
    return map.getBounds().pad(0.5);
  }

  private rememberResponse(key: string, geojson: any): void {
    if (!key || !geojson) return;

    if (this.responseCache.has(key)) {
      this.responseCache.delete(key);
    }

    this.responseCache.set(key, geojson);

    while (this.responseCache.size > this.MAX_RESPONSE_CACHE_SIZE) {
      const oldestKey = this.responseCache.keys().next().value;
      if (!oldestKey) break;
      this.responseCache.delete(oldestKey);
    }
  }


  protected getStationRequestLimit(_map: L.Map): number | undefined {
    return undefined;
  }


  protected getStationLabel(feature: any): string {
    const p = feature?.properties || {};
    const name = (p.sttnname || '').toString().trim();
    const code = (p.sttncode || '').toString().trim();
    return code && name ? code + ' : ' + name : code || name;
  }

  protected getAllowedStationCategories(map: L.Map): Set<string> {
    if (!this.usesPortalAdminStationSymbols()) {
      return new Set(STATION_CATEGORY_ZOOM_TIERS.flat());
    }

    const zoom = map.getZoom();
    let maxTier = 0;

    for (let i = 0; i < STATION_CATEGORY_ZOOM_BREAKS.length; i += 1) {
      if (zoom >= STATION_CATEGORY_ZOOM_BREAKS[i]) {
        maxTier = i;
      }
    }

    const categories = STATION_CATEGORY_ZOOM_TIERS
      .slice(0, maxTier + 1)
      .flat();

    return new Set(categories);
  }

  protected bindStationTooltip(marker: L.Marker, label: string, permanent: boolean): void {
    if (!label || !marker.bindTooltip) return;
    const current = (marker as any).__stationTooltipState;
    if (current?.label === label && current?.permanent === permanent) return;
    if (marker.getTooltip?.()) marker.unbindTooltip();
    marker.bindTooltip(label, {
      permanent,
      direction: 'top',
      offset: L.point(0, -8),
      opacity: 0.95,
      className: 'station-label',
    });
    (marker as any).__stationTooltipState = { label, permanent };
  }

  protected forEachStationMarker(callback: (marker: any) => void): void {
    const visit = (layer: any): void => {
      if (!layer) return;
      if (layer.getLatLng && layer.bindTooltip) {
        callback(layer);
        return;
      }
      if (layer.eachLayer) {
        layer.eachLayer((child: any) => visit(child));
      }
    };

    this.layer.eachLayer((layer: any) => visit(layer));
  }

  constructor(
    protected api: Api,
    protected zone: NgZone,
    protected stationCategoryVisibility: StationCategoryVisibilityService,
    protected onData?: (geojson: any) => void,
  ) {
    this.layer = L.featureGroup();

    this.visibilitySub = this.stationCategoryVisibility.state$.subscribe(() => {
      if (!this.lastMap || !this.lastGeojson) return;
      this.zone.run(() => {
        this.renderStationFeatures(this.lastMap as L.Map, this.lastGeojson);
        this.scheduleLabelUpdate(this.lastMap as L.Map);
      });
    });
  }

  protected onMarkerCreated(_feature: any, _marker: L.Marker) { }

  protected onFeatureReady(_feature: any, _layer: any) { }

  addTo(map: L.Map) {
    if (this.visible && !this.isOnMap) {
      ensurePane(map, DEPARTMENT_POINT_PANE, 'auto');
      this.layer.addTo(map);
      this.isOnMap = true;

      if (!this.onMoveStartHandler) {
        this.onMoveStartHandler = () => this.closeLabels();
      }
      if (!this.onMoveEndHandler) {
        this.onMoveEndHandler = () => this.scheduleLabelUpdate(map);
      }
      map.on('zoomstart', this.onMoveStartHandler);
      map.on('movestart', this.onMoveStartHandler);
      map.on('moveend', this.onMoveEndHandler);
      map.on('zoomend', this.onMoveEndHandler);
      this.layer.bringToFront();
      this.updateLabels(map);
    }
  }

  removeFrom(map: L.Map) {
    if (this.labelUpdateTimer) {
      clearTimeout(this.labelUpdateTimer);
      this.labelUpdateTimer = null;
    }
    if (this.onMoveStartHandler) {
      map.off('zoomstart', this.onMoveStartHandler);
      map.off('movestart', this.onMoveStartHandler);
    }
    if (this.onMoveEndHandler) {
      map.off('moveend', this.onMoveEndHandler);
      map.off('zoomend', this.onMoveEndHandler);
    }
    this.onMoveStartHandler = undefined;
    this.onMoveEndHandler = undefined;
    if (this.labelUpdateTimer) clearTimeout(this.labelUpdateTimer);
    this.labelUpdateTimer = null;
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.lastMap = undefined;
    this.isOnMap = false;
  }

  protected closeLabels() {
    this.forEachStationMarker((l: any) => {
      const label = (l as any).__stationTooltipState?.label || '';
      if (!label) return;
      this.bindStationTooltip(l, label, false);
      if (l.getTooltip?.()) l.closeTooltip();
    });
  }

  protected scheduleLabelUpdate(map: L.Map) {
    if (this.labelUpdateTimer) clearTimeout(this.labelUpdateTimer);
    this.labelUpdateTimer = setTimeout(() => this.updateLabels(map), 180);
  }

  protected updateLabels(map: L.Map) {
    if (!this.isOnMap || !map || !map.getContainer || !map.getContainer()) return;
    if (!map.hasLayer(this.layer)) return;

    const show = map.getZoom() >= this.LABEL_ZOOM;
    const bounds = map.getBounds();
    const occupied: Array<{ x: number; y: number }> = [];
    const minDistancePx = 80;
    let shownCount = 0;
    const maxLabels = 120;

    this.forEachStationMarker((l: any) => {
      const label = (l as any).__stationTooltipState?.label || '';
      if (!label || !l.getLatLng) return;
      if (!map.hasLayer(l)) return;
      if (!show) {
        this.bindStationTooltip(l, label, false);
        l.closeTooltip();
        return;
      }
      const latlng = l.getLatLng();
      if (!bounds.contains(latlng)) {
        this.bindStationTooltip(l, label, false);
        l.closeTooltip();
        return;
      }
      let p: L.Point;
      try {
        p = map.latLngToContainerPoint(latlng);
      } catch {
        return;
      }
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const tooClose = occupied.some((q) => {
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        return dx * dx + dy * dy < minDistancePx * minDistancePx;
      });
      if (tooClose || shownCount >= maxLabels) {
        this.bindStationTooltip(l, label, false);
        l.closeTooltip();
        return;
      }
      occupied.push({ x: p.x, y: p.y });
      shownCount++;
      this.bindStationTooltip(l, label, true);
      l.openTooltip();
    });
  }

  protected beforeRender(_geojson: any) { }

  protected usesPortalAdminStationSymbols(): boolean {
    return isPortalAdminUser();
  }

  protected createStationMarker(feature: any, latlng: L.LatLng): L.Layer {
    const p = feature?.properties || {};
    const stationLabel = this.getStationLabel(feature);
    const iconConfig = this.usesPortalAdminStationSymbols()
      ? getStationCategoryIconConfig(p.category)
      : {
          imageUrl: this.legend.imageUrl || 'assets/images/download.png',
          imageWidth: this.legend.imageWidth || 23,
          imageHeight: this.legend.imageHeight || 23,
        };
    const iconWidth = iconConfig.imageWidth ?? this.legend.imageWidth ?? 20;
    const iconHeight = iconConfig.imageHeight ?? this.legend.imageHeight ?? 20;
    const iconUrl = iconConfig.imageUrl || this.legend.imageUrl || 'assets/images/download.png';

    const marker = L.marker(latlng, {
      pane: DEPARTMENT_POINT_PANE,
      keyboard: false,
      interactive: true,
      icon: L.divIcon({
        className: 'map-symbol-icon station-symbol-icon',
        html:
          '<img src="' +
          iconUrl +
          '" style="display:block;width:' +
          iconWidth +
          'px;height:' +
          iconHeight +
          'px;object-fit:contain;" alt="Station">',
        iconSize: [iconWidth, iconHeight],
        iconAnchor: [iconWidth / 2, iconHeight / 2],
        popupAnchor: [0, Math.round(iconHeight / 2) + 12],
      }),
    }) as any;

    this.onMarkerCreated(feature, marker as any);

    this.bindStationTooltip(marker as any, stationLabel, false);

    if (marker.bindPopup) {
      bindAssetDetailsPopup(marker, 'Station Details', p);
    }

    this.onFeatureReady(feature, marker);
    return marker;
  }

  protected getStationCategoryLegend(category: string): LayerLegend {
    const iconConfig = this.usesPortalAdminStationSymbols()
      ? getStationCategoryIconConfig(category)
      : {
          imageUrl: this.legend.imageUrl || 'assets/images/download.png',
          imageWidth: this.legend.imageWidth || 23,
          imageHeight: this.legend.imageHeight || 23,
        };

    return defineLegend({
      ...this.legend,
      imageUrl: iconConfig.imageUrl,
      imageWidth: iconConfig.imageWidth,
      imageHeight: iconConfig.imageHeight,
      label: this.usesPortalAdminStationSymbols()
        ? `Railway Station ${category}`
        : this.legend.label,
    });
  }



  protected renderStationFeatures(map: L.Map, geojson: any): void {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];

    if (!this.usesPortalAdminStationSymbols()) {
      this.layer.clearLayers();

      const stationLayer = L.geoJSON(
        { type: 'FeatureCollection', features } as any,
        {
          pointToLayer: (feature: any, latlng: L.LatLng) =>
            this.createStationMarker(feature, latlng),
        }
      );

      this.layer.addLayer(stationLayer);
      return;
    }

    const featuresByCategory = new Map<string, any[]>();
    const allowedCategories = this.getAllowedStationCategories(map);

    features.forEach((feature: any) => {
      const category = normalizeStationCategory(feature?.properties?.category);

      if (!allowedCategories.has(category)) return;
      if (!this.stationCategoryVisibility.isCategoryVisible(category)) return;

      const group = featuresByCategory.get(category) || [];
      group.push(feature);
      featuresByCategory.set(category, group);
    });

    this.layer.clearLayers();

    featuresByCategory.forEach((categoryFeatures, category) => {
      const layers = buildClusteredPointLayers({
        map,
        features: categoryFeatures,
        legend: this.getStationCategoryLegend(category),
        pointFactory: (feature: any, latlng: L.LatLng) =>
          this.createStationMarker(feature, latlng),
        clusterRadiusPx: 56,
        disableClusteringZoom: 13,
        minClusterCount: 12,
        clusterLabel: `${category} stations`,
      });

      layers.forEach((layer) => this.layer.addLayer(layer));
    });
  }



  protected isStationVisible(feature: any): boolean {
    const category = normalizeStationCategory(feature?.properties?.category);
    return this.stationCategoryVisibility.isCategoryVisible(category);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);


    if (map.getZoom() < this.MIN_RENDER_ZOOM) {
      this.lastBbox = '';
      this.lastCategoryKey = '';
      this.loadedBounds = undefined;
      this.lastGeojson = null;
      this.responseCache.clear();
      this.layer.clearLayers();
      return;
    }

    const categories = this.usesPortalAdminStationSymbols()
      ? Array.from(this.getAllowedStationCategories(map))
      : [];
    const categoryKey = categories.join(',');
    const currentBounds = map.getBounds();

    if (
      this.loadedBounds &&
      this.loadedBounds.contains(currentBounds) &&
      this.lastCategoryKey === categoryKey &&
      this.lastGeojson
    ) {
      this.renderStationFeatures(map, this.lastGeojson);
      this.scheduleLabelUpdate(map);
      return;
    }

    const b = this.getBufferedBounds(map);
    const bbox = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
    const requestKey = `${bbox}|${categoryKey}`;

    const cachedGeojson = this.responseCache.get(requestKey);
    if (cachedGeojson) {
      this.lastBbox = requestKey;
      this.lastCategoryKey = categoryKey;
      this.loadedBounds = b;
      this.lastGeojson = cachedGeojson;
      this.lastMap = map;
      this.renderStationFeatures(map, cachedGeojson);
      this.scheduleLabelUpdate(map);
      return;
    }

    if (requestKey === this.lastBbox) return;
    this.lastBbox = requestKey;
    this.lastCategoryKey = categoryKey;
    const requestId = ++this.requestSeq;

    const limit = this.getStationRequestLimit(map);

    this.api.getStations(bbox, limit, categories).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.loadedBounds = b;
        this.lastGeojson = geojson;
        this.lastMap = map;
        this.rememberResponse(requestKey, geojson);
        this.zone.run(() => {
          this.beforeRender(geojson);
          this.renderStationFeatures(map, geojson);
          this.onData?.(geojson);
          this.scheduleLabelUpdate(map);
        });
      },
      error: (err: any) => console.error('Station layer error', err),
    });
  }

  destroy(): void {
    this.visibilitySub?.unsubscribe();
    this.visibilitySub = undefined;
    this.lastGeojson = null;
    this.lastMap = undefined;
    this.responseCache.clear();
  }
}


export class LandPlanOntrackViewingLayer implements MapLayer {
  id = 'landplan_ontrack';
  title = 'Landplan Ontrack';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = TOWN_LEVEL_MIN_ZOOM;

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
        bindAssetPopup(feature, layer, this.title);
        this.onFeatureReady(feature, layer);
      },
    });
  }

  protected isInteractive(): boolean {
    return true;
  }

  protected panePointerEvents(): string {
    return 'none';
  }

  protected onFeatureReady(_feature: any, _layer: any): void { }

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

    this.syncVisibility(map);

    if (!this.canShow(map)) {
      this.lastKey = '';
      this.layer.clearLayers();
      return;
    }

    const zActual = map.getZoom();
    const zForQuery = Math.max(zActual);
    const key = `${zForQuery}`;

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
  visible = false;
  layerGroup = 'department' as const;

  minZoom = TOWN_LEVEL_MIN_ZOOM;

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
      interactive: this.isInteractive(),
      onEachFeature: (feature: any, layer: any) => {
        bindAssetPopup(feature, layer, this.title);
        this.onFeatureReady(feature, layer);
      },
    });
  }

  protected isInteractive(): boolean {
    return true;
  }

  protected onFeatureReady(_feature: any, _layer: any): void { }

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

    this.syncVisibility(map);

    if (!this.canShow(map)) {
      this.lastKey = '';
      this.layer.clearLayers();
      this.decorators.clearLayers();
      return;
    }

    const b = map.getBounds();
    const z = map.getZoom();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const bboxKey = `${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}`;

    const key = `${bboxKey}`;
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

  minZoom = TOWN_LEVEL_MIN_ZOOM;

  legend = LAND_BOUNDARY_LEGEND;

  private layer!: L.GeoJSON;
  private lastBbox = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private requestSeq = 0;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: pathStyleFromLegend(this.legend),
      interactive: this.isInteractive(),
      onEachFeature: (feature: any, layer: any) => {
        bindAssetPopup(feature, layer, this.title);
        this.onFeatureReady(feature, layer);
      },
    });
  }

  protected isInteractive(): boolean {
    return true;
  }

  protected onFeatureReady(_feature: any, _layer: any): void { }

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

    if (!this.canShow(map)) {
      this.lastBbox = '';
      this.layer.clearLayers();
      if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
      return;
    }

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const bboxKey = `${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}`;

    if (bboxKey === this.lastBbox) {
      if (z < this.minZoom) {
        this.layer.clearLayers();
      } else {
        if (!map.hasLayer(this.layer)) this.layer.addTo(map);
      }
      return;
    }
    this.lastBbox = bboxKey;
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
  private loadedBounds?: L.LatLngBounds;
  private requestSub?: Subscription;
  private readonly minZoom: number;
  private onZoomEndHandler?: () => void;
  private renderedPointIndex = new Map<string, L.LatLng>();
  private renderedPointFeatures: Array<{ props: Record<string, any>; latLng: L.LatLng; layer?: any }> = [];

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
      interactive: this.isInteractive(),
      pointToLayer: (_feature: any, latlng: L.LatLng) =>
        pointLayerFromLegend(this.legend, latlng, paneNameForLegend(this.legend)),
      onEachFeature: (feature: any, layer: any) => {
        bindAssetPopup(feature, layer, this.title, this.layerKey);
        this.onFeatureReady(feature, layer);
      },
    });
  }

  private isBridgeMinorLayer(): boolean {
    return String(this.layerKey || this.id || '').toLowerCase().includes('bridge_minor');
  }

  private getBufferedBounds(map: L.Map): L.LatLngBounds {
    return map.getBounds().pad(0.3);
  }

  private getRequestLimit(): number | undefined {
    return this.isBridgeMinorLayer() ? 3000 : undefined;
  }

  protected isInteractive(): boolean {
    return true;
  }

  protected onFeatureReady(_feature: any, _layer: any): void { }

  getRenderedLatLngForKey(...keys: Array<string | number | null | undefined>): L.LatLng | null {
    for (const key of keys) {
      const normalized = String(key ?? '').trim().toLowerCase();
      if (!normalized) continue;
      const latLng = this.renderedPointIndex.get(normalized);
      if (latLng) return latLng;
    }
    return null;
  }

  getBestRenderedLatLng(row: any): L.LatLng | null {
    if (!row || !this.renderedPointFeatures.length) return null;

    const normalize = (value: any) => String(value ?? '').trim().toLowerCase();
    const normalizeNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) ? String(num) : '';
    };

    let bestScore = 0;
    let bestLatLng: L.LatLng | null = null;

    for (const candidate of this.renderedPointFeatures) {
      const props = candidate.props || {};
      let score = 0;

      const rowObjectId = normalizeNumber(row?.objectid);
      const propObjectId = normalizeNumber(props?.objectid || props?.OBJECTID);
      if (rowObjectId && propObjectId && rowObjectId === propObjectId) score += 100;

      const rowGid = normalizeNumber(row?.gid);
      const propGid = normalizeNumber(props?.gid);
      if (rowGid && propGid && rowGid === propGid) score += 100;

      const rowAssetId = normalize(row?.asset_id || row?.assetid);
      const propAssetId = normalize(props?.asset_id || props?.assetid);
      if (rowAssetId && propAssetId && rowAssetId === propAssetId) score += 80;

      const rowBridgeNo = normalize(row?.bridgeno || row?.rorno);
      const propBridgeNo = normalize(props?.bridgeno || props?.rorno);
      if (rowBridgeNo && propBridgeNo && rowBridgeNo === propBridgeNo) score += 50;

      const rowLine = normalize(row?.line);
      const propLine = normalize(props?.line);
      if (rowLine && propLine && rowLine === propLine) score += 40;

      const rowDistKm = normalizeNumber(row?.distkm);
      const rowDistM = normalizeNumber(row?.distm);
      const candidateKmValues = [
        normalizeNumber(props?.distkm),
        normalizeNumber(props?.kmfrom),
        normalizeNumber(props?.kmto),
      ].filter(Boolean);
      const candidateMValues = [
        normalizeNumber(props?.distm),
        normalizeNumber(props?.metfrom),
        normalizeNumber(props?.metto),
      ].filter(Boolean);
      if (rowDistKm && candidateKmValues.includes(rowDistKm)) score += 25;
      if (rowDistM && candidateMValues.includes(rowDistM)) score += 25;

      const rowState = normalize(row?.state);
      const propState = normalize(props?.state);
      if (rowState && propState && rowState === propState) score += 10;

      const rowDistrict = normalize(row?.district);
      const propDistrict = normalize(props?.district);
      if (rowDistrict && propDistrict && rowDistrict === propDistrict) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestLatLng = candidate.latLng;
      }
    }

    return bestScore > 0 ? bestLatLng : null;
  }

  getBestRenderedLayer(row: any): any | null {
    if (!row || !this.renderedPointFeatures.length) return null;

    const normalize = (value: any) => String(value ?? '').trim().toLowerCase();
    const normalizeNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) ? String(num) : '';
    };

    let bestScore = 0;
    let bestLayer: any | null = null;

    for (const candidate of this.renderedPointFeatures) {
      const props = candidate.props || {};
      let score = 0;

      const rowObjectId = normalizeNumber(row?.objectid);
      const propObjectId = normalizeNumber(props?.objectid || props?.OBJECTID);
      if (rowObjectId && propObjectId && rowObjectId === propObjectId) score += 100;

      const rowGid = normalizeNumber(row?.gid);
      const propGid = normalizeNumber(props?.gid);
      if (rowGid && propGid && rowGid === propGid) score += 100;

      const rowAssetId = normalize(row?.asset_id || row?.assetid);
      const propAssetId = normalize(props?.asset_id || props?.assetid);
      if (rowAssetId && propAssetId && rowAssetId === propAssetId) score += 80;

      const rowBridgeNo = normalize(row?.bridgeno || row?.rorno);
      const propBridgeNo = normalize(props?.bridgeno || props?.rorno);
      if (rowBridgeNo && propBridgeNo && rowBridgeNo === propBridgeNo) score += 50;

      const rowLine = normalize(row?.line);
      const propLine = normalize(props?.line);
      if (rowLine && propLine && rowLine === propLine) score += 40;

      const rowDistKm = normalizeNumber(row?.distkm);
      const rowDistM = normalizeNumber(row?.distm);
      const candidateKmValues = [
        normalizeNumber(props?.distkm),
        normalizeNumber(props?.kmfrom),
        normalizeNumber(props?.kmto),
      ].filter(Boolean);
      const candidateMValues = [
        normalizeNumber(props?.distm),
        normalizeNumber(props?.metfrom),
        normalizeNumber(props?.metto),
      ].filter(Boolean);
      if (rowDistKm && candidateKmValues.includes(rowDistKm)) score += 25;
      if (rowDistM && candidateMValues.includes(rowDistM)) score += 25;

      const rowState = normalize(row?.state);
      const propState = normalize(props?.state);
      if (rowState && propState && rowState === propState) score += 10;

      const rowDistrict = normalize(row?.district);
      const propDistrict = normalize(props?.district);
      if (rowDistrict && propDistrict && rowDistrict === propDistrict) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestLayer = candidate.layer || null;
      }
    }

    return bestScore > 0 ? bestLayer : null;
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
          this.lastBbox = '';
          this.loadedBounds = undefined;
          this.layer.clearLayers();
        }
      };
      map.on('zoomend', this.onZoomEndHandler);
    }

    if (!this.canShow(map)) return;
    ensurePane(map, paneNameForLegend(this.legend), 'auto');
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
    this.lastBbox = '';
    this.loadedBounds = undefined;
    this.requestSub?.unsubscribe();
    this.requestSub = undefined;
  }

  loadForMap(map: L.Map): void {
    if (!this.visible) return;

    this.addTo(map);

    if (!this.canShow(map)) {
      this.lastBbox = '';
      this.loadedBounds = undefined;
      this.requestSub?.unsubscribe();
      this.requestSub = undefined;
      this.layer.clearLayers();
      return;
    }

    const currentBounds = map.getBounds();
    if (this.loadedBounds?.contains(currentBounds)) return;

    const b = this.getBufferedBounds(map);
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const bboxKey = `${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}`;
    if (bboxKey === this.lastBbox) return;
    this.lastBbox = bboxKey;
    const requestId = ++this.requestSeq;

    this.requestSub?.unsubscribe();
    this.requestSub = this.api.getDepartmentLayerData(this.departmentRef, this.layerKey, bbox, this.getRequestLimit()).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.loadedBounds = b;
        this.legend = inferCivilLegendFromFeatureCollection(this.title, this.layerKey, geojson);
        ensurePane(map, paneNameForLegend(this.legend), 'auto');
        this.onData?.(geojson);
        this.renderedPointIndex.clear();
        this.renderedPointFeatures = [];

        if (!this.canShow(map)) {
          this.layer.clearLayers();
          return;
        }

        this.layer.clearLayers();
        this.layer.addData(geojson);
        this.layer.eachLayer((featureLayer: any) => {
          const feature = featureLayer?.feature;
          const props = feature?.properties ?? {};
          const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null;
          const lng = Number(coords?.[0]);
          const lat = Number(coords?.[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const latLng = L.latLng(lat, lng);
          this.renderedPointFeatures.push({ props, latLng, layer: featureLayer });
          const candidateKeys = [
            props?.objectid,
            props?.OBJECTID,
            props?.gid,
            props?.asset_id,
            props?.assetid,
            feature?.id,
          ];
          candidateKeys.forEach((key) => {
            const normalized = String(key ?? '').trim().toLowerCase();
            if (!normalized) return;
            this.renderedPointIndex.set(normalized, latLng);
          });
        });
        if (this.legend.type !== 'polygon') {
          this.layer.bringToFront();
        }
      },
      error: (err: any) => {
        if (requestId === this.requestSeq) {
          this.lastBbox = '';
          this.loadedBounds = undefined;
        }
        console.error(`Dynamic department layer error (${this.layerKey})`, err);
      },
    });
  }
}


























