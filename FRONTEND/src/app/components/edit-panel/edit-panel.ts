import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditState } from '../../services/edit-state';
import { Api } from 'src/app/api/api';
import { UiState } from '../../services/ui-state';
import { MapZoomService } from 'src/app/services/map-zoom';
import { CurrentUserService } from 'src/app/services/current-user';
import { LayerManager } from 'src/app/services/layer-manager';
import { FileUploadService } from 'src/app/services/file-upload.service';
import { AppAlertService } from 'src/app/services/app-alert.service';
import {
  CIVIL_ENGINEERING_ASSET_LAYER_OPTIONS,
  getCivilEngineeringAssetLayerDisplayName,
  normalizeCivilEngineeringLayerId,
} from 'src/app/departments/civil_engineering_assets/editing/civil-engineering-assets-editing';
import {
  EDIT_LAYER_CONFIG,
  EDIT_LAYER_OPTIONS,
  getEditLayerConfig,
  type EditFieldConfig,
  type EditLayerKey,
  type TableColumnConfig,
} from './edit-layer-config';
type MakerTabKey = 'edit' | 'rejected' | 'sent_for_deletion';
type CheckerTabKey = 'pending' | 'approved' | 'deletion_proposed';
const WORKFLOW_STATUS = {
  makerRejected: 'Sent Back to Maker',
  checkerPending: 'Sent to Checker',
  approverPending: 'Sent to Approver',
  checkerDeletion: 'Sent to Checker for Deletion',
  approverDeletion: 'Sent to Approver for Deletion',
  finalised: 'Sent to Database',
  deleted: 'Asset Deleted',
} as const;
type MakerLayerOption = {
  value: string;
  label: string;
  supported: boolean;
};
type LocationOption = {
  value: string;
  label: string;
  stateLgd?: number | null;
  state?: string;
};
@Component({
  selector: 'app-edit-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './edit-panel.html',
  styleUrl: './edit-panel.css',
})
export class EditPanel implements OnInit, OnDestroy {
  private static readonly POINT_LAYER_ZOOM = 19;
  private static readonly STATION_LAYER_ZOOM = 17.7;
  private static readonly NEW_ASSET_ZOOM = 10;
  private static readonly DEFAULT_LAYER_ZOOM = 17;
  private static readonly NON_POINT_LAYERS = new Set([
    'landplan',
    'landplan_ontrack',
    'landplan_offtrack',
    'land_offset',
    'land_boundary',
  ]);

  private allRows: any[] = [];
  private filteredRows: any[] = [];
  private makerLayerOptions: MakerLayerOption[] = EDIT_LAYER_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    supported: true,
  }));
  private readonly allLayerOptions: MakerLayerOption[] = CIVIL_ENGINEERING_ASSET_LAYER_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    supported: !!getEditLayerConfig(option.value),
  }));
  private formFieldsCacheKey = '';
  private formFieldsCache: EditFieldConfig[] = [];
  private readonly emptyLocationOptions: LocationOption[] = [];
  private locationOptionsCache = new Map<string, LocationOption[]>();
  private railwayCodeByName = new Map<string, string>();

  rows: any[] = [];

  total = 0;
  filteredTotal = 0;

  page = 1;
  pageSize = 8;
  private fetchPageSize = 200;

  search = '';
  loading = false;

  mode: 'table' | 'edit' = 'table';
  draft: any = null;
  private originalDraft: any = null;

  saving = false;
  deleting = false;
  validating = false;
  stationValidated = false;
  private validatedBridgeAssetId: string | null = null;
  error: string | null = null;
  makerTab: MakerTabKey = 'edit';
  checkerTab: CheckerTabKey = 'pending';
  rejectedLayer: EditLayerKey | null = null;
  layerDropdownOpen = false;
  rejectedLayerDropdownOpen = false;
  layerSearch = '';
  rejectedLayerSearch = '';

  geomEditing = false;
  showAddRecordModal = false;
  addRecordDrawingActive = false;
  addRecordShapefileName = '';
  addRecordShapefileFiles: File[] = [];
  addRecordShapefileUploading = false;
  addRecordShapefileProgress = 0;
  addRecordShapefileProcessing = false;
  addRecordShapefileError: string | null = null;
  uploadedShapefileRecordObjectId: number | null = null;
  private addRecordUploadHandled = false;
  private addRecordUploadInFlight = false;
  private addRecordProcessingTimer?: ReturnType<typeof setTimeout>;
  private addRecordPollTimer?: ReturnType<typeof setTimeout>;
  private dragSub?: Subscription;
  private stateSub?: Subscription;
  private createPointSub?: Subscription;
  private shapefileUploadSub?: Subscription;
  private loadSeq = 0;
  stateOptions: LocationOption[] = [];
  districtOptions: LocationOption[] = [];
  constituencyOptions: LocationOption[] = [];
  private allDistrictOptions: Array<LocationOption & { state?: string }> = [];
  private allConstituencyOptions: Array<LocationOption & { state?: string }> = [];

