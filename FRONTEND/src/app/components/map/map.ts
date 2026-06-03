import { Component, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationSearchComponent } from '../station-search/station-search.component';
import { MeasurementToolComponent } from '../measurement-tool/measurement-tool';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ActivatedRoute, Router, NavigationStart } from '@angular/router';

import { Api } from '../../api/api';
import {
  DynamicDepartmentEditLayer,
  LandBoundaryEditLayer,
  LandOffsetEditLayer,
  LandPlanOntrackLayer,
  normalizeCivilEngineeringLayerId,
  StationLayer,
} from '../../departments/civil_engineering_assets/editing/civil-engineering-assets-editing';
import {
  LandBoundaryLayer,
  LandOffsetLayer,
  LandPlanOntrackViewingLayer,
  StationViewingLayer,
} from '../../departments/civil_engineering_assets/viewing/civil-engineering-assets-viewing';
import {
  DivisionBufferLayer,
  IndiaBoundaryLayer,
  KmPostLayer,
  TrackLayer,
} from '../../departments/common';

import { LayerManager } from '../../services/layer-manager';
import { MapRegistry } from '../../services/map-registry';
import { FilterState } from '../../services/filter-state';
import { EditState } from '../../services/edit-state';
import { AttributeTableService, LayerKey } from '../../services/attribute-table';
import { UiState } from '../../services/ui-state';
import { CurrentUserService } from '../../services/current-user';
import { MapZoomService, ZoomTarget } from '../../services/map-zoom';
import { Station } from '../../services/station.service';
import { FileUploadService } from '../../services/file-upload.service';
import { AppAlertService } from '../../services/app-alert.service';
import { StationCategoryVisibilityService } from '../../services/station-category-visibility';

