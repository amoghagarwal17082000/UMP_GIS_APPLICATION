import { Component, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StationSearchComponent } from '../station-search/station-search.component';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ActivatedRoute, Router, NavigationStart } from '@angular/router';

import { Api } from '../../api/api';
import { StationLayer } from '../../departments/civil_engineering_assets/editing/station';
import {
  DynamicDepartmentLayer,
  LandBoundaryLayer,
  LandPlanOntrackViewingLayer,
  LandOffsetLayer,
  StationViewingLayer,
} from '../../departments/civil_engineering_assets/viewing/civil-engineering-assets-viewing';
import { LandPlanOntrackLayer } from '../../departments/civil_engineering_assets/editing/landplan-ontrack';
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

type EditableLayer = 'stations' | 'landplan';
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
  private suppressedVis = new globalThis.Map<string, boolean>();
  private readonly LAND_OFFSET_ID = 'land_offset';
  private readonly LAND_PLAN_ID = 'landplan_ontrack';
  private reloadTimer: any = null;
  private routeSub?: Subscription;
  private createStationDblClickHandler?: (e: L.LeafletMouseEvent) => void;
  private selectedStationMarker?: L.Layer;

  private readonly departmentAliases: Record<string, DepartmentModuleKey> = {
    'civil engineering assets': 'civil_engineering_assets',
    'civil engineering assets offtrack': 'civil_engineering_assets_offtrack',
    civil_engineering_assets: 'civil_engineering_assets',
    civil_engineering_assets_offtrack: 'civil_engineering_assets_offtrack',
  };

  private readonly commonAttributeTabs: LayerKey[] = ['Km Post', 'Railway Track'];
  private readonly builtInDepartmentLayerKeys = new Set([
    'station',
    'land_boundary',
    'land_offset',
    'land_plan_on_track',
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
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngAfterViewInit(): void {
    document.body.classList.add(this.performanceBodyClass);
    void this.currentUser.loadMe(true).then((user) => {
      if (!user?.user_id) {
        this.zone.run(() => {
          this.router.navigateByUrl('/login');
        });
        return;
      }

      this.zone.runOutsideAngular(() => {
        requestAnimationFrame(() => this.initializeMapSafely());
      });
    });
  }

  private forceMapResize(): void { if (!this.map) return; this.map.invalidateSize(); requestAnimationFrame(() => this.map?.invalidateSize()); setTimeout(() => this.map?.invalidateSize(), 350); }
  private scheduleReload(): void { if (!this.map) return; if (this.reloadTimer) clearTimeout(this.reloadTimer); this.reloadTimer = setTimeout(() => { if (!this.map) return; this.layerManager.reloadVisible(this.map); }, 900); }

  private captureHomeAfterFirstSettle(): void {
    if (!this.map || this.homeCaptured) return;
    const initialCenter = L.latLng(22.5, 79); const initialZoom = 8.5;
    const isInitialView = () => { if (!this.map) return true; const z = this.map.getZoom(); const c = this.map.getCenter(); return Math.abs(z - initialZoom) < 0.05 && c.distanceTo(initialCenter) < 50000; };
    const trySave = () => { if (!this.map || this.homeCaptured || isInitialView()) return; this.homeCenter = this.map.getCenter(); this.homeZoom = this.map.getZoom(); this.homeCaptured = true; this.map.off('moveend', trySave); this.map.off('zoomend', trySave); };
    this.map.on('moveend', trySave); this.map.on('zoomend', trySave);
    let tries = 0;
    const timer = setInterval(() => { if (!this.map || this.homeCaptured) { clearInterval(timer); return; } tries++; trySave(); if (tries >= 30) { clearInterval(timer); this.map.off('moveend', trySave); this.map.off('zoomend', trySave); } }, 200);
  }

  private zoomToHome(): void { if (!this.map) return; if (!this.homeCaptured || !this.homeCenter || typeof this.homeZoom !== 'number') return; this.map.invalidateSize(); this.map.setView(this.homeCenter, this.homeZoom, { animate: false }); }
  private clearZoomArtifacts(): void { if (!this.map) return; if (this.zoomHighlight && this.map.hasLayer(this.zoomHighlight as any)) this.map.removeLayer(this.zoomHighlight as any); this.zoomHighlight = undefined; if (this.highlightLayer && this.map.hasLayer(this.highlightLayer)) this.map.removeLayer(this.highlightLayer); this.highlightLayer = undefined; if (this.dragMarker && this.map.hasLayer(this.dragMarker as any)) { this.dragMarker.off(); this.map.removeLayer(this.dragMarker as any); } this.dragMarker = undefined; }

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
        weight: 5,
        opacity: 1,
        fillColor: '#a78bfa',
        fillOpacity: 0.2,
      }),
    });
  }

  private createDraggableCircleMarker(ll: L.LatLng): L.Marker {
    const size = 34; const border = 5;
    const icon = L.divIcon({ className: 'drag-circle-icon', html: `<div style="width:${size}px;height:${size}px;border:${border}px solid #7c3aed;background: rgba(167,139,250,0.60);border-radius: 50%;box-sizing: border-box;box-shadow: 0 2px 10px rgba(0,0,0,0.25);"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const m = L.marker(ll, { draggable: true, icon, keyboard: false, autoPan: true, autoPanPadding: L.point(40, 40) });
    (m as any).setZIndexOffset?.(9999);
    return m;
  }

  private isEditableLayer(x: any): x is EditableLayer { return x === 'stations' || x === 'landplan'; }
  private normalizeDepartmentName(value: string | null | undefined): string { return (value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  private updateStationCreateModeUi(): void { if (!this.map) return; const isCreatingStation = this.edit.enabled && this.edit.editLayer === 'stations' && this.edit.creatingStation; const container = this.map.getContainer(); container.style.cursor = isCreatingStation ? 'crosshair' : ''; if (isCreatingStation) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable(); }

  private handleStationCreateDoubleClick(e: L.LeafletMouseEvent): void { if (!this.map) return; if (!this.edit.enabled || this.edit.editLayer !== 'stations' || !this.edit.creatingStation) return; const divisionBuffer = this.layerManager.findById('division_buffer') as DivisionBufferLayer | undefined; if (!divisionBuffer?.containsLatLng?.(e.latlng)) { this.zone.run(() => { alert('New station can only be created inside the division buffer.'); }); return; } const lat = Number(e.latlng.lat); const lng = Number(e.latlng.lng); if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; this.zone.run(() => { this.edit.emitCreateStationPoint(lat, lng); this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: false } as any); }); }

  private resolveDepartmentModule(): { key: DepartmentModuleKey; label: string } {
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
  private shouldSkipDynamicDepartmentLayer(layerKey: string, departmentKey: DepartmentModuleKey): boolean {
    if (this.builtInDepartmentLayerKeys.has(layerKey)) return true;
    if (departmentKey === 'civil_engineering_assets' && layerKey === 'station') return true;
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
            new DynamicDepartmentLayer(
              `department_${layerKey}`,
              title,
              this.api,
              departmentRef,
              layerKey,
              (g: any) => this.attrTable.pushFeatureCollection(title, g)
            )
          );
          if (!nextTabs.includes(title)) nextTabs.push(title);
        });
        this.attrTable.setTabs(nextTabs);
        if (this.map) {
          this.layerManager.applyVisibility(this.map);
          this.layerManager.reloadAll(this.map);
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
    const departmentRef = String(localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '').trim();
    const attributeTabs: LayerKey[] = [...this.commonAttributeTabs];
    this.layerManager.clear(); this.layerManager.setActiveDepartmentLabel(department.label);
    this.layerManager.registerOnce(new IndiaBoundaryLayer(this.api));
    this.layerManager.registerOnce(new DivisionBufferLayer(this.api));
    this.layerManager.registerOnce(new TrackLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Railway Track', g)));
    if (department.key === 'civil_engineering_assets') {
      attributeTabs.unshift('Station', 'Land Plan Ontrack', 'Land Offset', 'Land Boundary');
      this.layerManager.registerOnce(new StationViewingLayer(this.api, this.zone, (g) => this.attrTable.pushFeatureCollection('Station', g)));
      this.layerManager.registerOnce(new LandOffsetLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Offset', g)));
      this.layerManager.registerOnce(new LandBoundaryLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Boundary', g)));
      this.layerManager.registerOnce(new LandPlanOntrackViewingLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Plan Ontrack', g)));
    }
    this.layerManager.registerOnce(new KmPostLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Km Post', g)));
    this.attrTable.setTabs(attributeTabs);
    this.registerDynamicDepartmentLayers(departmentRef, department.key, attributeTabs);
  }

  private syncEditAwareLayers(): void {
    if (!this.map) return;
    const wantsStationEditLayer = this.edit.enabled && this.edit.editLayer === 'stations';
    const wantsLandPlanEditLayer = this.edit.enabled && this.edit.editLayer === 'landplan';
    this.layerManager.replaceLayer(wantsStationEditLayer ? new StationLayer(this.api, this.filters, this.edit, this.zone, (g) => this.attrTable.pushFeatureCollection('Station', g)) : new StationViewingLayer(this.api, this.zone, (g) => this.attrTable.pushFeatureCollection('Station', g)), this.map);
    this.layerManager.replaceLayer(wantsLandPlanEditLayer ? new LandPlanOntrackLayer(this.api, this.edit, (g) => this.attrTable.pushFeatureCollection('Land Plan Ontrack', g)) : new LandPlanOntrackViewingLayer(this.api, (g) => this.attrTable.pushFeatureCollection('Land Plan Ontrack', g)), this.map);
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
    this.map = L.map(el, { preferCanvas: false, zoomControl: false, zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: false, zoomAnimationThreshold: 8, wheelDebounceTime: 60, wheelPxPerZoomLevel: 140, zoomSnap: 0.1, zoomDelta: 0.1 }).setView([22.5, 79], 8.5);
    L.control.zoom({ position: 'topleft' }).addTo(this.map);
    this.mapRegistry.setMap(this.map);
    this.createStationDblClickHandler = (e: L.LeafletMouseEvent) => this.handleStationCreateDoubleClick(e);
    this.map.on('dblclick', this.createStationDblClickHandler);
    this.sidebarSub?.unsubscribe(); this.sidebarSub = new Subscription();
    this.sidebarSub.add(this.ui.layoutChanged$.subscribe(() => { setTimeout(() => this.forceMapResize(), 320); }));
    this.sidebarSub.add(this.router.events.pipe(filter((e) => e instanceof NavigationStart)).subscribe((e: any) => { const fromUrl = this.router.url || ''; const toUrl = e?.url || ''; const isMapPage = (u: string) => u.includes('/dashboard/railway-assets') || u.includes('/map'); if (isMapPage(fromUrl) && !isMapPage(toUrl)) { this.ui.activePanel = null; this.edit.disable(); this.mapZoom.clearHighlight(); this.clearZoomArtifacts(); this.applyEditSuppression(); } }));
    const base = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 17, maxZoom: 22, attribution: 'Tiles Ã‚Â© Esri' }).addTo(this.map);
    base.once('load', () => { this.forceMapResize(); });
    this.registerDepartmentLayers();
    this.map.whenReady(() => {
      this.forceMapResize(); this.ui.activePanel = null; this.edit.disable(); this.clearZoomArtifacts(); this.mapZoom.clearHighlight(); this.layerManager.addAll(this.map!); this.layerManager.reloadAll(this.map!); this.map!.once('moveend', () => { if (this.map) this.layerManager.reloadVisible(this.map); }); this.captureHomeAfterFirstSettle(); this.initDeepLinking(); this.onMoveOrZoom = () => this.scheduleReload(); this.map!.on('moveend', this.onMoveOrZoom); this.editSuppressionSub?.unsubscribe(); this.editSuppressionSub = this.edit.stateChanged$.subscribe(() => { this.syncEditAwareLayers(); this.applyEditSuppression(); this.updateStationCreateModeUi(); }); this.syncEditAwareLayers(); this.applyEditSuppression(); this.updateStationCreateModeUi(); this.lockDragSub?.unsubscribe(); this.lockDragSub = this.edit.lockDrag$.subscribe(() => { if (!this.dragMarker) return; this.dragMarker.dragging?.disable(); this.dragMarker.off('drag'); this.dragMarker.off('dragend'); }); this.mapZoomSub?.unsubscribe(); this.mapZoomSub = this.mapZoom.zoomTo$.subscribe((t: ZoomTarget) => { if (!this.map) return; this.clearZoomArtifacts(); if (t.type === 'clear') return; if (t.type === 'home') { this.zoomToHome(); return; } if (t.type === 'latlng') { const z = t.zoom ?? 17; const ll = L.latLng(t.lat, t.lng); const draggable = !!(t as any).draggable; this.map.invalidateSize(); this.map.setView(ll, z, { animate: false }); if (draggable) { this.dragMarker = this.createDraggableCircleMarker(ll).addTo(this.map); this.dragMarker.on('drag', () => { const p = this.dragMarker!.getLatLng(); this.edit.emitDragEnd(p.lat, p.lng); }); this.dragMarker.on('dragend', () => { const p = this.dragMarker!.getLatLng(); this.edit.emitDragEnd(p.lat, p.lng); }); this.zoomHighlight = this.dragMarker; } else { this.zoomHighlight = L.circleMarker(ll, { radius: 15, weight: 5, color: '#7c3aed', fillColor: '#a78bfa', fillOpacity: 0.6 }).addTo(this.map); } return; } if (t.type === 'xy') { const ll = L.CRS.EPSG3857.unproject(L.point(t.x, t.y)); const z = t.zoom ?? 17; this.map.invalidateSize(); this.map.setView(ll, z, { animate: false }); this.zoomHighlight = L.circleMarker(ll, { radius: 10, weight: 3, fillOpacity: 0.2 }).addTo(this.map); return; } if (t.type === 'bounds') { const b = L.latLngBounds(L.latLng(t.south, t.west), L.latLng(t.north, t.east)); this.map.invalidateSize(); this.map.fitBounds(b.pad(t.pad ?? 0.2), { animate: false }); } }); this.zoomSub?.unsubscribe(); this.zoomSub = this.attrTable.zoomTo$.subscribe(({ feature }) => { if (!this.map) return; try { this.clearZoomArtifacts(); const gj = this.createAttributeHighlightLayer(feature); const bounds = gj.getBounds(); this.highlightLayer = gj.addTo(this.map); if ((this.highlightLayer as any).bringToFront) (this.highlightLayer as any).bringToFront(); if (bounds?.isValid()) this.map.fitBounds(bounds.pad(0.2), { animate: false }); } catch (e) {} }); this.clearSelectionSub?.unsubscribe(); this.clearSelectionSub = this.attrTable.clearSelection$.subscribe(() => { if (!this.map) return; this.clearZoomArtifacts(); this.zoomToHome(); });
    });
  }

  private applyEditSuppression(): void {
    if (!this.map) return;
    const shouldHide = this.edit.enabled && (this.edit as any).editLayer === 'stations';
    const ids = [this.LAND_OFFSET_ID, this.LAND_PLAN_ID];
    if (shouldHide) {
      ids.forEach((id) => { const layer = this.layerManager.findById(id); if (!layer) return; if (!this.suppressedVis.has(id)) this.suppressedVis.set(id, !!layer.visible); this.layerManager.setVisible(id, false, this.map!); });
    } else {
      ids.forEach((id) => { if (!this.suppressedVis.has(id)) return; const prev = this.suppressedVis.get(id)!; this.layerManager.setVisible(id, prev, this.map!); this.suppressedVis.delete(id); });
    }
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
    this.zoomSub?.unsubscribe(); this.clearSelectionSub?.unsubscribe(); this.sidebarSub?.unsubscribe(); this.mapZoomSub?.unsubscribe(); this.lockDragSub?.unsubscribe(); this.editSuppressionSub?.unsubscribe(); this.routeSub?.unsubscribe(); this.zoomSub = undefined; this.clearSelectionSub = undefined; this.sidebarSub = undefined; this.mapZoomSub = undefined; this.lockDragSub = undefined; this.editSuppressionSub = undefined; this.routeSub = undefined; if (this.reloadTimer) clearTimeout(this.reloadTimer); this.reloadTimer = null; if (this.map) this.clearZoomArtifacts(); if (!this.map) return;
    try { if (this.createStationDblClickHandler) this.map.off('dblclick', this.createStationDblClickHandler); if (this.onMoveOrZoom) this.map.off('moveend', this.onMoveOrZoom); else this.map.off(); this.layerManager.removeAll(this.map); this.map.remove(); } finally { if (this.selectedStationMarker && this.map?.hasLayer(this.selectedStationMarker)) { this.map.removeLayer(this.selectedStationMarker); } this.selectedStationMarker = undefined; this.map = undefined; this.onMoveOrZoom = undefined; this.highlightLayer = undefined; this.homeCenter = undefined; this.homeZoom = undefined; this.homeCaptured = false; this.dragMarker = undefined; this.zoomHighlight = undefined; this.suppressedVis.clear(); this.createStationDblClickHandler = undefined; }
  }
}



