// ── Attachment logic (from File 1) ──────────────────────────
  @ViewChild('attachmentInput') attachmentInput?: ElementRef<HTMLInputElement>;
  @ViewChild('addRecordShapefileInput') addRecordShapefileInput?: ElementRef<HTMLInputElement>;
  attachmentFiles: File[] = [];
  uploadingAttachments = false;
  attachmentUploadError: string | null = null;
  // ────────────────────────────────────────────────────────────


  constructor(
    public ui: UiState,
    public edit: EditState,
    private api: Api,
    private cdr: ChangeDetectorRef,
    private mapZoom: MapZoomService,
    private currentUser: CurrentUserService,
    private layerManager: LayerManager,
    private fileUploadService: FileUploadService,
    private alerts: AppAlertService
  ) {}

  private notifyAlert(message: string): void {
    const text = String(message || '').trim();
    if (!text) return;
    const lower = text.toLowerCase();
    if (lower.includes('failed') || lower.includes('not validated') || lower.includes('not wired') || lower.includes('not all')) {
      this.alerts.error(text, 0, true);
      return;
    }
    if (lower.includes('please') || lower.includes('mode is on') || lower.includes('drawing mode')) {
      this.alerts.warning(text, 0, true);
      return;
    }
    this.alerts.success(text, 0, true);
  }

  ngOnInit(): void {
    this.loadLocationOptions();

    if (this.isMaker()) {
      this.loadAssignedMakerLayers();
    }

    this.stateSub = this.edit.stateChanged$.subscribe(() => {
      if (!this.edit.enabled) return;
      if (this.supportsCurrentLayerListing() && this.mode === 'table' && !this.edit.creatingStation) {
        this.load(true);
        return;
      }
      this.syncSelectedFeatureDraft();
    });

    this.createPointSub = this.edit.createStationPoint$.subscribe(({ lat, lng }) => {
      if (this.currentTableLayer === 'stations') {
        this.beginStationCreationDraft(lat, lng);
      } else {
        this.beginGenericCreationDraft(lat, lng);
      }
    });

    this.shapefileUploadSub = this.fileUploadService.shapefileUploaded$.subscribe(({ layerName }) => {
      this.refreshAfterShapefileUpload(layerName);
    });

    if (this.edit.enabled && this.supportsCurrentLayerListing()) this.load(true);
    this.syncSelectedFeatureDraft();
  }

  ngOnDestroy(): void {
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;

    this.stateSub?.unsubscribe();
    this.stateSub = undefined;

    this.createPointSub?.unsubscribe();
    this.createPointSub = undefined;

    this.shapefileUploadSub?.unsubscribe();
    this.shapefileUploadSub = undefined;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredTotal / this.pageSize));
  }

  get showingFrom(): number {
    if (!this.filteredTotal) return 0;
    return (this.page - 1) * this.pageSize + 1;
  }

  get showingTo(): number {
    if (!this.filteredTotal) return 0;
    return Math.min(this.filteredTotal, this.page * this.pageSize);
  }

  get showingText(): string {
    return `${this.showingFrom}-${this.showingTo} of ${this.filteredTotal}`;
  }

  get layerOptions() {
    return this.isMakerEditLayerPicker()
      ? this.makerLayerOptions
      : this.allLayerOptions;
  }

  private isMakerEditLayerPicker(): boolean {
    return this.isMaker() && this.makerTab === 'edit';
  }

  get layerPickerLabel(): string {
    return this.isMakerEditLayerPicker() ? 'Select Assigned Layer' : 'Select Layer';
  }

  get rejectedLayerPickerLabel(): string {
    return 'Select Layer (Rejected Records)';
  }

  private getActiveRawLayer(): string {
    return String(this.isMakerRejectedView() ? this.rejectedLayer : this.edit.editLayer || '').trim();
  }

  getFilteredLayerOptions(rejected = false): MakerLayerOption[] {
    const term = String(rejected ? this.rejectedLayerSearch : this.layerSearch).trim().toLowerCase();
    if (!term) return this.layerOptions;
    return this.layerOptions.filter((option) => {
      const label = String(option.label || '').toLowerCase();
      const value = String(option.value || '').toLowerCase();
      return label.includes(term) || value.includes(term);
    });
  }

  getLayerDropdownLabel(rejected = false): string {
    const selected = String(rejected ? this.rejectedLayer : this.edit.editLayer || '').trim();
    if (!selected) return 'Select Layer';
    return this.layerOptions.find((option) => option.value === selected)?.label || selected;
  }

  toggleLayerDropdown(rejected = false): void {
    if (rejected) {
      this.rejectedLayerDropdownOpen = !this.rejectedLayerDropdownOpen;
      this.layerDropdownOpen = false;
      return;
    }
    this.layerDropdownOpen = !this.layerDropdownOpen;
    this.rejectedLayerDropdownOpen = false;
  }

  selectLayerOption(option: MakerLayerOption, rejected = false): void {
    if (rejected) {
      this.rejectedLayer = option.value as EditLayerKey;
      this.rejectedLayerDropdownOpen = false;
      this.rejectedLayerSearch = '';
      this.onRejectedLayerChange();
      return;
    }

    this.edit.editLayer = option.value as any;
    this.layerDropdownOpen = false;
    this.layerSearch = '';
    this.onLayerChange();
  }

  clearLayerSelection(rejected = false): void {
    if (rejected) {
      this.rejectedLayer = null;
      this.rejectedLayerSearch = '';
      this.rejectedLayerDropdownOpen = false;
      this.onRejectedLayerChange();
      return;
    }
    this.edit.editLayer = null as any;
    this.layerSearch = '';
    this.layerDropdownOpen = false;
    this.onLayerChange();
  }

  get currentLayerSchema() {
    const layer = this.currentTableLayer;
    return getEditLayerConfig(layer);
  }

  isBridgeLayer(): boolean {
    return ['bridge_start', 'bridge_end', 'bridge_minor', 'road_over_bridge', 'rob', 'rub_lhs', 'ror']
      .includes(String(this.currentTableLayer || '').trim().toLowerCase());
  }

  getEditTitle(): string {
    return this.currentLayerSchema?.formTitle || 'Asset Details';
  }

  private getCurrentLayerLabel(): string {
    return this.currentLayerSchema?.label || 'Asset';
  }

  private refreshAfterShapefileUpload(layerName: string): void {
    if (!this.edit.enabled || !this.supportsCurrentLayerListing()) return;
    if (this.addRecordShapefileUploading || this.addRecordShapefileProcessing || this.addRecordUploadInFlight) return;

    const uploadedLayer = normalizeCivilEngineeringLayerId(layerName || '');
    const currentLayer = normalizeCivilEngineeringLayerId(this.currentTableLayer || '');
    if (uploadedLayer && currentLayer && uploadedLayer !== currentLayer) return;

    this.reloadCurrentTableAfterUpload();
  }

  private reloadCurrentTableAfterUpload(): void {
    this.mode = 'table';
    this.page = 1;
    this.search = '';
    this.rows = [];
    this.allRows = [];
    this.filteredRows = [];
    this.total = 0;
    this.filteredTotal = 0;
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();
    setTimeout(() => this.load(true), 150);
  }

  private openNewestRecordAfterUpload(): void {
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey || !this.supportsCurrentLayerListing()) {
      this.reloadCurrentTableAfterUpload();
      return;
    }

    this.mode = 'table';
    this.page = 1;
    this.search = '';
    this.rows = [];
    this.allRows = [];
    this.filteredRows = [];
    this.total = 0;
    this.filteredTotal = 0;
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();

    const seq = ++this.loadSeq;
    setTimeout(() => {
      this.fetchCurrentLayerPage(layerKey, 1, this.pageSize, '').subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          const rows: any[] = Array.isArray(res?.rows) ? res.rows : [];
          this.allRows = rows;
          this.filteredRows = rows.filter((row) => this.isVisibleForCurrentView(row));
          this.rows = this.filteredRows;
          this.total = Number(res?.total ?? this.filteredRows.length);
          this.filteredTotal = this.total;
          this.loading = false;

          const newestRow = this.filteredRows[0];
          if (newestRow) {
            this.openUploadedRecordForm(newestRow, true);
          } else {
            this.error = 'Upload completed, but no matching record was found in this layer table.';
          }

          this.cdr.detectChanges();
        },
        error: (err) => {
          if (seq !== this.loadSeq) return;
          console.error('getLayerTable failed after shapefile upload', err);
          this.allRows = [];
          this.filteredRows = [];
          this.rows = [];
          this.total = 0;
          this.filteredTotal = 0;
          this.loading = false;
          this.error = err?.error?.message || err?.error?.error || 'Upload completed, but the layer table could not be loaded.';
          this.cdr.detectChanges();
        },
      });
    }, 200);
  }

  private openUploadedRecordByObjectId(objectId: number): void {
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey || !Number.isFinite(objectId)) {
      this.openNewestRecordAfterUpload();
      return;
    }

    this.mode = 'table';
    this.page = 1;
    this.search = '';
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();

    this.api.getLayerById(layerKey, objectId).subscribe({
      next: (full) => {
        const row = full || { objectid: objectId };
        this.rows = [row];
        this.allRows = [row];
        this.filteredRows = [row];
        this.total = 1;
        this.filteredTotal = 1;
        this.loading = false;
        this.openUploadedRecordForm(row, true);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load newly uploaded asset by objectid:', err);
        this.openNewestRecordAfterUpload();
      },
    });
  }

  private beginAddRecordBackgroundLookup(): void {
    if (this.addRecordUploadHandled || !this.addRecordUploadInFlight) return;
    this.addRecordShapefileProcessing = true;
    this.addRecordShapefileUploading = true;
    this.addRecordShapefileError = 'Upload is still processing. The new asset form will open automatically after it finishes.';
    this.cdr.detectChanges();
  }

  private openUploadedRecordForm(row: any, isUploadedShapefileRecord = false): void {
    this.editRow(row);
    const uploadedObjectId = Number(row?.objectid);
    this.uploadedShapefileRecordObjectId = isUploadedShapefileRecord && Number.isFinite(uploadedObjectId)
      ? uploadedObjectId
      : null;

    const layerKey = this.getPersistenceLayerKey();
    const objectId = Number(row?.objectid);
    if (!layerKey || !Number.isFinite(objectId)) {
      this.zoomToFeatureShape(row);
      return;
    }

    this.api.getLayerById(layerKey, objectId).subscribe({
      next: (full) => this.zoomToFeatureShape(full || row),
      error: (err) => {
        console.error('Failed to load uploaded asset geometry for zoom:', err);
        this.zoomToFeatureShape(row);
      },
    });
  }

  private zoomToFeatureShape(row: any): boolean {
    const feature = this.buildFeatureFromRow(row);
    if (!feature?.geometry) {
      const normalized = this.normalizeCurrentLayerDraft(row);
      const lat = Number(normalized?.lat);
      const lng = Number(normalized?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        this.deferMapZoom({ type: 'latlng', lat, lng, zoom: this.getEditFocusZoom(), draggable: false } as any);
        return true;
      }
      return false;
    }
    this.deferMapZoom({ type: 'feature', feature, pad: 0.24 } as any);
    return true;
  }

  private getFeatureCenterLatLng(feature: any): { lat: number; lng: number } | null {
    const geometry = feature?.geometry ?? feature;
    if (!geometry?.type) return null;

    const collect = (coords: any, points: Array<[number, number]>) => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        points.push([Number(coords[0]), Number(coords[1])]);
        return;
      }
      coords.forEach((child) => collect(child, points));
    };

    const points: Array<[number, number]> = [];
    collect(geometry.coordinates, points);
    const validPoints = points.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (!validPoints.length) return null;

    const lng = validPoints.reduce((sum, point) => sum + point[0], 0) / validPoints.length;
    const lat = validPoints.reduce((sum, point) => sum + point[1], 0) / validPoints.length;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  private getRecordDisplayName(row: any): string {
    const value =
      row?.sttncode ??
      row?.sttnname ??
      row?.asset_id ??
      row?.assetid ??
      row?.bridgeno ??
      row?.rorno ??
      row?.objectid ??
      '';
    return String(value || '').trim();
  }

  private deferMapZoom(target: any): void {
    setTimeout(() => this.mapZoom.zoomTo(target), 0);
  }

  private buildFeatureFromRow(row: any): any | null {
    const rawGeometry = row?.asset_geometry_geojson || row?.geometry_geojson || row?.geometry;
    const geometry = typeof rawGeometry === 'string'
      ? (() => {
          try { return JSON.parse(rawGeometry); } catch { return null; }
        })()
      : rawGeometry;
    if (!geometry?.type) return null;
    if (row?.type === 'Feature') return row;
    return {
      type: 'Feature',
      geometry,
      properties: row?.properties ?? row ?? {},
    };
  }

  private shouldAutoZoomOnEditOpen(): boolean {
    return true;
  }

  getSendButtonLabel(): string {
    if (this.saving) return 'Saving...';
    if (this.isBridgeLayer()) return 'Send to Checker';
    return 'Send';
  }

  get formFields(): EditFieldConfig[] {
    const cacheKey = [
      this.currentTableLayer || '',
      this.mode,
      this.makerTab,
      this.isMakerRejectedDraftView() ? 'rejected-draft' : '',
      this.isMakerSentForDeletionView() ? 'sent-for-deletion' : '',
    ].join('|');
    if (this.formFieldsCacheKey === cacheKey) return this.formFieldsCache;

    let fields = this.currentLayerSchema?.formFields || [];
    if (this.isMakerRejectedDraftView()) {
      fields = [...fields];
      fields.push({ key: 'comments', label: 'Comments', full: true });
    }
    if (this.currentTableLayer === 'stations' && this.isMakerSentForDeletionView()) {
      this.formFieldsCacheKey = cacheKey;
      this.formFieldsCache = fields;
      return this.formFieldsCache;
    }
    this.formFieldsCacheKey = cacheKey;
    this.formFieldsCache = fields.filter((field) => field.key !== 'status');
    return this.formFieldsCache;
  }

  get activeTableColumns(): TableColumnConfig[] {
    return this.currentLayerSchema?.tableColumns || [];
  }

  get tableColSpan(): number {
    return this.activeTableColumns.length + 1;
  }

  get unsupportedLayerSelected(): boolean {
    const selected = this.getActiveRawLayer();
    if (!selected) return false;
    const option = this.layerOptions.find((item) => item.value === selected);
    return !!option && !option.supported;
  }

  get selectedLayerLabel(): string {
    const selected = this.getActiveRawLayer();
    if (!selected) return '';
    return this.layerOptions.find((item) => item.value === selected)?.label || selected;
  }

  getCellValue(row: any, key: string): any {
    if (!row) return null;
    if (key === 'sttntype') return row?.sttntype ?? row?.stationtype;
    if (key === 'bridgeno') return row?.bridgeno ?? row?.rorno;
    if (key === 'robno') return row?.robno ?? row?.bridgeno ?? row?.rorno;
    if (key === 'rubno') return row?.rubno ?? row?.bridgeno ?? row?.rorno;
    if (key === 'rorno') return row?.rorno ?? row?.bridgeno;
    if (key === 'asset_id') return row?.asset_id ?? row?.assetid;
    if (key === 'constituncy') return row?.constituncy ?? row?.constituency;
    if (key === 'comments') {
      return row?.comments ?? row?.comment ?? row?.remarks ?? row?.remark ?? row?.reject_reason ?? row?.rejected_reason;
    }
    if (key === 'status') {
      return row?.status ?? row?.asset_status ?? row?.workflow_status;
    }
    return row?.[key];
  }

  formatCell(row: any, key: string): string {
    const value = this.getCellValue(row, key);
    if (value == null || value === '') return '--';
    return String(value);
  }

  getDeletionPendingWith(row: any): string {
    const status = row?.status == null ? '' : String(row.status).trim().toLowerCase();
    if (!status) return '--';
    if (status === 'sent to checker for deletion') return 'Checker';
    if (status === 'sent to approver for deletion') return 'Approver';
    if (status === 'sent for deletion' || status === 'sent to database') return 'Database';
    return row?.status ?? '--';
  }

  onLayerChange() {
    const selectedLayer = this.edit.editLayer;

    this.mode = 'table';
    this.rows = [];
    this.allRows = [];
    this.filteredRows = [];
    this.total = 0;
    this.filteredTotal = 0;
    this.page = 1;
    this.search = '';
    this.addRecordDrawingActive = false;
    this.error = null;
    this.draft = null;
    this.originalDraft = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;

        // ── reset attachment state (File 1 logic) ──
    this.attachmentFiles = [];
    this.uploadingAttachments = false;
    this.attachmentUploadError = null;
    // ───────────────────────────────────────────

    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();

    this.cdr.detectChanges();
    this.edit.setLayer(selectedLayer, true);
  }

  private syncSelectedFeatureDraft(): void {
    const layer = this.currentTableLayer;
    if (!layer) return;
    if (!this.edit.draft) return;
    if (layer === 'stations') return;

    this.mode = 'edit';
    this.ensureLocationOptionsLoaded();
    this.error = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;
    this.validating = false;
    this.saving = false;
    this.deleting = false;
    this.showAddRecordModal = false;
    this.addRecordDrawingActive = false;
    this.addRecordShapefileName = '';
        // ── reset attachment state (File 1 logic) ──
    this.attachmentFiles = [];
    this.uploadingAttachments = false;
    this.attachmentUploadError = null;
    // ───────────────────────────────────────────
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;

    const normalized = this.normalizeCurrentLayerDraft(this.edit.draft);
    this.draft = { ...normalized };
    this.originalDraft = { ...normalized };
    this.prepareLocationDropdownsForDraft(false);
  }

  isLocationSelectField(field: EditFieldConfig): boolean {
    return ['state', 'district', 'constituency', 'constituncy'].includes(field.key);
  }

  getLocationOptions(field: EditFieldConfig): LocationOption[] {
    const options = field.key === 'state'
      ? this.stateOptions
      : field.key === 'district'
        ? this.districtOptions
        : field.key === 'constituency' || field.key === 'constituncy'
          ? this.constituencyOptions
          : this.emptyLocationOptions;
    const current = field.key === 'constituency' || field.key === 'constituncy'
      ? this.getDraftConstituencyValue()
      : this.normalizeLocationValue(this.draft?.[field.key]);
    if (!current || options.some((option) => option.value === current)) return options;
    const optionsSignature = options.map((option) => option.value).join('|');
    const cacheKey = `${field.key}|${current}|${optionsSignature}`;
    const cached = this.locationOptionsCache.get(cacheKey);
    if (cached) return cached;
    const nextOptions = [{ value: current, label: current }, ...options];
    this.locationOptionsCache.set(cacheKey, nextOptions);
    return nextOptions;
  }

  getLocationPlaceholder(field: EditFieldConfig): string {
    if (field.key === 'state') return 'Select State';
    if (field.key === 'district') return 'Select District';
    if (field.key === 'constituency' || field.key === 'constituncy') return 'Select Constituency';
    return `Select ${field.label}`;
  }

  getLocationFieldValue(field: EditFieldConfig): string {
    if (field.key === 'constituency' || field.key === 'constituncy') {
      return this.getDraftConstituencyValue(field.key);
    }
    return this.normalizeLocationValue(this.draft?.[field.key]);
  }

  onLocationFieldValueChange(field: EditFieldConfig, value: any): void {
    if (!this.draft) return;
    this.draft[field.key] = this.normalizeLocationValue(value);

    if (field.key === 'state') {
      this.draft.state = this.normalizeLocationValue(this.draft.state);
      this.filterDistrictOptionsForDraftState(true);
      this.filterConstituencyOptionsForDraftState(true);
      return;
    }

    if (field.key === 'district') {
      this.draft.district = this.normalizeLocationValue(this.draft.district);
      return;
    }

    if (field.key === 'constituency' || field.key === 'constituncy') {
      this.setDraftConstituency(this.normalizeLocationValue(value));
    }
  }

  private getUserType(): string {
    return (this.currentUser.getSnapshot()?.user_type || '').trim().toLowerCase();
  }

  private getPersistenceLayerKey(): string | null {
    const layer = String(this.currentTableLayer || '').trim().toLowerCase();
    if (!layer) return null;
    if (layer === 'stations') return 'station';
    if (layer === 'rob') return 'road_over_bridge';
    return layer;
  }

  private getNormalizedBridgeAssetId(value: any = this.draft?.asset_id): string {
    return String(value || '').trim().toUpperCase();
  }

  private getOriginalBridgeAssetId(): string {
    return this.getNormalizedBridgeAssetId(this.originalDraft?.asset_id ?? this.originalDraft?.assetid);
  }

  private isRejectedBridgeAssetIdUnchanged(): boolean {
    if (!this.isBridgeLayer() || !this.isMaker() || !this.originalDraft) return false;
    const status = String(this.originalDraft?.status || '').trim().toLowerCase();
    if (status !== 'sent back to maker') return false;
    const currentAssetId = this.getNormalizedBridgeAssetId();
    const originalAssetId = this.getOriginalBridgeAssetId();
    return !!currentAssetId && !!originalAssetId && currentAssetId === originalAssetId;
  }

  private normalizeLocationValue(value: any): string {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  private getValueByNormalizedKey(source: any, aliases: string[]): any {
    if (!source || typeof source !== 'object') return undefined;
    const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
    for (const [key, value] of Object.entries(source)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aliasSet.has(normalizedKey) && value != null && String(value).trim() !== '') {
        return value;
      }
    }
    return undefined;
  }

  private uniqueLocationOptions(values: Array<{ value: any; label?: any; stateLgd?: any; state?: any }>): LocationOption[] {
    const seen = new Set<string>();
    const options: LocationOption[] = [];
    values.forEach((item) => {
      const value = this.normalizeLocationValue(item.value);
      if (!value || seen.has(value)) return;
      seen.add(value);
      const stateLgd = Number(item.stateLgd);
      options.push({
        value,
        label: this.normalizeLocationValue(item.label ?? item.value),
        stateLgd: Number.isFinite(stateLgd) ? stateLgd : null,
        state: this.normalizeLocationValue(item.state),
      });
    });
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  private uniqueConstituencyOptions(values: Array<{ value: any; label?: any; state?: any }>): LocationOption[] {
    const seen = new Set<string>();
    const options: LocationOption[] = [];
    values.forEach((item) => {
      const value = this.normalizeLocationValue(item.value);
      const state = this.normalizeLocationValue(item.state);
      const key = `${state}::${value}`;
      if (!value || seen.has(key)) return;
      seen.add(key);
      options.push({
        value,
        label: this.normalizeLocationValue(item.label ?? item.value),
        state,
      });
    });
    return options.sort((a, b) => {
      const stateCompare = this.normalizeLocationValue(a.state).localeCompare(this.normalizeLocationValue(b.state));
      return stateCompare || a.label.localeCompare(b.label);
    });
  }

  private uniqueStateScopedOptions(values: Array<{ value: any; label?: any; state?: any }>): LocationOption[] {
    const seen = new Set<string>();
    const options: LocationOption[] = [];
    values.forEach((item) => {
      const value = this.normalizeLocationValue(item.value);
      const state = this.normalizeLocationValue(item.state);
      const key = `${state}::${value}`;
      if (!value || seen.has(key)) return;
      seen.add(key);
      options.push({
        value,
        label: this.normalizeLocationValue(item.label ?? item.value),
        state,
      });
    });
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  private matchLocationOption(options: LocationOption[], value: any): string {
    const normalized = this.normalizeLocationValue(value);
    if (!normalized) return '';
    return options.find((option) => this.normalizeLocationValue(option.value) === normalized)?.value || normalized;
  }

  private setDraftConstituency(value: any): void {
    if (!this.draft) return;
    const normalized = this.normalizeLocationValue(value);
    this.draft.constituency = normalized;
    if (Object.prototype.hasOwnProperty.call(this.draft, 'constituncy')) this.draft.constituncy = normalized;
    if (this.formFields.some((field) => field.key === 'constituncy')) this.draft.constituncy = normalized;
  }

  private getDraftConstituencyValue(preferredKey?: string): string {
    const preferred = this.normalizeLocationValue(preferredKey ? this.draft?.[preferredKey] : '');
    if (preferred) return preferred;
    const constituncy = this.normalizeLocationValue(this.draft?.constituncy);
    if (constituncy) return constituncy;
    const constituency = this.normalizeLocationValue(this.draft?.constituency);
    if (constituency) return constituency;
    return this.normalizeLocationValue(this.getValueByNormalizedKey(this.draft, [
      'constituncy',
      'constituency',
      'constituen',
      'constituency_name',
      'parliamentary_constituency',
      'pc_name',
      'pc',
    ]));
  }

  private loadLocationOptions(): void {
    this.api.getRailways().subscribe({
      next: (res: any) => {
        const rows = this.extractLookupRows(res);
        const nextMap = new Map<string, string>();
        rows.forEach((row: any) => {
          const name = String(row?.rly_name || '').trim();
          const code = String(row?.rlycode || '').trim();
          if (name && code) nextMap.set(name.toLowerCase(), code);
        });
        this.railwayCodeByName = nextMap;
        this.cdr.detectChanges();
      },
      error: (err: any) => console.error('Railway lookup failed:', err),
    });

    this.api.getStates().subscribe({
      next: (res: any) => {
        const rows = this.extractLookupRows(res);
        this.stateOptions = this.uniqueLocationOptions(rows.map((row: any) => ({
          value: row?.state,
          label: row?.state,
          stateLgd: row?.state_lgd,
        })));
        this.prepareLocationDropdownsForDraft(false);
        this.cdr.detectChanges();
      },
      error: (err: any) => console.error('State lookup failed:', err),
    });

    this.api.getDistricts().subscribe({
      next: (res: any) => {
        const rows = this.extractLookupRows(res);
        this.allDistrictOptions = this.uniqueStateScopedOptions(rows.map((row: any) => ({
          value: row?.district,
          label: row?.district,
          state: row?.state,
        })));
        this.filterDistrictOptionsForDraftState();
        this.cdr.detectChanges();
      },
      error: (err: any) => console.error('District lookup failed:', err),
    });

    this.api.getParliamentaryConstituencies().subscribe({
      next: (res: any) => {
        const rows = this.extractLookupRows(res);
        this.allConstituencyOptions = this.uniqueConstituencyOptions(rows.map((row: any) => ({
          value: row?.constituen ?? row?.constituency_name,
          label: row?.constituen ?? row?.constituency_name,
          state: row?.state,
        })));
        this.filterConstituencyOptionsForDraftState();
        this.cdr.detectChanges();
      },
      error: (err: any) => console.error('Parliamentary constituency lookup failed:', err),
    });
  }

  private extractLookupRows(res: any): any[] {
    if (Array.isArray(res?.data)) return res.data;
    if (Array.isArray(res?.rows)) return res.rows;
    if (Array.isArray(res)) return res;
    return [];
  }

  private ensureLocationOptionsLoaded(): void {
    if (
      this.stateOptions.length &&
      this.districtOptions.length &&
      this.constituencyOptions.length &&
      this.railwayCodeByName.size
    ) return;
    this.loadLocationOptions();
  }

  private prepareLocationDropdownsForDraft(resetDependents: boolean): void {
    if (!this.draft) return;
    const matchedState = this.matchLocationOption(this.stateOptions, this.draft.state);
    this.draft.state = matchedState || this.normalizeLocationValue(this.draft.state);
    const constituency = this.getDraftConstituencyValue();
    if (constituency) this.setDraftConstituency(constituency);
    if (resetDependents) {
      this.draft.district = '';
      this.setDraftConstituency('');
    }
    this.filterDistrictOptionsForDraftState();
    this.draft.district = this.matchLocationOption(this.districtOptions, this.draft.district);
    this.filterConstituencyOptionsForDraftState();
  }

  private filterDistrictOptionsForDraftState(clearInvalid = false): void {
    const state = this.normalizeLocationValue(this.draft?.state);
    this.districtOptions = state
      ? this.allDistrictOptions.filter((option) => this.normalizeLocationValue(option.state) === state)
      : [...this.allDistrictOptions];

    const current = this.normalizeLocationValue(this.draft?.district);
    if (!current) return;
    const matched = this.districtOptions.find((option) => this.normalizeLocationValue(option.value) === current)?.value;
    if (matched) {
      this.draft.district = matched;
    } else if (clearInvalid) {
      this.draft.district = '';
    }
  }

  private filterConstituencyOptionsForDraftState(clearInvalid = false): void {
    const state = this.normalizeLocationValue(this.draft?.state);
    this.constituencyOptions = state
      ? this.allConstituencyOptions.filter((option) => this.normalizeLocationValue(option.state) === state)
      : [...this.allConstituencyOptions];

    const current = this.getDraftConstituencyValue();
    if (!current) return;
    const matched = this.constituencyOptions.find((option) => this.normalizeLocationValue(option.value) === current)?.value;
    if (matched) {
      this.setDraftConstituency(matched);
    } else if (clearInvalid) {
      this.setDraftConstituency('');
    }
  }

  private requiresBridgeAssetValidationBeforeSend(): boolean {
    if (!this.isBridgeLayer() || !this.isMaker()) return false;
    const assetId = this.getNormalizedBridgeAssetId();
    if (!assetId) return false;
    if (this.isRejectedBridgeAssetIdUnchanged()) return false;
    return assetId !== this.validatedBridgeAssetId;
  }

  private applyValidatedBridgeAsset(row: any): void {
    if (!this.draft || !row) return;
    const source = row?.raw && typeof row.raw === 'object' ? row.raw : row;
    const currentLayer = String(this.currentTableLayer || '').trim().toLowerCase();

    const pick = (...values: any[]) => {
      for (const value of values) {
        if (value != null && String(value).trim() !== '') return value;
      }
      return undefined;
    };

    this.draft.asset_id = pick(row.asset_id, this.draft.asset_id);
    this.draft.distkm = currentLayer === 'bridge_end'
      ? pick(source?.kmto, row.distkm, this.draft.distkm)
      : pick(source?.kmfrom, row.distkm, this.draft.distkm);
    this.draft.distm = currentLayer === 'bridge_end'
      ? pick(source?.metto, row.distm, this.draft.distm)
      : pick(source?.metfrom, row.distm, this.draft.distm);
    this.draft.railway = pick(row.railway, this.draft.railway);
    this.draft.division = pick(row.division, this.draft.division);
    this.draft.tmssection = pick(source?.stationsection, source?.tmssection, row.tmssection, this.draft.tmssection);
    this.draft.state = pick(row.state, this.draft.state);
    this.draft.district = pick(row.district, this.draft.district);
    this.draft.bridgeno = pick(source?.bridgeno, row.bridgeno, this.draft.bridgeno);
    if (currentLayer === 'road_over_bridge' || currentLayer === 'rob') {
      this.draft.robno = pick(source?.robno, source?.bridgeno, row.robno, row.bridgeno, this.draft.robno);
    }
    if (currentLayer === 'rub_lhs') {
      this.draft.rubno = pick(source?.rubno, source?.bridgeno, row.rubno, row.bridgeno, this.draft.rubno);
    }
    if (currentLayer === 'ror') {
      this.draft.rorno = pick(source?.rorno, source?.bridgeno, row.rorno, row.bridgeno, this.draft.rorno);
    }
    this.draft.constituency = pick(source?.constituency, source?.constituncy, row.constituency, row.constituncy, this.draft.constituency, this.draft.constituncy);
    if (Object.prototype.hasOwnProperty.call(this.draft, 'constituncy')) this.draft.constituncy = this.draft.constituency;
    this.draft.bridgetype = pick(source?.bridgetype, row.bridgetype, this.draft.bridgetype);
    this.draft.spanconf = pick(source?.spanconf, row.spanconf, this.draft.spanconf);

    const latitude = Number(row?.latitude ?? row?.ycoord);
    const longitude = Number(row?.longitude ?? row?.xcoord);
    if (Number.isFinite(latitude)) {
      this.draft.latitude = latitude;
      this.draft.ycoord = latitude;
      this.draft.lat = latitude;
    }
    if (Number.isFinite(longitude)) {
      this.draft.longitude = longitude;
      this.draft.xcoord = longitude;
      this.draft.lng = longitude;
      this.draft.lon = longitude;
    }
    this.prepareLocationDropdownsForDraft(false);
  }

  private getEditFocusZoom(): number {
    const layer = String(this.currentTableLayer || '').trim().toLowerCase();
    if (!layer) return EditPanel.DEFAULT_LAYER_ZOOM;
    if (layer === 'stations' || layer === 'station') return EditPanel.STATION_LAYER_ZOOM;
    return EditPanel.NON_POINT_LAYERS.has(layer)
      ? EditPanel.DEFAULT_LAYER_ZOOM
      : EditPanel.POINT_LAYER_ZOOM;
  }

  private isCurrentLayerNonPoint(): boolean {
    const layer = String(this.currentTableLayer || '').trim().toLowerCase();
    return EditPanel.NON_POINT_LAYERS.has(layer);
  }

  private normalizeLayerValue(value: any): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toEditLayerKey(layer: any): EditLayerKey | null {
    const id = normalizeCivilEngineeringLayerId(this.normalizeLayerValue(layer?.layer_id));
    const name = normalizeCivilEngineeringLayerId(this.normalizeLayerValue(layer?.layar_name));
    const combined = `${id} ${name}`.trim();

    if (id === 'stations' || name === 'stations' || combined.includes('station')) return 'stations';
    if (id === 'landplan_ontrack' || name === 'landplan_ontrack' || combined.includes('land plan')) return 'landplan_ontrack';
    return getEditLayerConfig(id)?.id || getEditLayerConfig(name)?.id || null;
  }

  private makeUnsupportedLayerValue(layerId: any): string {
    return `unsupported:${String(layerId || '').trim()}`;
  }

  private loadAssignedMakerLayers(): void {
    const currentUserId = String(this.currentUser.getSnapshot()?.user_id || '').trim();
    if (!currentUserId) {
      this.makerLayerOptions = [];
      return;
    }

    this.api.getMakerLayerList(currentUserId).subscribe({
      next: (res: any) => {
        const makers = Array.isArray(res?.makers) ? res.makers : [];
        const normalizedCurrentUserId = currentUserId.toLowerCase();
        const maker = makers.find(
          (item: any) => String(item?.user_id || '').trim().toLowerCase() === normalizedCurrentUserId,
        );

        if (!maker?.department_id) {
          this.makerLayerOptions = [];
          this.ensureSelectedLayerStillAllowed();
          this.cdr.detectChanges();
          return;
        }

        const assignedIds = String(maker?.assigned_layers || '')
          .split(',')
          .map((value) => String(value || '').trim())
          .filter(Boolean);

        this.api.getDepartmentLayers(String(maker.department_id).trim()).subscribe({
          next: (layers: any) => {
            const departmentLayers = Array.isArray(layers) ? layers : [];
            const nextOptions: MakerLayerOption[] = [];
            const seenValues = new Set<string>();

            departmentLayers
              .filter((layer: any) => assignedIds.includes(String(layer?.layer_id || '').trim()))
              .forEach((layer: any) => {
                const editKey = this.toEditLayerKey(layer);
                const value = editKey || this.makeUnsupportedLayerValue(layer?.layer_id);
                if (seenValues.has(value)) return;
                seenValues.add(value);
                nextOptions.push({
                  value,
                  label: getCivilEngineeringAssetLayerDisplayName(
                    String(layer?.layer_id || '').trim(),
                    String(layer?.layar_name || '').trim()
                  ),
                  supported: !!editKey,
                });
              });

            this.makerLayerOptions = nextOptions;
            this.ensureSelectedLayerStillAllowed();
            this.cdr.detectChanges();
          },
          error: () => {
            this.makerLayerOptions = [];
            this.ensureSelectedLayerStillAllowed();
            this.cdr.detectChanges();
          },
        });
      },
      error: () => {
        this.makerLayerOptions = [];
        this.ensureSelectedLayerStillAllowed();
        this.cdr.detectChanges();
      },
    });
  }

  private ensureSelectedLayerStillAllowed(): void {
    if (!this.isMakerEditLayerPicker()) return;
    const allowed = new Set(this.makerLayerOptions.map((option) => option.value));
    if (this.edit.editLayer && !allowed.has(this.edit.editLayer)) {
      this.edit.editLayer = null as any;
      this.edit.resetSelection();
    }
  }

  isChecker(): boolean {
    return this.getUserType() === 'checker';
  }

  isMaker(): boolean {
    return this.getUserType() === 'maker';
  }

  isApprover(): boolean {
    return this.getUserType() === 'approver';
  }

  isReviewer(): boolean {
    return this.isChecker() || this.isApprover();
  }

  setMakerTab(tab: MakerTabKey) {
    this.makerTab = tab; this.mode = 'table'; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.search = ''; this.page = 1; this.error = null; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0;
    if (tab === 'edit') { this.rejectedLayer = null; this.edit.setLayer(null as any); this.edit.editLayer = null as any; } else if (tab !== 'rejected') { this.rejectedLayer = null; }
    if (this.currentTableLayer && tab !== 'rejected') setTimeout(() => this.load(true), 0);
  }
  setCheckerTab(tab: CheckerTabKey) {
    this.checkerTab = tab; this.mode = 'table'; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.search = ''; this.page = 1; this.error = null; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.edit.setLayer(null as any); this.edit.editLayer = null as any;
  }
  isCheckerSentToApproverView(): boolean { return this.isReviewer() && this.mode === 'table' && this.checkerTab === 'approved'; }
  isCheckerDeletionProposedView(): boolean { return this.isReviewer() && this.checkerTab === 'deletion_proposed'; }
  isMakerRejectedView(): boolean { return this.isMaker() && this.mode === 'table' && this.makerTab === 'rejected'; }
  isMakerRejectedDraftView(): boolean { return this.isMaker() && this.mode === 'edit' && this.makerTab === 'rejected'; }
  isMakerSentForDeletionView(): boolean { return this.isMaker() && this.makerTab === 'sent_for_deletion'; }
  isStationFieldsLocked(): boolean { return this.stationValidated || this.isReviewer() || this.isMakerSentForDeletionView(); }
  private getReviewerDraftStatus(): string {
    if (!this.isReviewer()) return '';
    if (this.checkerTab === 'pending') {
      return this.isApprover() ? WORKFLOW_STATUS.approverPending : WORKFLOW_STATUS.checkerPending;
    }
    if (this.checkerTab === 'approved') return WORKFLOW_STATUS.finalised;
    if (this.checkerTab === 'deletion_proposed') {
      return this.isApprover() ? WORKFLOW_STATUS.approverDeletion : WORKFLOW_STATUS.checkerDeletion;
    }
    return '';
  }
  get currentTableLayer(): EditLayerKey | null {
    const rawLayer = this.isMakerRejectedView() ? this.rejectedLayer : this.edit.editLayer;
    if (!rawLayer) return null;
    return getEditLayerConfig(rawLayer)?.id || null;
  }

  onRejectedLayerChange() {
    this.mode = 'table'; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.page = 1; this.search = ''; this.error = null; this.draft = null;
    this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.clearHighlight();
    this.edit.setLayer((this.rejectedLayer as any) ?? null, true);
    if (this.rejectedLayer) setTimeout(() => this.load(true), 0);
  }

  private updateReviewerDraftStatus(row: any, status: 'Sent to Approver' | 'Sent Back to Maker' | 'Sent to Database' | 'Sent to Approver for Deletion' | 'Asset Deleted') {
    if (!this.isReviewer()) return;
    if (!this.supportsCurrentLayerPersistence()) {
      this.notifyAlert(`${this.currentLayerSchema?.label || 'This layer'} workflow is not wired yet.`);
      return;
    }

    const id = Number(row?.objectid);
    if (!Number.isFinite(id)) {
      this.error = 'Invalid draft record';
      this.cdr.detectChanges();
      return;
    }

    this.saving = true;
    this.error = null;

    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) {
      this.saving = false;
      this.error = 'Layer workflow is not available';
      this.cdr.detectChanges();
      return;
    }

    this.api.updateLayerDraftStatus(layerKey, id, status).subscribe({
      next: (res: any) => {
        const updatedDraft = res?.draft || row;
        const updatedId = Number(updatedDraft?.objectid ?? row?.objectid);
        this.saving = false;

        const alertText = status === 'Sent to Approver'
          ? 'Asset Sent to Approver'
          : status === 'Sent to Approver for Deletion'
            ? 'Asset Sent to Approver for Deletion'
            : status === 'Sent Back to Maker'
              ? 'Asset Sent Back to Maker'
              : status === 'Asset Deleted'
                ? 'Asset Deleted'
                : 'Asset Finalised';
        this.notifyAlert(alertText);

        if (this.draft && Number(this.draft?.objectid) === updatedId) {
          this.mode = 'table';
          this.draft = null;
          this.originalDraft = null;
          this.stationValidated = false;
          this.geomEditing = false;
          this.dragSub?.unsubscribe();
          this.dragSub = undefined;
          this.mapZoom.zoomHome();
          this.mapZoom.clearHighlight();
        }

        setTimeout(() => this.load(false), 0);
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.saving = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to update draft status';
        this.cdr.detectChanges();
      }
    });
  }

  acceptRow(row: any) {
    const nextStatus = this.isApprover() ? 'Sent to Database' : 'Sent to Approver';
    this.updateReviewerDraftStatus(row, nextStatus);
  }
  rejectRow(row: any) { this.updateReviewerDraftStatus(row, 'Sent Back to Maker'); }
  forwardDraft() { if (!this.draft) return; this.acceptRow(this.draft); }
  sentBackDraft() { if (!this.draft) return; this.rejectRow(this.draft); }
  sendToApproverDraft() { if (!this.draft) return; this.forwardDraft(); }
  sendBackToMakerDraft() { if (!this.draft) return; this.sentBackDraft(); }
  saveToDatabaseDraft() { if (!this.draft) return; this.updateReviewerDraftStatus(this.draft, 'Sent to Database'); }

  private isVisibleForUser(row: any): boolean {
    const userType = this.getUserType();
    const status = row?.status == null ? '' : String(row.status).trim().toLowerCase();
    if (userType === 'maker') {
      return status === '';
    }
    if (userType === 'checker') return status === 'sent to checker';
    if (userType === 'approver') return status === 'sent to approver';
    return true;
  }

  private shouldLoadDraftTable(): boolean {
    return this.isReviewer() || this.isMakerRejectedView() || this.isMakerSentForDeletionView();
  }

  private getDraftStatusForCurrentView(): string {
    if (this.isMakerRejectedView()) return WORKFLOW_STATUS.makerRejected;
    if (this.isMakerSentForDeletionView()) return '';
    if (this.isReviewer()) return this.getReviewerDraftStatus();
    return '';
  }

  private getMainTableStatusFilter(): string {
    if (!this.isMaker() || this.makerTab !== 'edit') return '';
    return '__empty__';
  }

  private shouldFetchAllPagesForCurrentView(): boolean {
    return this.isMakerSentForDeletionView();
  }

  private fetchCurrentLayerPage(layerKey: string, page: number, pageSize: number, search: string) {
    const status = this.getDraftStatusForCurrentView();
    const isDraft = this.shouldLoadDraftTable();
    const mainStatus = this.getMainTableStatusFilter();

    if (layerKey === 'bridge_start') {
      return isDraft
        ? this.api.getBridgeStartDraftTable(page, pageSize, search, status)
        : this.api.getBridgeStartTable(page, pageSize, search, mainStatus);
    }

    if (layerKey === 'bridge_end') {
      return isDraft
        ? this.api.getBridgeEndDraftTable(page, pageSize, search, status)
        : this.api.getBridgeEndTable(page, pageSize, search, mainStatus);
    }

    if (layerKey === 'bridge_minor') {
      return isDraft
        ? this.api.getBridgeMinorDraftTable(page, pageSize, search, status)
        : this.api.getBridgeMinorTable(page, pageSize, search, mainStatus);
    }

    return isDraft
      ? this.api.getLayerDraftTable(layerKey, page, pageSize, search, status)
      : this.api.getLayerTable(layerKey, page, pageSize, search, mainStatus);
  }

  private getTableLoadErrorMessage(err: any): string {
    if (err?.name === 'TimeoutError') {
      return 'Layer table request timed out. Please check that the backend API is running.';
    }
    if (err?.status === 0) {
      return 'Backend API is not reachable. Please start/restart the backend server on port 4000.';
    }
    return err?.error?.message || err?.error?.error || err?.message || 'Failed to load layer table';
  }

  private applyPagination(): void {
    const start = (this.page - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.rows = this.filteredRows.slice(start, end);
    this.filteredTotal = this.filteredRows.length;
    this.total = this.filteredTotal;
  }

  load(resetPage = false): void {
    const layer = this.currentTableLayer;
    if (!this.supportsCurrentLayerListing()) {
      this.allRows = []; this.filteredRows = []; this.rows = []; this.total = 0; this.filteredTotal = 0; this.loading = false; this.error = null; this.cdr.detectChanges();
      return;
    }

    const division = (this.currentUser.getSnapshot()?.division || '').trim();
    if (!division) {
      this.error = 'Division missing in current user session';
      this.cdr.detectChanges();
      return;
    }

    if (resetPage) this.page = 1;
    this.loading = true;
    this.error = null;

    const seq = ++this.loadSeq;
    const collected: any[] = [];
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) {
      this.loading = false;
      this.error = 'Layer workflow is not available';
      this.cdr.detectChanges();
      return;
    }

    if (!this.shouldFetchAllPagesForCurrentView()) {
      this.fetchCurrentLayerPage(layerKey, this.page, this.pageSize, this.search).subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          const rows: any[] = Array.isArray(res?.rows) ? res.rows : [];
          this.allRows = rows;
          this.filteredRows = rows.filter((r) => this.isVisibleForCurrentView(r));
          this.rows = this.filteredRows;
          this.total = Number(res?.total ?? this.filteredRows.length);
          this.filteredTotal = this.total;
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          if (seq !== this.loadSeq) return;
          console.error('getLayerTable failed', err);
          this.allRows = []; this.filteredRows = []; this.rows = []; this.total = 0; this.filteredTotal = 0; this.loading = false;
          this.error = this.getTableLoadErrorMessage(err);
          this.cdr.detectChanges();
        },
      });
      return;
    }

    const fetchOne = (p: number) => {
      if (seq !== this.loadSeq) return;

      this.fetchCurrentLayerPage(layerKey, p, this.fetchPageSize, this.search).subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          const rows = Array.isArray(res?.rows) ? res.rows : [];
          collected.push(...rows);
          if (rows.length < this.fetchPageSize) {
            this.allRows = collected;
            this.filteredRows = this.allRows.filter((r) => this.isVisibleForCurrentView(r));
            this.applyPagination();
            this.loading = false;
            this.cdr.detectChanges();
            return;
          }
          fetchOne(p + 1);
        },
        error: (err) => {
          if (seq !== this.loadSeq) return;
          console.error('getLayerTable failed', err);
          this.allRows = []; this.filteredRows = []; this.rows = []; this.total = 0; this.filteredTotal = 0; this.loading = false;
          this.error = this.getTableLoadErrorMessage(err);
          this.cdr.detectChanges();
        },
      });
    };

    fetchOne(1);
  }

  private isVisibleForCurrentView(row: any): boolean {
    if (this.isMaker() && this.mode === 'table' && this.makerTab === 'sent_for_deletion') {
      const status = row?.status == null ? '' : String(row.status).trim().toLowerCase();
      return status === 'sent to checker for deletion' || status === 'sent to approver for deletion' || status === 'asset deleted';
    }
    if (this.isMakerRejectedView()) {
      const status = row?.status == null ? '' : String(row.status).trim().toLowerCase();
      return status === 'sent back to maker';
    }
    if (this.isReviewer() && this.mode === 'table') {
      const status = row?.status == null ? '' : String(row.status).trim().toLowerCase();
      if (this.checkerTab === 'pending') return this.isApprover() ? status === 'sent to approver' : status === 'sent to checker';
      if (this.checkerTab === 'approved') return status === 'sent to database';
      if (this.checkerTab === 'deletion_proposed') return this.isApprover() ? status === 'sent to approver for deletion' : status === 'sent to checker for deletion';
    }
    return this.isVisibleForUser(row);
  }

  onSearchChange() { this.page = 1; this.load(true); }
  nextPage() {
    if (this.page >= this.totalPages) return;
    this.page++;
    if (this.shouldFetchAllPagesForCurrentView()) {
      this.applyPagination();
      this.cdr.detectChanges();
      return;
    }
    this.load(false);
  }

  prevPage() {
    if (this.page <= 1) return;
    this.page--;
    if (this.shouldFetchAllPagesForCurrentView()) {
      this.applyPagination();
      this.cdr.detectChanges();
      return;
    }
    this.load(false);
  }

  // ── Add Record Modal (File 2) ────────────────────────────────
  startAddRecord() {
    if (!this.currentTableLayer) return;
    this.addRecordDrawingActive = false;
    this.showAddRecordModal = true;
    this.resetAddRecordShapefileState();
    this.cdr.detectChanges();
  }

  closeAddRecordModal(): void {
    this.showAddRecordModal = false;
    this.addRecordUploadHandled = true;
    this.loading = false;
    this.resetAddRecordShapefileState();
    this.cdr.detectChanges();
  }

  get addRecordDrawingModeActive(): boolean {
    return this.addRecordDrawingActive || this.edit.creatingStation;
  }

  startAddRecordWithDrawingTool(): void {
    if (!this.currentTableLayer) return;
    this.addRecordDrawingActive = true;
    this.showAddRecordModal = false;
    this.error = null;
    this.mode = 'table';
    this.draft = null;
    this.originalDraft = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;
    this.validating = false;
    this.saving = false;
    this.deleting = false;
    this.attachmentFiles = [];
    this.attachmentUploadError = null;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();

    this.edit.startCreateStation();
    const layerLabel = this.currentLayerSchema?.label || this.selectedLayerLabel || 'asset';
    this.notifyAlert(`Drawing mode is on. Double-click inside the division buffer to place the new ${layerLabel}.`);

    this.cdr.detectChanges();
  }

  cancelAddNewRecordDrawing(): void {
    this.addRecordDrawingActive = false;
    this.edit.cancelCreateStation();
    this.mode = 'table';
    this.draft = null;
    this.originalDraft = null;
    this.error = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;
    this.showAddRecordModal = false;
    this.validating = false;
    this.saving = false;
    this.deleting = false;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();
    this.cdr.detectChanges();
  }

  onAddRecordShapefileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const selectedFiles = input?.files ? Array.from(input.files) : [];
    const allowedExtensions = this.getAllowedShapefileExtensions();
    const validFiles = selectedFiles.filter((file) => allowedExtensions.includes(this.getFileExtension(file)));
    const skippedCount = selectedFiles.length - validFiles.length;

    this.addRecordShapefileFiles = validFiles;
    this.addRecordShapefileName = validFiles.map((file) => file.name).join(', ');
    this.addRecordShapefileProgress = 0;
    this.addRecordShapefileError = skippedCount
      ? `${skippedCount} file(s) skipped. Only shapefile parts are allowed.`
      : null;
    this.cdr.detectChanges();
  }

  removeAddRecordShapefile(index: number): void {
    if (index < 0 || index >= this.addRecordShapefileFiles.length) return;
    this.addRecordShapefileFiles.splice(index, 1);
    this.addRecordShapefileName = this.addRecordShapefileFiles.map((file) => file.name).join(', ');
    this.addRecordShapefileError = null;
    if (!this.addRecordShapefileFiles.length) this.clearAddRecordShapefileInput();
    this.cdr.detectChanges();
  }

  async uploadAddRecordShapefile(): Promise<void> {
    if (this.addRecordShapefileUploading) return;

    const targetLayerName = this.getAddRecordShapefileTargetLayer();
    if (!targetLayerName) {
      this.addRecordShapefileError = 'Please select an assigned layer before uploading.';
      this.cdr.detectChanges();
      return;
    }

    if (!this.addRecordShapefileFiles.length) {
      this.addRecordShapefileError = 'Please choose shapefile parts before uploading.';
      this.cdr.detectChanges();
      return;
    }

    const validationError = this.getMissingAddRecordShapefilePartsError();
    if (validationError) {
      this.addRecordShapefileError = validationError;
      this.cdr.detectChanges();
      return;
    }

    this.addRecordShapefileUploading = true;
    this.addRecordUploadInFlight = true;
    this.addRecordShapefileProgress = 0;
    this.addRecordShapefileError = null;
    this.addRecordUploadHandled = false;
    if (this.addRecordProcessingTimer) clearTimeout(this.addRecordProcessingTimer);
    if (this.addRecordPollTimer) clearTimeout(this.addRecordPollTimer);
    this.addRecordProcessingTimer = setTimeout(() => {
      if (this.addRecordShapefileUploading || this.addRecordShapefileProcessing) {
        this.beginAddRecordBackgroundLookup();
      }
    }, 7000);
    this.error = null;
    this.cdr.detectChanges();

    try {
      const result = await this.fileUploadService.uploadShapefiles(
        this.addRecordShapefileFiles,
        'Created from edit tool add record workflow',
        'add-record',
        targetLayerName,
        (progress) => {
          this.addRecordShapefileProgress = progress;
          this.addRecordShapefileProcessing = progress >= 100;
          this.cdr.detectChanges();
        },
      );

      const firstObjectId = Number(result?.firstObjectId ?? result?.insertedObjectIds?.[0]);
      if (this.addRecordProcessingTimer) {
        clearTimeout(this.addRecordProcessingTimer);
        this.addRecordProcessingTimer = undefined;
      }
      if (this.addRecordPollTimer) {
        clearTimeout(this.addRecordPollTimer);
        this.addRecordPollTimer = undefined;
      }
      this.addRecordShapefileUploading = false;
      this.addRecordShapefileProcessing = false;
      this.showAddRecordModal = false;
      this.resetAddRecordShapefileState();
      this.cdr.detectChanges();

      setTimeout(() => {
        if (Number.isFinite(firstObjectId)) {
          this.addRecordUploadHandled = true;
          this.openUploadedRecordByObjectId(firstObjectId);
        } else if (!this.addRecordUploadHandled) {
          this.addRecordUploadHandled = true;
          this.openNewestRecordAfterUpload();
        }
      }, 0);
    } catch (err: any) {
      this.addRecordShapefileError = err?.message || 'Failed to upload shapefile';
    } finally {
      this.addRecordUploadInFlight = false;
      if (this.addRecordProcessingTimer && !this.showAddRecordModal) {
        clearTimeout(this.addRecordProcessingTimer);
        this.addRecordProcessingTimer = undefined;
      }
      if (this.showAddRecordModal) {
        this.addRecordShapefileUploading = false;
        this.addRecordShapefileProcessing = false;
      }
      this.cdr.detectChanges();
    }
  }

  private getAddRecordShapefileTargetLayer(): string {
    return String(this.currentTableLayer || '').trim().toLowerCase();
  }

  private getAllowedShapefileExtensions(): string[] {
    return ['.shp', '.shx', '.dbf', '.prj', '.cpg', '.qpj', '.sbn', '.sbx'];
  }

  private getRequiredShapefileExtensions(): string[] {
    return ['.shp', '.shx', '.dbf'];
  }

  private getFileExtension(file: File): string {
    const name = String(file?.name || '').toLowerCase();
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex) : '';
  }

  private getMissingAddRecordShapefilePartsError(): string | null {
    const requiredExtensions = this.getRequiredShapefileExtensions();
    const grouped = this.addRecordShapefileFiles.reduce((acc, file) => {
      const ext = this.getFileExtension(file);
      if (!requiredExtensions.includes(ext)) return acc;

      const base = file.name.slice(0, file.name.length - ext.length).trim().toLowerCase();
      if (!acc[base]) acc[base] = new Set<string>();
      acc[base].add(ext);
      return acc;
    }, {} as Record<string, Set<string>>);

    const hasValidBundle = Object.values(grouped).some((exts) =>
      requiredExtensions.every((ext) => exts.has(ext)),
    );
    if (hasValidBundle) return null;

    const missing = requiredExtensions.filter(
      (ext) => !this.addRecordShapefileFiles.some((file) => this.getFileExtension(file) === ext),
    );
    return `Shapefile upload requires .shp, .shx and .dbf files. Missing: ${missing.join(', ') || 'required file parts'}.`;
  }

  private resetAddRecordShapefileState(): void {
    if (this.addRecordProcessingTimer) {
      clearTimeout(this.addRecordProcessingTimer);
      this.addRecordProcessingTimer = undefined;
    }
    if (this.addRecordPollTimer) {
      clearTimeout(this.addRecordPollTimer);
      this.addRecordPollTimer = undefined;
    }
    this.addRecordShapefileFiles = [];
    this.addRecordShapefileName = '';
    this.addRecordShapefileProgress = 0;
    this.addRecordShapefileProcessing = false;
    this.addRecordShapefileError = null;
    this.addRecordShapefileUploading = false;
    this.clearAddRecordShapefileInput();
  }

  private clearAddRecordShapefileInput(): void {
    if (this.addRecordShapefileInput?.nativeElement) {
      this.addRecordShapefileInput.nativeElement.value = '';
    }
  }
    // ────────────────────────────────────────────────────────────

  private beginStationCreationDraft(lat: number, lng: number) {
    const railway = this.getRailwayName();
    const department = localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '';

    this.addRecordDrawingActive = false;
    this.mode = 'edit';
    this.ensureLocationOptionsLoaded();
    this.error = null;
    this.stationValidated = false;
    this.validating = false;
    this.saving = false;
    this.deleting = false;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;

    this.draft = {
      objectid: null,
      sttncode: '',
      sttnname: '',
      stationtype: '',
      category: '',
      distkm: null,
      distm: null,
      state: '',
      district: '',
      constituency: '',
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      xcoord: lng,
      ycoord: lat,
      railway: this.getRailwayCode(),
      zone_name: railway,
      department,
    };
    this.originalDraft = { ...this.draft };
    this.prepareLocationDropdownsForDraft(false);
    this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: EditPanel.NEW_ASSET_ZOOM, draggable: false } as any);
    this.cdr.detectChanges();
  }

  private beginGenericCreationDraft(lat?: number, lng?: number) {
    const layer = this.currentTableLayer;
    if (!layer || !this.currentLayerSchema) return;

    this.addRecordDrawingActive = false;
    const division = String(this.currentUser.getSnapshot()?.division || localStorage.getItem('division') || '').trim();
    const department = String(localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '').trim();
    const railwayName = this.getRailwayName();
    const railwayCode = this.getRailwayCode();

    const draft: Record<string, any> = {
      objectid: null,
      status: '',
      railway: railwayCode,
      division,
      department,
      zone_name: railwayName,
      fname: railwayName,
      div_name: division,
    };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      draft.lat = lat;
      draft.lng = lng;
      draft.latitude = lat;
      draft.longitude = lng;
      draft.ycoord = lat;
      draft.xcoord = lng;
    }

    this.formFields.forEach((field) => {
      if (field.key === 'objectid' || field.key === 'status') return;
      if (draft[field.key] !== undefined) return;
      draft[field.key] = field.type === 'number' ? null : '';
    });

    this.mode = 'edit';
    this.ensureLocationOptionsLoaded();
    this.draft = draft;
    this.originalDraft = { ...draft };
    this.prepareLocationDropdownsForDraft(false);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.mapZoom.zoomTo({ type: 'latlng', lat: lat!, lng: lng!, zoom: EditPanel.NEW_ASSET_ZOOM, draggable: false } as any);
    }
    this.cdr.detectChanges();
  }

  editRow(row: any) {
    const isSavedDraftRow = row?.__is_draft === true || String(row?.__is_draft || '').toLowerCase() === 'true';
    const loadDraftDetail = isSavedDraftRow || this.isReviewer() || this.isMakerRejectedView() || this.isMakerSentForDeletionView();

    this.uploadedShapefileRecordObjectId = null;
    this.mode = 'edit';
    this.error = null;
    this.draft = { ...row };
    this.originalDraft = { ...row };
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;

        // ── reset attachment state (File 1 logic) ──
    this.attachmentFiles = [];
    this.uploadingAttachments = false;
    this.attachmentUploadError = null;
    // ───────────────────────────────────────────

    this.ensureLocationOptionsLoaded();
    this.prepareLocationDropdownsForDraft(false);
    this.validating = false;
    this.saving = false;
    this.deleting = false;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();

    const id = Number(row?.objectid); if (!Number.isFinite(id)) return;
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) {
      const normalized = this.normalizeCurrentLayerDraft(row);
      this.draft = { ...normalized };
      this.originalDraft = { ...normalized };
      this.prepareLocationDropdownsForDraft(false);
      this.cdr.detectChanges();
      return;
    }

    const isLandPlanOntrack = this.currentTableLayer === 'landplan_ontrack';
    const bestRenderedLayer = this.getBestRenderedLayer(row);
    const selectedFeatureLatLng = this.getSelectedFeatureLatLng(row);
    const renderedLatLng = selectedFeatureLatLng ?? this.getRenderedLayerLatLng(row);
    const renderedFeature = isLandPlanOntrack ? bestRenderedLayer?.toGeoJSON?.() : null;
    if (!loadDraftDetail && isLandPlanOntrack && renderedFeature && this.shouldAutoZoomOnEditOpen()) {
      this.deferMapZoom({ type: 'feature', feature: renderedFeature, pad: 0.24 } as any);
    } else if (!loadDraftDetail && renderedLatLng && this.shouldAutoZoomOnEditOpen()) {
      this.deferMapZoom({
        type: 'latlng',
        lat: renderedLatLng.lat,
        lng: renderedLatLng.lng,
        zoom: this.getEditFocusZoom(),
        draggable: false,
        existingLayer: bestRenderedLayer,
      } as any);
    }

    const detailRequest$ = loadDraftDetail
      ? this.api.getLayerDraftById(layerKey, id)
      : this.api.getLayerById(layerKey, id);

    detailRequest$.subscribe({
      next: (full) => {
        const n = this.normalizeCurrentLayerDraft(full);
        this.draft = { ...this.draft, ...n };
        this.draft.lat = n.lat; this.draft.lng = n.lng; this.originalDraft = { ...this.draft };
        this.prepareLocationDropdownsForDraft(false);
        const detailLat = Number.isFinite(n.lat) ? n.lat : null;
        const detailLng = Number.isFinite(n.lng) ? n.lng : null;
        const detailFeature = this.buildFeatureFromRow(full);
        if (detailFeature && this.isCurrentLayerNonPoint() && this.shouldAutoZoomOnEditOpen()) {
          this.deferMapZoom({ type: 'feature', feature: detailFeature, pad: 0.24 } as any);
        } else if ((loadDraftDetail || !renderedLatLng || isLandPlanOntrack) && detailLat != null && detailLng != null && this.shouldAutoZoomOnEditOpen()) {
          this.deferMapZoom({ type: 'latlng', lat: detailLat, lng: detailLng, zoom: this.getEditFocusZoom(), draggable: false } as any);
        }
      },
      error: (err) => { console.error('getLayerById failed:', err); this.error = err?.error?.error || 'Failed to load asset details'; },
    });
  }

  zoomToStationFromRow(row: any) {
    const id = Number(row?.objectid);
    const layerKey = this.getPersistenceLayerKey();
    if (this.shouldLoadDraftTable() && Number.isFinite(id) && layerKey) {
      this.api.getLayerDraftById(layerKey, id).subscribe({
        next: (full) => {
          const n = this.normalizeCurrentLayerDraft(full);
          if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return;
          this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: this.getEditFocusZoom(), draggable: false } as any);
        },
        error: (err) => { console.error('zoomToAssetFromRow/getLayerDraftById failed:', err); },
      });
      return;
    }

    const renderedLatLng = this.getRenderedLayerLatLng(row);
    const bestRenderedLayer = this.getBestRenderedLayer(row);

    if (renderedLatLng) {
      this.mapZoom.zoomTo({
        type: 'latlng',
        lat: renderedLatLng.lat,
        lng: renderedLatLng.lng,
        zoom: this.getEditFocusZoom(),
        draggable: false,
        existingLayer: bestRenderedLayer,
      } as any);
      return;
    }

    const lat = Number(row?.lat ?? row?.ycoord ?? row?.latitude);
    const lng = Number(row?.lon ?? row?.lng ?? row?.xcoord ?? row?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: this.getEditFocusZoom(), draggable: false } as any);
      return;
    }
    if (!Number.isFinite(id)) return;
    if (!layerKey) return;
    this.api.getLayerById(layerKey, id).subscribe({ next: (full) => { const n = this.normalizeCurrentLayerDraft(full); if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return; this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: this.getEditFocusZoom(), draggable: false } as any); }, error: (err) => { console.error('zoomToAssetFromRow/getLayerById failed:', err); } });
  }

  private normalizeStation(s: any) {
    const constituency = this.normalizeLocationValue(s?.constituncy) || this.normalizeLocationValue(s?.constituency);
    return {
      objectid: s?.objectid ?? s?.OBJECTID,
      sttncode: s?.sttncode ?? s?.station_code,
      sttnname: s?.sttnname ?? s?.station_name,
      stationtype: s?.sttntype ?? s?.stationtype,
      category: s?.category,
      distkm: s?.distkm,
      distm: s?.distm,
      state: s?.state,
      district: s?.district,
      constituncy: constituency,
      constituency,
      status: s?.status ?? s?.asset_status ?? s?.workflow_status ?? '',
      lat: Number(s?.lat ?? s?.ycoord ?? s?.latitude),
      lng: Number(s?.lon ?? s?.lng ?? s?.xcoord ?? s?.longitude),
    };
  }

  private normalizeLandPlan(row: any) {
    const props = row?.properties ?? row ?? {};
    const feature = this.buildFeatureFromRow(row);
    const geometryCoords = Array.isArray(row?.geometry?.coordinates) ? row.geometry.coordinates : null;
    const directGeometryLng = Number(geometryCoords?.[0]);
    const directGeometryLat = Number(geometryCoords?.[1]);
    const featureCenter = this.getFeatureCenterLatLng(this.buildFeatureFromRow(row));
    const lat = Number.isFinite(directGeometryLat)
      ? directGeometryLat
      : Number(props?.geom_lat ?? props?.lat ?? props?.ycoord ?? props?.latitude ?? featureCenter?.lat);
    const lng = Number.isFinite(directGeometryLng)
      ? directGeometryLng
      : Number(props?.geom_lng ?? props?.lon ?? props?.lng ?? props?.xcoord ?? props?.longitude ?? featureCenter?.lng);
    const constituency = this.normalizeLocationValue(this.getValueByNormalizedKey(props, [
      'constituncy',
      'constituency',
      'constituen',
      'constituency_name',
      'parliamentary_constituency',
    ]));
    return {
      objectid: props?.objectid ?? row?.id ?? null,
      distfromkm: props?.distfromkm ?? null,
      distfromm: props?.distfromm ?? null,
      disttokm: props?.disttokm ?? null,
      disttom: props?.disttom ?? null,
      imageno: props?.imageno ?? '',
      railway: props?.railway ?? '',
      division: props?.division ?? this.currentUser.getSnapshot()?.division ?? '',
      state: props?.state ?? '',
      district: props?.district ?? '',
      constituncy: constituency,
      constituency,
      status: props?.status ?? '',
      asset_geometry_geojson: feature?.geometry ?? props?.asset_geometry_geojson ?? null,
      lat,
      lng,
    };
  }

  private normalizeCurrentLayerDraft(row: any) {
    if (this.currentTableLayer === 'stations') return this.normalizeStation(row);
    if (this.currentTableLayer === 'landplan_ontrack') return this.normalizeLandPlan(row);
    const props = row?.properties ?? row ?? {};
    const geometryCoords = Array.isArray(row?.geometry?.coordinates) ? row.geometry.coordinates : null;
    const directGeometryLng = Number(geometryCoords?.[0]);
    const directGeometryLat = Number(geometryCoords?.[1]);
    const featureCenter = this.getFeatureCenterLatLng(this.buildFeatureFromRow(row));
    const normalized: any = {};
    Object.keys(props).forEach((key) => {
      normalized[key] = props[key];
    });
    const constituency = this.normalizeLocationValue(this.getValueByNormalizedKey(normalized, [
      'constituncy',
      'constituency',
      'constituen',
      'constituency_name',
      'parliamentary_constituency',
      'pc_name',
      'pc',
    ]));
    if (constituency) {
      normalized.constituncy = constituency;
      normalized.constituency = constituency;
    }
    normalized.asset_id = normalized.asset_id ?? normalized.assetid ?? '';
    normalized.robno = normalized.robno ?? normalized.bridgeno ?? normalized.rorno ?? '';
    normalized.rubno = normalized.rubno ?? normalized.bridgeno ?? normalized.rorno ?? '';
    normalized.rorno = normalized.rorno ?? normalized.bridgeno ?? '';
    normalized.objectid = props?.objectid ?? row?.id ?? row?.objectid ?? null;
    normalized.status = props?.status ?? row?.status ?? '';
    normalized.lat = Number.isFinite(directGeometryLat)
      ? directGeometryLat
      : Number(props?.geom_lat ?? props?.lat ?? props?.ycoord ?? props?.latitude ?? featureCenter?.lat);
    normalized.lng = Number.isFinite(directGeometryLng)
      ? directGeometryLng
      : Number(props?.geom_lng ?? props?.lon ?? props?.lng ?? props?.xcoord ?? props?.longitude ?? featureCenter?.lng);
    return normalized;
  }

  private rowMatchesFeature(row: any, feature: any): boolean {
    const props = feature?.properties ?? {};
    const toKey = (value: any) => String(value ?? '').trim().toLowerCase();
    const rowKeys = [
      row?.objectid,
      row?.edit_id,
      row?.gid,
      row?.asset_id,
      row?.assetid,
      row?.bridgeno,
      row?.distkm != null && row?.distm != null ? `${row.distkm}:${row.distm}` : '',
    ].map(toKey).filter(Boolean);
    const featureKeys = [
      feature?.id,
      props?.objectid,
      props?.OBJECTID,
      props?.gid,
      props?.asset_id,
      props?.assetid,
      props?.bridgeno,
      props?.distkm != null && props?.distm != null ? `${props.distkm}:${props.distm}` : '',
    ].map(toKey).filter(Boolean);
    return rowKeys.some((key) => featureKeys.includes(key));
  }

  private getSelectedFeatureLatLng(row?: any): { lat: number; lng: number } | null {
    const feature = this.edit.selectedFeature;
    if (!feature) return null;
    if (row && !this.rowMatchesFeature(row, feature)) return null;
    const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null;
    const lng = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  private getRenderedLayerLatLng(row: any): { lat: number; lng: number } | null {
    const layerId = String(this.currentTableLayer || '').trim();
    if (!layerId) return null;
    const layer = this.findMapLayerForCurrentEditLayer();
    const bestLatLng = layer?.getBestRenderedLatLng?.(row);
    if (bestLatLng) {
      const bestLat = Number(bestLatLng.lat);
      const bestLng = Number(bestLatLng.lng);
      if (Number.isFinite(bestLat) && Number.isFinite(bestLng)) {
        return { lat: bestLat, lng: bestLng };
      }
    }
    const latLng = layer?.getRenderedLatLngForKey?.(
      row?.objectid,
      row?.edit_id,
      row?.gid,
      row?.asset_id,
      row?.assetid,
    );
    if (!latLng) return null;
    const lat = Number(latLng.lat);
    const lng = Number(latLng.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  private getBestRenderedLayer(row: any): any | null {
    const layerId = String(this.currentTableLayer || '').trim();
    if (!layerId) return null;
    const layer = this.findMapLayerForCurrentEditLayer();
    return layer?.getBestRenderedLayer?.(row) || null;
  }

  private findMapLayerForCurrentEditLayer(): any | null {
    const layerId = String(this.currentTableLayer || '').trim();
    if (!layerId) return null;
    return (
      (this.layerManager.findById(layerId) as any) ||
      (this.layerManager.findById(`department_${layerId}`) as any) ||
      null
    );
  }

  startGeometryEdit() {
    if (this.isReviewer()) return;
    if (!this.draft) return;
    const lat = Number(this.draft.lat); const lng = Number(this.draft.lng);
    this.notifyAlert('Edit Geometry Mode is ON. You can now move the asset point.');
    this.geomEditing = true;
    this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: this.getEditFocusZoom(), draggable: true });
    this.dragSub?.unsubscribe();
    this.dragSub = this.edit.dragEnd$.subscribe(({ lat: newLat, lng: newLng }) => { if (!this.draft) return; this.draft.lat = newLat; this.draft.lng = newLng; this.cdr.detectChanges(); });
  }

  saveGeometry() {
    if (this.isReviewer()) return;
    if (!this.geomEditing) return;
    this.notifyAlert('Geometry is fixed and Edit Geometry Mode is OFF.');
    this.geomEditing = false;
    this.edit.lockDrag();
    const lat = Number(this.draft?.lat); const lng = Number(this.draft?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: this.getEditFocusZoom(), draggable: false } as any);
    }
    this.cdr.detectChanges();
  }

  isMandatoryStationField(field: string): boolean {
    return this.formFields.some((x) => x.key === field && x.required);
  }

  private isBlankValue(value: unknown): boolean {
    return value == null || String(value).trim() === '';
  }

  private hasMissingMandatoryFields(): boolean {
    if (!this.draft) return true;
    return this.formFields
      .filter((field) => field.required)
      .some((field) => this.isBlankValue(this.draft?.[field.key]));
  }

  private getRailwayName(): string {
    return String(
      localStorage.getItem('railway') || this.currentUser.getSnapshot()?.railway || ''
    ).trim();
  }

  private getRailwayCode(): string {
    const storedCode = String(
      localStorage.getItem('railway_code') || localStorage.getItem('zone_code') || ''
    ).trim();
    if (storedCode) return storedCode;
    const railwayName = this.getRailwayName();
    return this.railwayCodeByName.get(railwayName.toLowerCase()) || railwayName;
  }

  private requiresStationValidationBeforeSend(): boolean {
    return this.currentTableLayer === 'stations' && this.isMaker() && !this.stationValidated;
  }

  supportsCurrentLayerPersistence(): boolean {
    return !!this.currentLayerSchema;
  }

  supportsCurrentLayerListing(): boolean {
    return this.supportsCurrentLayerPersistence();
  }

  isFieldReadonly(field: EditFieldConfig): boolean {
    if (field.key === 'comments' && this.isMaker() && String(this.originalDraft?.status || '').trim().toLowerCase() === 'sent back to maker') {
      return false;
    }
    if (this.currentTableLayer === 'stations') {
      if (field.key === 'comments') return true;
      if (field.key === 'status') return true;
      if (field.key === 'sttncode' || field.key === 'category' || field.key === 'sttnname') {
        return this.isStationFieldsLocked();
      }
      return this.isReviewer() || this.isMakerSentForDeletionView();
    }
    if (this.isBridgeLayer()) {
      const readonlyKeys = new Set([
        'objectid',
        'status',
        'edited_by',
        'edited_at',
        'checked_by',
        'checked_at',
        'approved_by',
        'approved_at',
        'modified_by',
        'railway',
        'division',
      ]);
      if (readonlyKeys.has(field.key)) return true;
      return this.isReviewer() || this.isMakerSentForDeletionView();
    }
    const genericReadonlyKeys = new Set([
      'objectid',
      'status',
      'edited_by',
      'edited_at',
      'checked_by',
      'checked_at',
      'approved_by',
      'approved_at',
      'modified_by',
    ]);
    if (genericReadonlyKeys.has(field.key)) return true;
    return this.isReviewer() || this.isMakerSentForDeletionView();
  }

  isFieldDisabled(field: EditFieldConfig): boolean {
    if (!this.isBridgeLayer()) return false;
    if (this.isReviewer() || this.isMakerSentForDeletionView()) return false;

    const lockedAfterValidation = new Set([
      'tmssection',
      'bridgeno',
      'bridgetype',
      'bridge_type',
      'spanconf',
    ]);
    if (!lockedAfterValidation.has(field.key)) return false;

    const assetId = this.getNormalizedBridgeAssetId();
    return !!assetId && assetId === this.validatedBridgeAssetId;
  }

  showValidateButton(field: EditFieldConfig): boolean {
    return Boolean(
      field.validateButton &&
      (
        this.currentTableLayer === 'stations' ||
        (this.isBridgeLayer() && field.key === 'asset_id')
      ) &&
      !this.isReviewer() &&
      !this.isMakerSentForDeletionView()
    );
  }

  onValidateField(field: EditFieldConfig): void {
    if (field.key === 'sttncode') {
      this.validateStationCode();
      return;
    }

    if (field.key === 'asset_id' && this.isBridgeLayer()) {
      this.validateBridgeAssetId();
    }
  }