type EditableLayer = string | null;
type DepartmentModuleKey = 'civil_engineering_assets' | 'civil_engineering_assets_offtrack' | 'unknown';
type DepartmentLayerMeta = {
  layerName: string;
  layerKey: string;
  tableName?: string | null;
  department?: string;
  departmentId?: string;
};

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [
    CommonModule,
    StationSearchComponent,
    MeasurementToolComponent,
  ],
  templateUrl: './map.html',
  styleUrl: './map.css',
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private readonly performanceBodyClass = 'map-performance-mode';
  private map?: L.Map;
  private zoomSub?: Subscription;
  private clearSelectionSub?: Subscription;
  private highlightLayer?: L.GeoJSON;
  private onMoveOrZoom?: () => void;
  private sidebarSub?: Subscription;
  private dragMarker?: L.Marker;
  private lockDragSub?: Subscription;
  private mapZoomSub?: Subscription;
  private zoomHighlight?: L.Layer;
  private homeCenter?: L.LatLng;
  private homeZoom?: number;
  private homeCaptured = false;
  private editSuppressionSub?: Subscription;
  private shapefileUploadSub?: Subscription;
  private editAwareLayerModeKey = '';
  private editSuppressionKey = '';
  private suppressedVis = new globalThis.Map<string, boolean>();
  private readonly LAND_OFFSET_ID = 'land_offset';
  private readonly EDIT_BASE_LAYER_IDS = new Set(['stations', 'landboundary']);
  private reloadTimer: any = null;
  private suppressedReloadTimer: any = null;
  private routeSub?: Subscription;
  private createStationDblClickHandler?: (e: L.LeafletMouseEvent) => void;
  private createPointMouseMoveHandler?: (e: L.LeafletMouseEvent) => void;
  private createPointHintMarker?: L.Marker;
  private selectedStationMarker?: L.Layer;
  private highlightedMarkerElement?: HTMLElement | null;
  private highlightedMarkerLayer?: any;
  private suppressReloadUntil = 0;
  private initialLayerLoadStarted = false;

  private readonly departmentAliases: Record<string, DepartmentModuleKey> = {
    'civil engineering assets': 'civil_engineering_assets',
    'civil engineering assets offtrack': 'civil_engineering_assets_offtrack',
    civil_engineering_assets: 'civil_engineering_assets',
    civil_engineering_assets_offtrack: 'civil_engineering_assets_offtrack',
  };

  private readonly commonAttributeTabs: LayerKey[] = ['Km Post', 'Railway Track'];
  private readonly builtInDepartmentLayerKeys = new Set([
    'station',
    'landplan_ontrack',
    'landplan',
    'land_boundary',
    'land_offset',
    'division_buffer',
    'km_post',
    'india_railway_track',
    'railway_track',
  ]);

  constructor(
    private api: Api,
    private filters: FilterState,
    private edit: EditState,
    private zone: NgZone,
    private mapRegistry: MapRegistry,
    private layerManager: LayerManager,
    private attrTable: AttributeTableService,
    public ui: UiState,
    private currentUser: CurrentUserService,
    private mapZoom: MapZoomService,
    private fileUploadService: FileUploadService,
    private route: ActivatedRoute,
    private router: Router,
    private alerts: AppAlertService,
    private stationCategoryVisibility: StationCategoryVisibilityService
  ) {}

  ngAfterViewInit(): void {
    document.body.classList.add(this.performanceBodyClass);
    this.shapefileUploadSub?.unsubscribe();
    this.shapefileUploadSub = this.fileUploadService.shapefileUploaded$.subscribe(({ layerName }) => {
      this.refreshAfterShapefileUpload(layerName);
    });

    const cachedUser = this.currentUser.getSnapshot();
    const userPromise = cachedUser?.user_id
      ? Promise.resolve(cachedUser)
      : this.currentUser.loadMe(true);

    void userPromise.then((user) => {
      if (!user?.user_id) {
        this.zone.run(() => {
          this.router.navigateByUrl('/login');
        });
        return;
      }

      this.zone.runOutsideAngular(() => {
        requestAnimationFrame(() => this.initializeMapSafely());
      });

      if (cachedUser?.user_id) {
        void this.currentUser.loadMe(true);
      }
    });
  }

  private forceMapResize(): void { if (!this.map) return; this.map.invalidateSize(); requestAnimationFrame(() => this.map?.invalidateSize()); setTimeout(() => this.map?.invalidateSize(), 350); }
  private scheduleReload(): void { if (!this.map || !this.initialLayerLoadStarted) return; if (Date.now() < this.suppressReloadUntil) { this.scheduleReloadAfterSuppression(); return; } if (this.reloadTimer) clearTimeout(this.reloadTimer); this.reloadTimer = setTimeout(() => { if (!this.map) return; if (Date.now() < this.suppressReloadUntil) { this.scheduleReloadAfterSuppression(); return; } this.layerManager.reloadVisible(this.map); }, 180); }
  private scheduleReloadAfterProgrammaticZoom(): void { setTimeout(() => this.scheduleReload(), 220); }
  private scheduleReloadAfterSuppression(): void {
    if (!this.map) return;
    if (this.suppressedReloadTimer) clearTimeout(this.suppressedReloadTimer);
    const delay = Math.max(40, this.suppressReloadUntil - Date.now() + 40);
    this.suppressedReloadTimer = setTimeout(() => {
      this.suppressedReloadTimer = null;
      if (!this.map || Date.now() < this.suppressReloadUntil) return;
      this.layerManager.reloadVisible(this.map);
    }, delay);
  }

  private isPortalAdmin(): boolean {
    const user = this.currentUser.getSnapshot();
    const userId = String(user?.user_id || '').trim().toLowerCase();
    const userType = String(user?.user_type || '').trim().toLowerCase();
    return userId === 'portaladmin' || userType === 'portaladmin' || userType === 'portal admin';
  }

  private getInitialMapView(): { center: L.LatLngExpression; zoom: number } {
    return this.isPortalAdmin()
      ? { center: [22.5, 79], zoom: 5.2 }
      : { center: [22.5, 79], zoom: 8.5 };
  }

  private captureHomeAfterFirstSettle(): void {
    if (!this.map || this.homeCaptured) return;
    const initialView = this.getInitialMapView();
    const initialCenter = L.latLng(initialView.center); const initialZoom = initialView.zoom;
    const isInitialView = () => { if (!this.map) return true; const z = this.map.getZoom(); const c = this.map.getCenter(); return Math.abs(z - initialZoom) < 0.05 && c.distanceTo(initialCenter) < 50000; };
    const trySave = () => { if (!this.map || this.homeCaptured || isInitialView()) return; this.homeCenter = this.map.getCenter(); this.homeZoom = this.map.getZoom(); this.homeCaptured = true; this.map.off('moveend', trySave); this.map.off('zoomend', trySave); };
    this.map.on('moveend', trySave); this.map.on('zoomend', trySave);
    let tries = 0;
    const timer = setInterval(() => { if (!this.map || this.homeCaptured) { clearInterval(timer); return; } tries++; trySave(); if (tries >= 30) { clearInterval(timer); this.map.off('moveend', trySave); this.map.off('zoomend', trySave); } }, 200);
  }

  private zoomToHome(): void { if (!this.map) return; if (!this.homeCaptured || !this.homeCenter || typeof this.homeZoom !== 'number') return; this.map.invalidateSize(); this.map.setView(this.homeCenter, this.homeZoom, { animate: false }); }

  private startInitialLayerLoad(): void {
    if (!this.map || this.initialLayerLoadStarted) return;
    this.initialLayerLoadStarted = true;
    this.layerManager.applyVisibility(this.map);
    this.layerManager.reloadVisible(this.map);
  }
  private clearExistingMarkerHighlight(): void {
    if (this.highlightedMarkerElement) {
      this.highlightedMarkerElement.classList.remove('map-selected-symbol');
      this.highlightedMarkerElement.classList.remove('map-selected-station-symbol');
      this.highlightedMarkerElement = null;
    }
    if (this.highlightedMarkerLayer) {
      (this.highlightedMarkerLayer as any).__selectedStation = false;
      const label = String((this.highlightedMarkerLayer as any).__stationTooltipState?.label || '').trim();
      if (label && this.highlightedMarkerLayer?.bindTooltip) {
        this.highlightedMarkerLayer?.unbindTooltip?.();
        this.highlightedMarkerLayer.bindTooltip(label, {
          permanent: false,
          direction: 'top',
          offset: L.point(0, -8),
          opacity: 0.95,
          className: 'station-label',
        });
        (this.highlightedMarkerLayer as any).__stationTooltipState = { label, permanent: false };
        this.highlightedMarkerLayer?.closeTooltip?.();
      }
    }
    this.highlightedMarkerLayer?.setZIndexOffset?.(0);
    this.highlightedMarkerLayer = undefined;
  }
  private applyExistingMarkerHighlight(layer: any): boolean {
    const element = layer?.getElement?.() as HTMLElement | null;
    if (!element) return false;
    this.clearExistingMarkerHighlight();
    layer?.setZIndexOffset?.(5000);
    layer?.bringToFront?.();
    element.classList.add('map-selected-symbol');
    const isStationMarker = element.classList.contains('station-symbol-icon') || !!element.querySelector?.('.station-symbol-icon');
    if (isStationMarker) {
      element.classList.add('map-selected-station-symbol');
      const tooltip = layer?.getTooltip?.();
      const selectedStationLabel = String((layer as any).__stationTooltipState?.label || tooltip?.getContent?.() || '').trim();
      (layer as any).__selectedStation = true;
      if (selectedStationLabel) {
        const label = selectedStationLabel;
        layer?.unbindTooltip?.();
        layer?.bindTooltip?.(label, {
          permanent: true,
          direction: 'top',
          offset: L.point(0, -8),
          opacity: 0.95,
          className: 'station-label station-label-selected',
        });
        (layer as any).__stationTooltipState = { label, permanent: true };
        layer?.openTooltip?.();
      }
      if (this.map && layer?.getLatLng) {
        this.zoomHighlight = this.createFocusCircleMarker(layer.getLatLng()).addTo(this.map);
      }
    }
    this.highlightedMarkerElement = element;
    this.highlightedMarkerLayer = layer;
    return true;
  }
  private clearZoomArtifacts(): void { if (!this.map) return; this.clearExistingMarkerHighlight(); if (this.zoomHighlight && this.map.hasLayer(this.zoomHighlight as any)) this.map.removeLayer(this.zoomHighlight as any); this.zoomHighlight = undefined; if (this.highlightLayer && this.map.hasLayer(this.highlightLayer)) this.map.removeLayer(this.highlightLayer); this.highlightLayer = undefined; if (this.dragMarker && this.map.hasLayer(this.dragMarker as any)) { this.dragMarker.off(); this.map.removeLayer(this.dragMarker as any); } this.dragMarker = undefined; }

  private createAttributeHighlightLayer(feature: any): L.GeoJSON {
    return L.geoJSON(feature, {
      pointToLayer: (_feature: any, latlng: L.LatLng) =>
        L.circleMarker(latlng, {
          radius: 12,
          weight: 4,
          color: '#7c3aed',
          fillColor: '#a78bfa',
          fillOpacity: 0.45,
        }),
      style: () => ({
        color: '#7c3aed',
        weight: 6,
        opacity: 1,
        fillColor: '#a78bfa',
        fillOpacity: 0.28,
      }),
    });
  }

  private bringHighlightToFront(layer?: L.GeoJSON): void {
    if (!layer) return;
    (layer as any).bringToFront?.();
    layer.eachLayer((child: any) => child?.bringToFront?.());
  }

  private createDraggableCircleMarker(ll: L.LatLng): L.Marker {
    const size = 34; const border = 5;
    const icon = L.divIcon({ className: 'drag-circle-icon', html: `<div style="width:${size}px;height:${size}px;border:${border}px solid #7c3aed;background: rgba(167,139,250,0.60);border-radius: 50%;box-sizing: border-box;box-shadow: 0 2px 10px rgba(0,0,0,0.25);"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const m = L.marker(ll, { draggable: true, icon, keyboard: false, autoPan: true, autoPanPadding: L.point(40, 40) });
    (m as any).setZIndexOffset?.(9999);
    return m;
  }

  private createFocusCircleMarker(ll: L.LatLng, size = 34, border = 3, fillOpacity = 0.28): L.Marker {
    this.ensureFocusHighlightPane();
    const icon = L.divIcon({
      className: 'focus-circle-icon',
      html: `<div style="width:${size}px;height:${size}px;border:${border}px solid #7c3aed;background: rgba(167,139,250,${fillOpacity.toFixed(2)});border-radius: 50%;box-sizing: border-box;box-shadow: 0 1px 6px rgba(0,0,0,0.14);pointer-events:none;"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    const marker = L.marker(ll, { draggable: false, icon, keyboard: false, interactive: false, pane: 'FocusHighlightPane' });
    return marker;
  }

  private ensureFocusHighlightPane(): void {
    if (!this.map) return;
    if (!this.map.getPane('FocusHighlightPane')) {
      this.map.createPane('FocusHighlightPane');
    }
    const pane = this.map.getPane('FocusHighlightPane');
    if (!pane) return;
    pane.style.zIndex = '500';
    pane.style.pointerEvents = 'none';
  }

  private createSelectedZoomLabel(ll: L.LatLng, label: string): L.Marker {
    const safeLabel = String(label || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char] || char));
    const icon = L.divIcon({
      className: 'selected-asset-label-icon',
      html: `<div class="selected-asset-label">${safeLabel}</div>`,
      iconSize: [1, 1],
      iconAnchor: [0, 30],
    });
    const marker = L.marker(ll, { icon, interactive: false, keyboard: false });
    (marker as any).setZIndexOffset?.(1300);
    return marker;
  }

  private isEditableLayer(x: any): x is EditableLayer {
    return !!normalizeCivilEngineeringLayerId(String(x || '').trim());
  }
  private normalizeDepartmentName(value: string | null | undefined): string { return (value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  private updateStationCreateModeUi(): void {
    if (!this.map) return;
    const isCreatingPoint = this.edit.enabled && !!this.edit.editLayer && this.edit.creatingStation;
    const container = this.map.getContainer();
    container.style.cursor = isCreatingPoint ? 'crosshair' : '';
    if (isCreatingPoint) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();

    if (!isCreatingPoint) {
      if (this.createPointHintMarker && this.map.hasLayer(this.createPointHintMarker)) {
        this.map.removeLayer(this.createPointHintMarker);
      }
      this.createPointHintMarker = undefined;
      return;
    }

    const center = this.map.getCenter();
    if (!this.createPointHintMarker) {
      const icon = L.divIcon({
        className: 'create-point-hint-marker',
        html: '<div class="create-point-hint-label">Click on map and mark the point</div>',
        iconSize: [210, 32],
        iconAnchor: [0, 16],
      });
      this.createPointHintMarker = L.marker(center, { icon, interactive: false, keyboard: false }).addTo(this.map);
    } else {
      this.createPointHintMarker.setLatLng(center);
      if (!this.map.hasLayer(this.createPointHintMarker)) this.createPointHintMarker.addTo(this.map);
    }
  }

  private updateCreatePointHintPosition(latlng: L.LatLng): void {
    if (!this.map || !this.createPointHintMarker) return;
    this.createPointHintMarker.setLatLng(latlng);
  }
  private getOverlayInsetRect(selector: string, mapRect: DOMRect): DOMRect | null {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (!element) return null;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
    const rect = element.getBoundingClientRect();
    const overlaps = rect.right > mapRect.left && rect.left < mapRect.right && rect.bottom > mapRect.top && rect.top < mapRect.bottom;
    return overlaps ? rect : null;
  }
  private getVisualCenterPoint(): L.Point | null {
    if (!this.map) return null;
    const container = this.map.getContainer();
    const mapRect = container.getBoundingClientRect();
    const mapSize = this.map.getSize();
    let leftInset = 0;
    let rightInset = 0;
    let bottomInset = 0;
    const overlaySelectors = ['.right-panel.open', '.widget-rail', '.attr-dock'];
    for (const selector of overlaySelectors) {
      const rect = this.getOverlayInsetRect(selector, mapRect);
      if (!rect) continue;
      const overlapLeft = Math.max(mapRect.left, rect.left);
      const overlapRight = Math.min(mapRect.right, rect.right);
      const overlapTop = Math.max(mapRect.top, rect.top);
      const overlapBottom = Math.min(mapRect.bottom, rect.bottom);
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);
      const overlapHeight = Math.max(0, overlapBottom - overlapTop);
      if (overlapWidth <= 0 || overlapHeight <= 0) continue;
      if (rect.left <= mapRect.left + 1) leftInset = Math.max(leftInset, overlapWidth);
      if (rect.right >= mapRect.right - 1) rightInset = Math.max(rightInset, overlapWidth);
      if (rect.bottom >= mapRect.bottom - 1) bottomInset = Math.max(bottomInset, overlapHeight);
    }
    const usableWidth = Math.max(1, mapSize.x - leftInset - rightInset);
    const usableHeight = Math.max(1, mapSize.y - bottomInset);
    return L.point(leftInset + usableWidth / 2, usableHeight / 2);
  }
  private centerLatLngInVisibleMapArea(latlng: L.LatLngExpression, zoom: number): void {
    if (!this.map) return;
    this.suppressReloadUntil = Date.now() + 220;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.map.invalidateSize();
    this.map.setView(latlng, zoom, { animate: false });
    this.scheduleReloadAfterSuppression();
  }

  private handleStationCreateDoubleClick(e: L.LeafletMouseEvent): void {
    if (!this.map) return;
    if (!this.edit.enabled || !this.edit.editLayer || !this.edit.creatingStation) return;
    const divisionBuffer = this.layerManager.findById('division_buffer') as DivisionBufferLayer | undefined;
    if (divisionBuffer?.containsLatLng && !divisionBuffer.containsLatLng(e.latlng)) {
      this.zone.run(() => { this.alerts.warning('New asset can only be created inside the division buffer.'); });
      return;
    }
    const lat = Number(e.latlng.lat);
    const lng = Number(e.latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.zone.run(() => {
      if (this.createPointHintMarker && this.map?.hasLayer(this.createPointHintMarker)) {
        this.map.removeLayer(this.createPointHintMarker);
      }
      this.createPointHintMarker = undefined;
      this.edit.emitCreateStationPoint(lat, lng);
      this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: false } as any);
    });
  }

  private resolveDepartmentModule(): { key: DepartmentModuleKey; label: string } {
    if (this.isPortalAdmin()) {
      return { key: 'civil_engineering_assets', label: 'Civil Engineering Assets Layers' };
    }
    const rawDepartment = localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '';
    const normalized = this.normalizeDepartmentName(rawDepartment);
    const key = this.departmentAliases[normalized] || 'unknown';
    if (key === 'civil_engineering_assets') return { key, label: 'Civil Engineering Assets Layers' };
    if (key === 'civil_engineering_assets_offtrack') return { key, label: 'Civil Engineering Assets Offtrack Layers' };
    return { key, label: rawDepartment?.trim() || 'Department Layers' };
  }
  private toLayerTitle(value: string): string {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  private normalizeCatalogLayerKey(value: string): string {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  private shouldSkipDynamicDepartmentLayer(layerKey: string, departmentKey: DepartmentModuleKey): boolean {
    const normalizedLayerKey = this.normalizeCatalogLayerKey(layerKey);
    const isBuiltIn = Array.from(this.builtInDepartmentLayerKeys).some(
      (builtInKey) => this.normalizeCatalogLayerKey(builtInKey) === normalizedLayerKey
    );

    if (isBuiltIn) return true;
    if (departmentKey === 'civil_engineering_assets' && normalizedLayerKey === 'station') return true;
    return false;
  }
  private registerDynamicDepartmentLayers(
    departmentRef: string,
    departmentKey: DepartmentModuleKey,
    attributeTabs: LayerKey[]
  ): void {
    if (!departmentRef.trim()) {
      this.attrTable.setTabs(attributeTabs);
      return;
    }
    this.api.getDepartmentLayerCatalog(departmentRef).subscribe({
      next: (res: any) => {
        const layers: DepartmentLayerMeta[] = Array.isArray(res?.data) ? res.data : [];
        const nextTabs = [...attributeTabs];
        layers.forEach((meta) => {
          const layerKey = String(meta?.layerKey || '').trim();
          if (!layerKey || this.shouldSkipDynamicDepartmentLayer(layerKey, departmentKey)) return;
          const title = this.toLayerTitle(meta?.layerName || layerKey);
          this.layerManager.registerOnce(
            new DynamicDepartmentEditLayer(
              `department_${layerKey}`,
              title,
              this.api,
              departmentRef,
              layerKey,
              this.edit,
              (g: any) => this.attrTable.pushFeatureCollection(title, g)
            )
          );
          if (!nextTabs.includes(title)) nextTabs.push(title);
        });
        this.attrTable.setTabs(nextTabs);
        if (this.map) {
          if (this.edit.enabled) {
            this.handleEditStateChange();
          } else if (!this.initialLayerLoadStarted) {
            this.layerManager.applyVisibility(this.map);
          } else {
            this.layerManager.applyVisibility(this.map);
            this.layerManager.reloadAll(this.map);
          }
        }
      },
      error: (err: any) => {
        console.error('Department layer catalog error', err);
        this.attrTable.setTabs(attributeTabs);
      },
    });
  }

  private registerDepartmentLayers(): void {
    const department = this.resolveDepartmentModule();
    const departmentRef = this.isPortalAdmin()
      ? 'Civil Engineering Assets'
      : String(localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '').trim();
    const attributeTabs: LayerKey[] = [...this.commonAttributeTabs];
    const portalAdmin = this.isPortalAdmin();
    this.layerManager.clear(); this.layerManager.setActiveDepartmentLabel(department.label);
    this.layerManager.registerOnce(new IndiaBoundaryLayer(this.api));
    if (portalAdmin) {
      setTimeout(() => this.startInitialLayerLoad(), 60);
    } else {
      this.layerManager.registerOnce(new DivisionBufferLayer(this.api, () => {
        if (!this.map) return;
        setTimeout(() => {
          if (!this.map) return;
          this.startInitialLayerLoad();
        }, 60);
      }));
    }
    this.layerManager.registerOnce(new TrackLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Railway Track', g)));
    if (department.key === 'civil_engineering_assets' || portalAdmin) {
      attributeTabs.unshift('Station');
      this.layerManager.registerOnce(new StationViewingLayer(this.api, this.zone, this.stationCategoryVisibility, (g: any) => this.attrTable.pushFeatureCollection('Station', g)));
    }
    if (department.key === 'civil_engineering_assets') {
      attributeTabs.splice(1, 0, 'Landplan Ontrack', 'Land Offset', 'Land Boundary');
      this.layerManager.registerOnce(new LandPlanOntrackViewingLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Landplan Ontrack', g)));
      this.layerManager.registerOnce(new LandOffsetLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Offset', g)));
      this.layerManager.registerOnce(new LandBoundaryLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Boundary', g)));
    }
    this.layerManager.registerOnce(new KmPostLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Km Post', g)));
    this.attrTable.setTabs(attributeTabs);
    this.registerDynamicDepartmentLayers(departmentRef, department.key, attributeTabs);
  }

  private syncEditAwareLayers(): void {
    if (!this.map) return;
    const normalizedEditLayer = normalizeCivilEngineeringLayerId(this.edit.editLayer || '');
    const modeKey = `${this.edit.enabled ? 'edit' : 'view'}:${normalizedEditLayer || 'none'}`;
    if (this.editAwareLayerModeKey === modeKey) return;
    this.editAwareLayerModeKey = modeKey;

    const wantsStationEditLayer = this.edit.enabled && normalizedEditLayer === 'stations';
    const wantsLandPlanOntrackEditLayer = this.edit.enabled && normalizedEditLayer === 'landplan_ontrack';
    const wantsLandOffsetEditLayer = this.edit.enabled && normalizedEditLayer === 'land_offset';
    const wantsLandBoundaryEditLayer = this.edit.enabled && normalizedEditLayer === 'land_boundary';
    this.layerManager.replaceLayer(
      wantsStationEditLayer
        ? new StationLayer(this.api, this.filters, this.edit, this.zone, this.stationCategoryVisibility, (g: any) => this.attrTable.pushFeatureCollection('Station', g))
        : new StationViewingLayer(this.api, this.zone, this.stationCategoryVisibility, (g: any) => this.attrTable.pushFeatureCollection('Station', g)),
      this.map
    );
    this.layerManager.replaceLayer(wantsLandPlanOntrackEditLayer ? new LandPlanOntrackLayer(this.api, this.edit, (g) => this.attrTable.pushFeatureCollection('Landplan Ontrack', g)) : new LandPlanOntrackViewingLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Landplan Ontrack', g)), this.map);
    this.layerManager.replaceLayer(wantsLandOffsetEditLayer ? new LandOffsetEditLayer(this.api, this.edit, (g) => this.attrTable.pushFeatureCollection('Land Offset', g)) : new LandOffsetLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Offset', g)), this.map);
    this.layerManager.replaceLayer(wantsLandBoundaryEditLayer ? new LandBoundaryEditLayer(this.api, this.edit, (g) => this.attrTable.pushFeatureCollection('Land Boundary', g)) : new LandBoundaryLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Boundary', g)), this.map);
  }

  private handleEditStateChange(): void {
    this.syncEditAwareLayers();
    this.applyEditSuppression();
    this.loadSelectedEditLayer();
    this.updateStationCreateModeUi();
  }

  private getSelectedEditLayerCandidates(): string[] {
    const normalizedEditLayer = normalizeCivilEngineeringLayerId(this.edit.editLayer || '');
    if (!normalizedEditLayer) return [];

    const candidates = [
      normalizedEditLayer,
      `department_${normalizedEditLayer}`,
    ];
    if (normalizedEditLayer === 'land_boundary') candidates.push('landboundary');
    if (normalizedEditLayer === 'station') candidates.push('stations');
    if (normalizedEditLayer === 'stations') candidates.push('station', 'department_station');
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private loadSelectedEditLayer(): void {
    if (!this.map || !this.edit.enabled) return;
    const selectedLayerIds = new Set(this.getSelectedEditLayerCandidates());

    this.layerManager.getLayers()
      .filter((layer) => this.isSelectedEditLayer(layer.id, selectedLayerIds))
      .forEach((layer) => {
        layer.visible = true;
        try {
          layer.addTo(this.map!);
          layer.loadForMap(this.map!);
        } catch (err) {
          console.error(`Selected edit layer load failed: ${layer.id}`, err);
        }
      });
  }

  private isSelectedEditLayer(layerId: string, selectedLayerIds = new Set(this.getSelectedEditLayerCandidates())): boolean {
    if (!selectedLayerIds.size) return false;
    const normalizedLayerId = normalizeCivilEngineeringLayerId(String(layerId || '').replace(/^department_/, ''));
    return (
      selectedLayerIds.has(layerId) ||
      selectedLayerIds.has(normalizedLayerId) ||
      selectedLayerIds.has(`department_${normalizedLayerId}`)
    );
  }

  private initDeepLinking(): void {
    this.routeSub?.unsubscribe();
    this.routeSub = this.route.queryParams.subscribe((params) => {
      const panel = String(params['panel'] || '').trim().toLowerCase();
      if (panel !== 'edit') return;
      const layerParam = String(params['layer'] || '').trim();
      this.ui.activePanel = 'edit'; this.edit.enable();
      if (this.isEditableLayer(layerParam)) {
        const safeLayer = layerParam as EditableLayer;
        (this.edit as any).editLayer = safeLayer; this.edit.setLayer(safeLayer as any);
        setTimeout(() => { (this.edit as any).editLayer = safeLayer; this.edit.setLayer(safeLayer as any); }, 0);
      }
      setTimeout(() => this.forceMapResize(), 0); setTimeout(() => this.forceMapResize(), 260);
    });
  }

  private initializeMapSafely(): void {
    const el = document.getElementById('map'); if (!el) { requestAnimationFrame(() => this.initializeMapSafely()); return; }
    if (this.map) return;
    const anyEl = el as any; if (anyEl._leaflet_id) { try { anyEl._leaflet_id = undefined; } catch {} }
    this.ui.activePanel = null; this.edit.disable();
    const initialView = this.getInitialMapView();
    this.map = L.map(el, { preferCanvas: false, zoomControl: false, zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: false, zoomAnimationThreshold: 8, wheelDebounceTime: 60, wheelPxPerZoomLevel: 140, zoomSnap: 0.1, zoomDelta: 0.1, maxZoom: 22 }).setView(initialView.center, initialView.zoom);
    L.control.zoom({ position: 'topleft' }).addTo(this.map);
    this.mapRegistry.setMap(this.map);
    this.createStationDblClickHandler = (e: L.LeafletMouseEvent) => this.handleStationCreateDoubleClick(e);
    this.createPointMouseMoveHandler = (e: L.LeafletMouseEvent) => {
      if (!this.edit.enabled || !this.edit.editLayer || !this.edit.creatingStation) return;
      this.updateCreatePointHintPosition(e.latlng);
    };
    this.map.on('click', this.createStationDblClickHandler);
    this.map.on('mousemove', this.createPointMouseMoveHandler);
    this.sidebarSub?.unsubscribe(); this.sidebarSub = new Subscription();
    this.sidebarSub.add(this.ui.layoutChanged$.subscribe(() => { setTimeout(() => this.forceMapResize(), 320); }));
    this.sidebarSub.add(this.router.events.pipe(filter((e) => e instanceof NavigationStart)).subscribe((e: any) => { const fromUrl = this.router.url || ''; const toUrl = e?.url || ''; const isMapPage = (u: string) => u.includes('/dashboard/railway-assets') || u.includes('/map'); if (isMapPage(fromUrl) && !isMapPage(toUrl)) { this.ui.activePanel = null; this.edit.disable(); this.mapZoom.clearHighlight(); this.clearZoomArtifacts(); this.applyEditSuppression(); } }));
    const base = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 17, maxZoom: 22, attribution: 'Tiles Ã‚Â© Esri' }).addTo(this.map);
    base.once('load', () => { this.forceMapResize(); });
    this.registerDepartmentLayers();
    this.map.whenReady(() => {
      this.forceMapResize(); this.ui.activePanel = null; this.edit.disable(); this.clearZoomArtifacts(); this.mapZoom.clearHighlight(); const divisionBuffer = this.layerManager.findById('division_buffer'); divisionBuffer?.addTo(this.map!); divisionBuffer?.loadForMap(this.map!); this.layerManager.addAll(this.map!); setTimeout(() => this.startInitialLayerLoad(), 1600); this.captureHomeAfterFirstSettle(); this.initDeepLinking(); this.onMoveOrZoom = () => this.scheduleReload(); this.map!.on('moveend', this.onMoveOrZoom); this.editSuppressionSub?.unsubscribe(); this.editSuppressionSub = this.edit.stateChanged$.subscribe(() => this.handleEditStateChange()); this.handleEditStateChange(); this.lockDragSub?.unsubscribe(); this.lockDragSub = this.edit.lockDrag$.subscribe(() => { if (!this.dragMarker) return; this.dragMarker.dragging?.disable(); this.dragMarker.off('drag'); this.dragMarker.off('dragend'); }); this.mapZoomSub?.unsubscribe(); this.mapZoomSub = this.mapZoom.zoomTo$.subscribe((t: ZoomTarget) => { if (!this.map) return; this.clearZoomArtifacts(); if (t.type === 'clear') return; if (t.type === 'home') { this.zoomToHome(); return; } if (t.type === 'feature') { try { const gj = this.createAttributeHighlightLayer((t as any).feature); const bounds = gj.getBounds(); this.highlightLayer = gj.addTo(this.map); this.bringHighlightToFront(this.highlightLayer); if (bounds?.isValid()) { this.map.fitBounds(bounds.pad((t as any).pad ?? 0.2), { animate: false }); this.scheduleReloadAfterProgrammaticZoom(); } } catch (e) {} return; } if (t.type === 'latlng') { const z = t.zoom ?? 17; const ll = L.latLng(t.lat, t.lng); const draggable = !!(t as any).draggable; const existingLayer = (t as any).existingLayer; this.centerLatLngInVisibleMapArea(ll, z); this.scheduleReloadAfterProgrammaticZoom(); if (draggable) { this.dragMarker = this.createDraggableCircleMarker(ll).addTo(this.map); this.dragMarker.on('drag', () => { const p = this.dragMarker!.getLatLng(); this.edit.emitDragEnd(p.lat, p.lng); }); this.dragMarker.on('dragend', () => { const p = this.dragMarker!.getLatLng(); this.edit.emitDragEnd(p.lat, p.lng); }); this.zoomHighlight = this.dragMarker; } else { const highlightedExisting = existingLayer ? this.applyExistingMarkerHighlight(existingLayer) : false; if (!highlightedExisting) this.zoomHighlight = this.createFocusCircleMarker(ll).addTo(this.map); } return; } if (t.type === 'xy') { const ll = L.CRS.EPSG3857.unproject(L.point(t.x, t.y)); const z = t.zoom ?? 17; this.centerLatLngInVisibleMapArea(ll, z); this.scheduleReloadAfterProgrammaticZoom(); this.zoomHighlight = this.createFocusCircleMarker(ll, 24, 3, 0.2).addTo(this.map); return; } if (t.type === 'bounds') { const b = L.latLngBounds(L.latLng(t.south, t.west), L.latLng(t.north, t.east)); this.map.invalidateSize(); this.map.fitBounds(b.pad(t.pad ?? 0.2), { animate: false }); this.scheduleReloadAfterProgrammaticZoom(); } }); this.zoomSub?.unsubscribe(); this.zoomSub = this.attrTable.zoomTo$.subscribe(({ feature }) => { if (!this.map) return; try { this.clearZoomArtifacts(); const gj = this.createAttributeHighlightLayer(feature); const bounds = gj.getBounds(); this.highlightLayer = gj.addTo(this.map); this.bringHighlightToFront(this.highlightLayer); if (bounds?.isValid()) { this.map.fitBounds(bounds.pad(0.2), { animate: false }); this.scheduleReloadAfterProgrammaticZoom(); } } catch (e) {} }); this.clearSelectionSub?.unsubscribe(); this.clearSelectionSub = this.attrTable.clearSelection$.subscribe(() => { if (!this.map) return; this.clearZoomArtifacts(); this.zoomToHome(); });
    });
  }

  private refreshAfterShapefileUpload(layerName: string): void {
    if (!this.map) return;

    const normalizedLayer = normalizeCivilEngineeringLayerId(layerName || '') || String(layerName || '').trim().toLowerCase();
    const candidateIds = [
      `department_${normalizedLayer}`,
      normalizedLayer,
      normalizedLayer === 'station' ? 'stations' : '',
      normalizedLayer === 'land_boundary' ? 'landboundary' : '',
    ].filter(Boolean);

    const targetLayer = candidateIds
      .map((id) => this.layerManager.findById(id))
      .find((layer) => !!layer);

    if (targetLayer) {
      targetLayer.addTo(this.map);
      targetLayer.loadForMap(this.map);
      return;
    }

    this.layerManager.reloadVisible(this.map);
  }

  private applyEditSuppression(): void {
    if (!this.map) return;

    const normalizedEditLayer = normalizeCivilEngineeringLayerId(this.edit.editLayer || '');
    const suppressionKey = `${this.edit.enabled ? 'edit' : 'view'}:${normalizedEditLayer || 'none'}`;
    if (this.editSuppressionKey === suppressionKey) return;
    this.editSuppressionKey = suppressionKey;

    if (!this.edit.enabled) {
      this.suppressedVis.clear();
      this.layerManager.getLayers().forEach((layer) => {
        this.layerManager.setVisible(layer.id, layer.id !== this.LAND_OFFSET_ID, this.map!);
      });
      return;
    }

    const selectedLayerIds = new Set<string>(this.getSelectedEditLayerCandidates());

    this.layerManager.getLayers().forEach((layer) => {
      const isSelectedLayer = this.isSelectedEditLayer(layer.id, selectedLayerIds);
      const shouldShow =
        layer.layerGroup === 'common' ||
        this.EDIT_BASE_LAYER_IDS.has(layer.id) ||
        isSelectedLayer;
      if (!this.suppressedVis.has(layer.id)) this.suppressedVis.set(layer.id, !!layer.visible);
      this.layerManager.setVisible(layer.id, shouldShow, this.map!);
    });
  }


  onStationSelected(station: Station): void {
    const coordinates = station.geometry.coordinates;
    const lng = coordinates[0];
    const lat = coordinates[1];

    if (this.selectedStationMarker && this.map?.hasLayer(this.selectedStationMarker)) {
      this.map.removeLayer(this.selectedStationMarker);
      this.selectedStationMarker = undefined;
    }

    this.mapZoom.zoomTo({
      type: 'latlng',
      lat,
      lng,
      zoom: 17,
      draggable: false
    } as any);

    if (this.map) {
      this.selectedStationMarker = L.circleMarker([lat, lng], {
        radius: 15,
        weight: 5,
        color: '#7c3aed',
        fillColor: '#a78bfa',
        fillOpacity: 0.6,
      }).addTo(this.map);
    }

    this.showStationNotification(station);
  }

  onSearchCleared(): void {
    if (this.selectedStationMarker && this.map?.hasLayer(this.selectedStationMarker)) {
      this.map.removeLayer(this.selectedStationMarker);
      this.selectedStationMarker = undefined;
    }
    this.clearZoomArtifacts();
    this.mapZoom.clearHighlight();
    this.zoomToHome();
  }

  private showStationNotification(station: Station): void {
    const notification = document.createElement('div');
    notification.className = 'station-notification';
    notification.innerHTML = '<div style="background: white; padding: 12px 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); border-left: 4px solid #4CAF50;">' +
      '<strong>' + station.properties.sttnname + '</strong><br>' +
      '<small>Code: ' + station.properties.sttncode + ' | District: ' + station.properties.district + '</small>' +
      '</div>';
    notification.style.position = 'absolute';
    notification.style.bottom = '40px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.zIndex = '1000';
    notification.style.pointerEvents = 'none';

    document.querySelector('.map-container')?.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  ngOnDestroy(): void {
    document.body.classList.remove(this.performanceBodyClass);
    this.zoomSub?.unsubscribe(); this.clearSelectionSub?.unsubscribe(); this.sidebarSub?.unsubscribe(); this.mapZoomSub?.unsubscribe(); this.lockDragSub?.unsubscribe(); this.editSuppressionSub?.unsubscribe(); this.routeSub?.unsubscribe(); this.shapefileUploadSub?.unsubscribe(); this.zoomSub = undefined; this.clearSelectionSub = undefined; this.sidebarSub = undefined; this.mapZoomSub = undefined; this.lockDragSub = undefined; this.editSuppressionSub = undefined; this.routeSub = undefined; this.shapefileUploadSub = undefined; if (this.reloadTimer) clearTimeout(this.reloadTimer); this.reloadTimer = null; if (this.map) this.clearZoomArtifacts(); if (!this.map) return;
    try { if (this.createStationDblClickHandler) this.map.off('click', this.createStationDblClickHandler); if (this.createPointMouseMoveHandler) this.map.off('mousemove', this.createPointMouseMoveHandler); if (this.onMoveOrZoom) this.map.off('moveend', this.onMoveOrZoom); else this.map.off(); this.layerManager.removeAll(this.map); this.map.remove(); } finally { if (this.selectedStationMarker && this.map?.hasLayer(this.selectedStationMarker)) { this.map.removeLayer(this.selectedStationMarker); } if (this.createPointHintMarker && this.map?.hasLayer(this.createPointHintMarker)) { this.map.removeLayer(this.createPointHintMarker); } this.selectedStationMarker = undefined; this.createPointHintMarker = undefined; this.map = undefined; this.onMoveOrZoom = undefined; this.highlightLayer = undefined; this.homeCenter = undefined; this.homeZoom = undefined; this.homeCaptured = false; this.dragMarker = undefined; this.zoomHighlight = undefined; this.suppressedVis.clear(); this.createStationDblClickHandler = undefined; this.createPointMouseMoveHandler = undefined; }
  }
}



