// ── Attachment logic (from File 1) ──────────────────────────

  showImageNoDeleteButton(field: EditFieldConfig): boolean {
    return this.currentTableLayer === 'landplan_ontrack' && field.key === 'imageno';
  }

  deleteImageNo(): void {
    if (!this.draft || this.isReviewer() || this.isMakerSentForDeletionView()) return;
    this.draft.imageno = '';
    this.cdr.detectChanges();
  }

  onAttachmentFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.attachmentFiles = input?.files ? Array.from(input.files) : [];
    this.attachmentUploadError = null;
    this.cdr.detectChanges();
  }

  removeSelectedFile(index: number): void {
    if (index >= 0 && index < this.attachmentFiles.length) {
      this.attachmentFiles.splice(index, 1);
      this.cdr.detectChanges();
    }
  }

  clearSelectedFiles(): void {
    this.attachmentFiles = [];
    if (this.attachmentInput?.nativeElement) {
      this.attachmentInput.nativeElement.value = '';
    }
    this.cdr.detectChanges();
  }

  uploadAttachmentFiles(): void {
    if (!this.draft?.objectid || !Number.isFinite(Number(this.draft.objectid))) {
      this.error = 'Please save the record before uploading attachments.';
      this.cdr.detectChanges();
      return;
    }

    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) { this.error = 'Layer workflow is not available.'; this.cdr.detectChanges(); return; }
    if (this.attachmentFiles.length === 0) return;

    this.uploadingAttachments = true;
    this.error = null;

    this.api.uploadLayerAttachments(layerKey, Number(this.draft.objectid), this.attachmentFiles).subscribe({
      next: (result: any) => {
        this.uploadingAttachments = false;
        this.attachmentFiles = [];
        if (this.attachmentInput?.nativeElement) {
          this.attachmentInput.nativeElement.value = '';
        }
        this.draft = {
          ...this.draft,
          attachment_bundle_url: result?.bundleUrl || result?.bundle_url || this.draft?.attachment_bundle_url,
        };
        this.error = null;
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.uploadingAttachments = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to upload attachments';
        this.cdr.detectChanges();
      },
    });
  }

  private uploadAttachmentsAfterSave(layerKey: string, recordId: number): void {
    this.uploadingAttachments = true;
    this.attachmentUploadError = null;

    this.api.uploadLayerAttachments(layerKey, recordId, this.attachmentFiles).subscribe({
      next: (result: any) => {
        this.uploadingAttachments = false;
        this.attachmentFiles = [];
        if (this.attachmentInput?.nativeElement) {
          this.attachmentInput.nativeElement.value = '';
        }
        this.draft = {
          ...this.draft,
          attachment_bundle_url: result?.bundleUrl || result?.bundle_url || this.draft?.attachment_bundle_url,
        };
        this.finishSave();
      },
      error: (err: any) => {
        this.uploadingAttachments = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to upload attachments';
        this.cdr.detectChanges();
      },
    });
  }
  // ────────────────────────────────────────────────────────────


  private finishSave(): void {
    this.saving = false;
    this.uploadingAttachments = false;
    this.attachmentUploadError = null;
    this.attachmentFiles = [];
    if (this.attachmentInput?.nativeElement) {
      this.attachmentInput.nativeElement.value = '';
    }
    this.edit.cancelCreateStation();
    this.mode = 'table';
    this.draft = null;
    this.originalDraft = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;
    this.showAddRecordModal = false;
    this.addRecordDrawingActive = false;
    this.addRecordShapefileName = '';
    this.uploadedShapefileRecordObjectId = null;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.zoomHome();
    this.mapZoom.clearHighlight();
    setTimeout(() => this.load(false), 0);
    this.cdr.detectChanges();
  }

  cancelEdit() {
    if (this.originalDraft) this.draft = { ...this.originalDraft };
    this.edit.cancelCreateStation(); this.addRecordDrawingActive = false; this.uploadedShapefileRecordObjectId = null; this.mode = 'table'; this.draft = null; this.originalDraft = null; this.error = null; this.validating = false; this.stationValidated = false; this.validatedBridgeAssetId = null; this.showAddRecordModal = false; this.addRecordShapefileName = ''; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.zoomHome(); this.mapZoom.clearHighlight();
  }

  private isSavedMakerDraft(): boolean {
    const row = this.originalDraft || this.draft;
    return row?.__is_draft === true || String(row?.__is_draft || '').toLowerCase() === 'true';
  }

  private returnToTableAfterDraftSave(): void {
    this.edit.cancelCreateStation();
    this.mode = 'table';
    this.draft = null;
    this.originalDraft = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;
    this.uploadedShapefileRecordObjectId = null;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.zoomHome();
    this.mapZoom.clearHighlight();
    setTimeout(() => this.load(true), 0);
  }

  private buildCurrentDraftPayload(): any {
    const lat = Number(this.draft?.lat);
    const lng = Number(this.draft?.lng);
    const payload: any = {
      ...this.draft,
      railway: this.draft?.railway ?? this.getRailwayCode(),
      zone_name: this.draft?.zone_name ?? this.getRailwayName(),
      fname: this.draft?.fname ?? this.getRailwayName(),
      div_name: this.draft?.div_name ?? (localStorage.getItem('division') || this.currentUser.getSnapshot()?.division || ''),
      department: this.draft?.department ?? (localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || ''),
    };
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      payload.lat = lat;
      payload.lng = lng;
      payload.lon = lng;
      payload.longitude = lng;
      payload.latitude = lat;
      payload.xcoord = lng;
      payload.ycoord = lat;
    }
    return payload;
  }

  saveDraftOnly(): void {
    if (!this.isMaker() || !this.draft || !this.supportsCurrentLayerPersistence()) return;
    const layerKey = this.getPersistenceLayerKey();
    const id = Number(this.draft.objectid);
    if (!layerKey || !Number.isFinite(id)) return;

    this.saving = true;
    this.error = null;
    const payload = this.buildCurrentDraftPayload();
    const request$ = this.isSavedMakerDraft()
      ? this.api.updateSavedLayerDraft(layerKey, id, payload)
      : this.api.saveLayerDraft(layerKey, id, payload);

    request$.subscribe({
      next: (res: any) => {
        this.saving = false;
        const draft = res?.draft || this.draft;
        this.draft = { ...this.draft, ...draft, __is_draft: true };
        this.originalDraft = { ...this.draft };
        this.notifyAlert('Asset saved');
        this.returnToTableAfterDraftSave();
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.saving = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to save asset';
        this.cdr.detectChanges();
      },
    });
  }

  send() {
    if (this.isReviewer()) return;
    if (!this.supportsCurrentLayerPersistence()) {
      this.notifyAlert(`${this.currentLayerSchema?.label || 'This layer'} form is configured, but save workflow is not wired yet.`);
      return;
    }
    if (this.requiresStationValidationBeforeSend()) {
      this.notifyAlert('Please validate the station before sending the record to checker');
      return;
    }
    if (this.requiresBridgeAssetValidationBeforeSend()) {
      this.notifyAlert('Please validate the Asset ID before sending the record to checker');
      return;
    }
    if (this.hasMissingMandatoryFields()) {
      this.notifyAlert('Not all mandatory fields are filled');
      return;
    }
    const draftObjectId = this.draft?.objectid;
    const hasExistingId = draftObjectId !== null && draftObjectId !== undefined && String(draftObjectId).trim() !== '' && Number.isFinite(Number(draftObjectId));
    const isCreate = !hasExistingId;
    const lat = Number(this.draft.lat); const lng = Number(this.draft.lng);
    if (this.requiresGeometryForSave() && (!Number.isFinite(lat) || !Number.isFinite(lng))) { this.error = 'New geometry not captured. Please drag the point and click Save Geometry.'; this.cdr.detectChanges(); return; }
    const payload = this.buildCurrentDraftPayload();
    this.saving = true;
    const rawStatus = this.originalDraft?.status == null ? '' : String(this.originalDraft.status).trim().toLowerCase();
    const isMakerRejectedResend = !isCreate && this.isMaker() && rawStatus === 'sent back to maker';
    const isMakerSend = !isCreate && this.isMaker() && !rawStatus;
    if (isCreate) {
      this.notifyAlert(`${this.currentLayerSchema?.label || 'Asset'} creation sent successfully to checker`);
    } else if (isMakerRejectedResend || isMakerSend) {
      this.notifyAlert('Message sent successfully to checker');
    }
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) {
      this.saving = false;
      this.error = 'Layer workflow is not available';
      this.cdr.detectChanges();
      return;
    }

    const request$ = this.isSavedMakerDraft()
      ? this.api.submitSavedLayerDraft(layerKey, this.draft.objectid, payload)
      : isCreate
      ? this.api.sendNewLayerEdit(layerKey, payload)
      : isMakerRejectedResend
        ? this.api.resendLayerDraft(layerKey, this.draft.objectid, payload)
        : isMakerSend
          ? this.api.sendLayerEdit(layerKey, this.draft.objectid, payload)
          : this.api.updateLayer(layerKey, this.draft.objectid, payload);
    request$.subscribe({
      next: (response: any) => {
                // ── File 1 logic: upload attachments after save if any pending ──
        const savedId = Number(
          response?.objectid ??
          response?.id ??
          response?.row?.objectid ??
          response?.row?.id ??
          this.draft?.objectid
        );
        if (this.attachmentFiles.length > 0 && Number.isFinite(savedId)) {
          this.uploadAttachmentsAfterSave(layerKey, savedId);
          return;
        }
        // ────────────────────────────────────────────────────────────────
        this.finishSave();
      },
      error: (err: any) => {
        this.saving = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to save changes';
        this.cdr.detectChanges();
      }
    });
  }

  validateStationCode() {
    if (this.isReviewer()) return;
    if (!this.draft?.sttncode) return;
    this.validating = true;
    this.api.validateStationCode(this.draft.sttncode).subscribe({
      next: (res: any) => {
        if (!this.draft) {
          this.validating = false;
          this.cdr.detectChanges();
          return;
        }
        const row = res?.row || {};
        const validatedName = row?.station_name || this.draft.sttnname;
        const validatedCategory = row?.category || this.draft.category;
        const nameChanged = String(this.draft.sttnname || '') !== String(validatedName || '');
        const categoryChanged = String(this.draft.category || '') !== String(validatedCategory || '');
        this.draft.sttnname = validatedName;
        this.draft.category = validatedCategory;
        if (this.draft?.objectid && (nameChanged || categoryChanged) && !(this.isMaker() && String(this.originalDraft?.status || '').trim().toLowerCase() === 'sent back to maker')) {
          const payload = { distkm: this.draft.distkm, distm: this.draft.distm, state: this.draft.state, district: this.draft.district, constituncy: this.draft.constituncy, sttnname: this.draft.sttnname, category: this.draft.category, sttntype: this.draft.stationtype };
          this.api.updateStation(this.draft.objectid, payload).subscribe({ next: () => { this.validating = false; this.stationValidated = true; this.notifyAlert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges(); }, error: (err: any) => { this.validating = false; this.notifyAlert(err?.error?.message || 'Station code validated but failed to update station details'); this.cdr.detectChanges(); } });
          return;
        }
        this.validating = false; this.stationValidated = true; this.notifyAlert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges();
      },
      error: (err: any) => { this.validating = false; this.stationValidated = false; this.notifyAlert(err?.error?.message || 'Station code validation failed'); this.cdr.detectChanges(); },
    });
  }

  validateBridgeAssetId() {
    if (this.isReviewer()) return;
    if (!this.isBridgeLayer()) return;

    const layerKey = this.getPersistenceLayerKey();
    const assetId = this.getNormalizedBridgeAssetId();
    const objectId = Number(this.draft?.objectid);

    if (!layerKey) return;
    if (!assetId) {
      this.notifyAlert('Please enter Asset ID');
      return;
    }
    if (this.isRejectedBridgeAssetIdUnchanged()) {
      this.validatedBridgeAssetId = assetId;
      this.notifyAlert('Asset ID is unchanged for this rejected record, so validation is not required.');
      return;
    }

    this.validating = true;
    const validationObjectId = this.isMaker() && String(this.originalDraft?.status || '').trim().toLowerCase() === 'sent back to maker'
      ? Number(this.draft?.edit_id ?? this.originalDraft?.edit_id ?? objectId)
      : objectId;
    this.api.validateAssetId(layerKey, assetId, Number.isFinite(validationObjectId) ? validationObjectId : null).subscribe({
      next: (res: any) => {
        this.validating = false;
        this.applyValidatedBridgeAsset(res?.row || {});
        this.validatedBridgeAssetId = this.getNormalizedBridgeAssetId();
        this.notifyAlert(res?.message || 'Asset ID is validated. Please fill the rest of the details.');
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.validating = false;
        this.validatedBridgeAssetId = null;
        this.notifyAlert(err?.error?.message || err?.error?.error || 'Asset ID not validated. Please enter a valid Asset ID.');
        this.cdr.detectChanges();
      },
    });
  }

  private completeDeleteRequestSuccess() {
    this.deleting = false;
    if (this.draft) {
      this.mode = 'table';
      this.draft = null;
      this.originalDraft = null;
      this.stationValidated = false;
      this.validatedBridgeAssetId = null;
      this.showAddRecordModal = false;
      this.addRecordShapefileName = '';
      this.error = null;
      this.geomEditing = false;
      this.dragSub?.unsubscribe();
      this.dragSub = undefined;
      this.mapZoom.zoomHome();
      this.mapZoom.clearHighlight();
    }
    setTimeout(() => this.load(false), 0);
    this.cdr.detectChanges();
  }

  isUploadedShapefileRecordForm(): boolean {
    const currentObjectId = Number(this.draft?.objectid);
    return this.mode === 'edit'
      && Number.isFinite(currentObjectId)
      && this.uploadedShapefileRecordObjectId === currentObjectId;
  }

  deleteUploadedShapefileRecord(): void {
    if (!this.isUploadedShapefileRecordForm()) return;
    const id = Number(this.draft?.objectid);
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey || !Number.isFinite(id)) return;

    const name = this.getRecordDisplayName(this.draft);
    if (!confirm(`Delete uploaded ${this.getCurrentLayerLabel()}${name ? ` "${name}"` : ''} directly from database?`)) return;

    this.deleting = true;
    this.error = null;
    this.api.deleteLayer(layerKey, id).subscribe({
      next: () => {
        this.deleting = false;
        this.uploadedShapefileRecordObjectId = null;
        this.mode = 'table';
        this.draft = null;
        this.originalDraft = null;
        this.stationValidated = false;
        this.validatedBridgeAssetId = null;
        this.geomEditing = false;
        this.dragSub?.unsubscribe();
        this.dragSub = undefined;
        this.mapZoom.zoomHome();
        this.mapZoom.clearHighlight();
        this.notifyAlert('Uploaded asset deleted from database');
        setTimeout(() => this.load(true), 0);
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.deleting = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to delete uploaded asset';
        this.cdr.detectChanges();
      },
    });
  }

  private handleDeleteRequestError(err: any) {
    this.deleting = false;
    this.error = err?.error?.message || err?.error?.error || 'Failed to send deletion request';
    this.cdr.detectChanges();
  }

  private requestDeletionFromMain(row: any) {
    const id = Number(row?.objectid);
    if (!Number.isFinite(id)) return;
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) return;
    this.deleting = true;
    this.error = null;
    this.api.requestLayerDeletion(layerKey, id).subscribe({
      next: () => {
        this.notifyAlert('Asset Sent to Checker for Deletion');
        this.completeDeleteRequestSuccess();
      },
      error: (err: any) => this.handleDeleteRequestError(err),
    });
  }

  private requestDeletionFromDraft(row: any) {
    const id = Number(row?.objectid);
    if (!Number.isFinite(id)) return;
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) return;
    this.deleting = true;
    this.error = null;
    this.api.requestLayerDraftDeletion(layerKey, id).subscribe({
      next: () => {
        this.notifyAlert('Asset Sent to Checker for Deletion');
        this.completeDeleteRequestSuccess();
      },
      error: (err: any) => this.handleDeleteRequestError(err),
    });
  }

  deleteRow(row: any) {
    const name = this.getRecordDisplayName(row);
    if (!confirm(`Delete ${this.getCurrentLayerLabel()}${name ? ` "${name}"` : ''}?`)) return;
    this.requestDeletionFromMain(row);
  }

  deleteDraft() {
    if (!this.draft?.objectid) return;
    if (this.isUploadedShapefileRecordForm()) {
      this.deleteUploadedShapefileRecord();
      return;
    }
    const name = this.getRecordDisplayName(this.draft);
    if (!confirm(`Delete ${this.getCurrentLayerLabel()}${name ? ` "${name}"` : ''}?`)) return;
    const isRejectedDraft = this.isMaker() && this.makerTab === 'rejected';
    if (isRejectedDraft) {
      this.requestDeletionFromDraft(this.draft);
      return;
    }
    this.requestDeletionFromMain(this.draft);
  }

  previewRejectedRow(row: any) { this.editRow(row); }
  sendForwardRejected(row: any) {
    const id = Number(row?.objectid);
    if (!Number.isFinite(id)) return;
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) return;

    const payload = {
      ...this.normalizeCurrentLayerDraft(row),
      railway: row?.railway ?? this.getRailwayCode(),
      zone_name: row?.zone_name ?? this.getRailwayName(),
      fname: row?.fname ?? row?.zone_name ?? this.getRailwayName(),
      div_name: row?.div_name ?? (localStorage.getItem('division') || this.currentUser.getSnapshot()?.division || ''),
      department: row?.department ?? (localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || ''),
    };

    this.saving = true;
    this.error = null;
    this.api.resendLayerDraft(layerKey, id, payload).subscribe({
      next: () => {
        this.saving = false;
        this.notifyAlert('Message sent successfully to checker');
        setTimeout(() => this.load(false), 0);
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.saving = false;
        this.error = err?.error?.message || err?.error?.error || 'Failed to send record to checker';
        this.cdr.detectChanges();
      },
    });
  }
  deleteRejectedRow(row: any) {
    const name = this.getRecordDisplayName(row);
    if (!confirm(`Delete ${this.getCurrentLayerLabel()}${name ? ` "${name}"` : ''}?`)) return;
    this.requestDeletionFromDraft(row);
  }
  acceptDeletionRow(row: any) {
    const status = this.isApprover() ? WORKFLOW_STATUS.deleted : WORKFLOW_STATUS.approverDeletion;
    this.updateReviewerDraftStatus(row, status);
  }
  rejectDeletionRow(row: any) { this.updateReviewerDraftStatus(row, WORKFLOW_STATUS.makerRejected); }
  acceptDeletionDraft() { if (!this.draft) return; this.acceptDeletionRow(this.draft); }
  rejectDeletionDraft() { if (!this.draft) return; this.rejectDeletionRow(this.draft); }

  private resetPanelState() {
    this.mode = 'table'; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.page = 1; this.pageSize = 8; this.search = ''; this.loading = false; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.validatedBridgeAssetId = null; this.showAddRecordModal = false; this.addRecordDrawingActive = false; this.addRecordShapefileName = ''; this.uploadedShapefileRecordObjectId = null; this.saving = false; this.deleting = false; this.validating = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.error = null; this.edit.setLayer(null as any); this.mapZoom.clearHighlight();
  }

  close() {
    this.mapZoom.zoomHome(); this.mapZoom.clearHighlight(); this.ui.activePanel = null; this.resetPanelState(); this.edit.disable();
  }

  private requiresGeometryForSave(): boolean {
    if (this.currentTableLayer === 'stations' || this.isBridgeLayer()) return true;
    return this.formFields.some((field) => ['latitude', 'longitude', 'xcoord', 'ycoord'].includes(field.key));
  }
}










