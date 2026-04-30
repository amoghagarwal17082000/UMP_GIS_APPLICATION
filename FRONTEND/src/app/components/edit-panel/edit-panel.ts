import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditState } from '../../services/edit-state';
import { Api } from 'src/app/api/api';
import { UiState } from '../../services/ui-state';
import { MapZoomService } from 'src/app/services/map-zoom';
import { CurrentUserService } from 'src/app/services/current-user';
import { LayerManager } from 'src/app/services/layer-manager';
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
const RAILWAY_CODE_MAP: Record<string, string> = {
  'Central Railway': 'CR',
  'Eastern Railway': 'ER',
  'East Central Railway': 'ECR',
  'East Coast Railway': 'ECoR',
  'Northern Railway': 'NR',
  'North Central Railway': 'NCR',
  'North Eastern Railway': 'NER',
  'Northeast Frontier Railway': 'NFR',
  'North Western Railway': 'NWR',
  'Southern Railway': 'SR',
  'South Central Railway': 'SCR',
  'South Eastern Railway': 'SER',
  'South East Central Railway': 'SECR',
  'South Western Railway': 'SWR',
  'Western Railway': 'WR',
  'West Central Railway': 'WCR',
  'Metro Railway': 'MTP',
  'Konkan Railway': 'KR',
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

  geomEditing = false;
  selectedAttachmentFile: File | null = null;
  selectedAttachmentName = '';
  selectedAttachmentKind: 'other' | null = null;
  showAddRecordModal = false;
  addRecordShapefileName = '';
  private dragSub?: Subscription;
  private stateSub?: Subscription;
  private createPointSub?: Subscription;
  private loadSeq = 0;
  stateOptions: LocationOption[] = [];
  districtOptions: LocationOption[] = [];
  constituencyOptions: LocationOption[] = [];
  private allDistrictOptions: Array<LocationOption & { state?: string }> = [];
  private allConstituencyOptions: Array<LocationOption & { state?: string }> = [];

  constructor(
    public ui: UiState,
    public edit: EditState,
    private api: Api,
    private cdr: ChangeDetectorRef,
    private mapZoom: MapZoomService,
    private currentUser: CurrentUserService,
    private layerManager: LayerManager
  ) {}

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

  get currentLayerSchema() {
    const layer = this.currentTableLayer;
    return getEditLayerConfig(layer);
  }

  isBridgeLayer(): boolean {
    return ['bridge_start', 'bridge_end', 'bridge_minor'].includes(String(this.currentTableLayer || '').trim().toLowerCase());
  }

  getEditTitle(): string {
    return this.currentLayerSchema?.formTitle || 'Asset Details';
  }

  private getCurrentLayerLabel(): string {
    return this.currentLayerSchema?.label || 'Asset';
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
    const selected = String(this.edit.editLayer || '').trim();
    if (!selected) return false;
    const option = this.layerOptions.find((item) => item.value === selected);
    return !!option && !option.supported;
  }

  get selectedLayerLabel(): string {
    const selected = String(this.edit.editLayer || '').trim();
    if (!selected) return '';
    return this.layerOptions.find((item) => item.value === selected)?.label || selected;
  }

  getCellValue(row: any, key: string): any {
    if (!row) return null;
    if (key === 'sttntype') return row?.sttntype ?? row?.stationtype;
    if (key === 'bridgeno') return row?.bridgeno ?? row?.rorno;
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
    const selectedOption = this.layerOptions.find((option) => option.value === this.edit.editLayer);
    if (selectedOption?.supported) {
      this.edit.setLayer(this.edit.editLayer);
    } else {
      this.edit.resetSelection();
    }

    this.mode = 'table';
    this.rows = [];
    this.allRows = [];
    this.filteredRows = [];
    this.total = 0;
    this.filteredTotal = 0;
    this.page = 1;
    this.search = '';
    this.error = null;
    this.draft = null;
    this.originalDraft = null;
    this.stationValidated = false;
    this.validatedBridgeAssetId = null;
    this.selectedAttachmentFile = null;
    this.selectedAttachmentName = '';
    this.selectedAttachmentKind = null;

    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();

    if (selectedOption?.supported && this.supportsCurrentLayerListing()) {
      setTimeout(() => this.load(true), 0);
    } else {
      this.syncSelectedFeatureDraft();
    }
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
    this.addRecordShapefileName = '';
    this.selectedAttachmentFile = null;
    this.selectedAttachmentName = this.getExistingAttachmentName(this.edit.draft);
    this.selectedAttachmentKind = this.selectedAttachmentName ? 'other' : null;
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
    if (this.stateOptions.length && this.districtOptions.length && this.constituencyOptions.length) return;
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
    return EditPanel.NON_POINT_LAYERS.has(layer)
      ? EditPanel.DEFAULT_LAYER_ZOOM
      : EditPanel.POINT_LAYER_ZOOM;
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
    this.selectedAttachmentFile = null; this.selectedAttachmentName = ''; this.selectedAttachmentKind = null;
    this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.clearHighlight();
    this.edit.setLayer((this.rejectedLayer as any) ?? null);
    if (this.rejectedLayer) setTimeout(() => this.load(true), 0);
  }

  private updateReviewerDraftStatus(row: any, status: 'Sent to Approver' | 'Sent Back to Maker' | 'Sent to Database' | 'Sent to Approver for Deletion' | 'Asset Deleted') {
    if (!this.isReviewer()) return;
    if (!this.supportsCurrentLayerPersistence()) {
      alert(`${this.currentLayerSchema?.label || 'This layer'} workflow is not wired yet.`);
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
        alert(alertText);

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

  private fetchCurrentLayerPage(layerKey: string, page: number, search: string) {
    const status = this.getDraftStatusForCurrentView();
    const isDraft = this.shouldLoadDraftTable();

    if (layerKey === 'bridge_start') {
      return isDraft
        ? this.api.getBridgeStartDraftTable(page, this.fetchPageSize, search, status)
        : this.api.getBridgeStartTable(page, this.fetchPageSize, search);
    }

    if (layerKey === 'bridge_end') {
      return isDraft
        ? this.api.getBridgeEndDraftTable(page, this.fetchPageSize, search, status)
        : this.api.getBridgeEndTable(page, this.fetchPageSize, search);
    }

    if (layerKey === 'bridge_minor') {
      return isDraft
        ? this.api.getBridgeMinorDraftTable(page, this.fetchPageSize, search, status)
        : this.api.getBridgeMinorTable(page, this.fetchPageSize, search);
    }

    return isDraft
      ? this.api.getLayerDraftTable(layerKey, page, this.fetchPageSize, search, status)
      : this.api.getLayerTable(layerKey, page, this.fetchPageSize, search);
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

    const fetchOne = (p: number) => {
      if (seq !== this.loadSeq) return;

      this.fetchCurrentLayerPage(layerKey, p, this.search).subscribe({
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
          this.allRows = []; this.filteredRows = []; this.rows = []; this.total = 0; this.filteredTotal = 0; this.loading = false; this.cdr.detectChanges();
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
  nextPage() { if (this.page >= this.totalPages) return; this.page++; this.applyPagination(); this.cdr.detectChanges(); }
  prevPage() { if (this.page <= 1) return; this.page--; this.applyPagination(); this.cdr.detectChanges(); }

  startAddRecord() {
    if (!this.currentTableLayer) return;
    this.showAddRecordModal = true;
    this.addRecordShapefileName = '';
    this.cdr.detectChanges();
  }

  closeAddRecordModal(): void {
    this.showAddRecordModal = false;
  }

  cancelAddNewRecordDrawing(): void {
    this.edit.cancelCreateStation();
    this.mapZoom.clearHighlight();
    this.error = null;
    this.cdr.detectChanges();
  }

  startAddRecordWithDrawingTool(): void {
    if (!this.currentTableLayer) return;
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
    this.selectedAttachmentFile = null;
    this.selectedAttachmentName = '';
    this.selectedAttachmentKind = null;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();

    this.edit.startCreateStation();

    this.cdr.detectChanges();
  }

  onAddRecordShapefileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;
    this.addRecordShapefileName = file?.name || '';
    if (!file) return;
    this.showAddRecordModal = false;
    alert(`Selected shapefile: ${file.name}. Shapefile-based record creation UI is ready, but backend upload handling is not wired yet.`);
    this.cdr.detectChanges();
  }

  private beginStationCreationDraft(lat: number, lng: number) {
    const railway = this.getRailwayName();
    const department = localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '';

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
    const loadDraftDetail = this.isReviewer() || this.isMakerRejectedView() || this.isMakerSentForDeletionView();

    this.mode = 'edit'; this.error = null; this.draft = { ...row }; this.originalDraft = { ...row }; this.stationValidated = false; this.validatedBridgeAssetId = null; this.selectedAttachmentFile = null; this.selectedAttachmentName = this.getExistingAttachmentName(row); this.selectedAttachmentKind = this.selectedAttachmentName ? 'other' : null;
    this.ensureLocationOptionsLoaded();
    this.prepareLocationDropdownsForDraft(false);
    this.validating = false; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.clearHighlight();

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

    const bestRenderedLayer = this.getBestRenderedLayer(row);
    const selectedFeatureLatLng = this.getSelectedFeatureLatLng(row);
    const renderedLatLng = selectedFeatureLatLng ?? this.getRenderedLayerLatLng(row);
    if (!loadDraftDetail && renderedLatLng && this.shouldAutoZoomOnEditOpen()) {
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
        this.selectedAttachmentName = this.getExistingAttachmentName(this.draft);
        this.selectedAttachmentKind = this.selectedAttachmentName ? 'other' : null;
        const detailLat = Number.isFinite(n.lat) ? n.lat : null;
        const detailLng = Number.isFinite(n.lng) ? n.lng : null;
        if ((loadDraftDetail || !renderedLatLng) && detailLat != null && detailLng != null && this.shouldAutoZoomOnEditOpen()) {
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
          this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: 17, draggable: false } as any);
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
        zoom: 17,
        draggable: false,
        existingLayer: bestRenderedLayer,
      } as any);
      return;
    }

    const lat = Number(row?.lat ?? row?.ycoord ?? row?.latitude);
    const lng = Number(row?.lon ?? row?.lng ?? row?.xcoord ?? row?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: false } as any);
      return;
    }
    if (!Number.isFinite(id)) return;
    if (!layerKey) return;
    this.api.getLayerById(layerKey, id).subscribe({ next: (full) => { const n = this.normalizeCurrentLayerDraft(full); if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return; this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: 17, draggable: false } as any); }, error: (err) => { console.error('zoomToAssetFromRow/getLayerById failed:', err); } });
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
    return {
      objectid: props?.objectid ?? row?.id ?? null,
      distfromkm: props?.distfromkm ?? null,
      distfromm: props?.distfromm ?? null,
      disttokm: props?.disttokm ?? null,
      disttom: props?.disttom ?? null,
      railway: props?.railway ?? '',
      division: props?.division ?? this.currentUser.getSnapshot()?.division ?? '',
      status: props?.status ?? '',
    };
  }

  private normalizeCurrentLayerDraft(row: any) {
    if (this.currentTableLayer === 'stations') return this.normalizeStation(row);
    if (this.currentTableLayer === 'landplan_ontrack') return this.normalizeLandPlan(row);
    const props = row?.properties ?? row ?? {};
    const geometryCoords = Array.isArray(row?.geometry?.coordinates) ? row.geometry.coordinates : null;
    const geometryLng = Number(geometryCoords?.[0]);
    const geometryLat = Number(geometryCoords?.[1]);
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
    normalized.objectid = props?.objectid ?? row?.id ?? row?.objectid ?? null;
    normalized.status = props?.status ?? row?.status ?? '';
    normalized.lat = Number.isFinite(geometryLat) ? geometryLat : Number(props?.geom_lat ?? props?.lat ?? props?.ycoord ?? props?.latitude);
    normalized.lng = Number.isFinite(geometryLng) ? geometryLng : Number(props?.geom_lng ?? props?.lon ?? props?.lng ?? props?.xcoord ?? props?.longitude);
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
    alert('Edit Geometry Mode is ON. You can now move the asset point.');
    this.geomEditing = true;
    this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: this.getEditFocusZoom(), draggable: true });
    this.dragSub?.unsubscribe();
    this.dragSub = this.edit.dragEnd$.subscribe(({ lat: newLat, lng: newLng }) => { if (!this.draft) return; this.draft.lat = newLat; this.draft.lng = newLng; this.cdr.detectChanges(); });
  }

  saveGeometry() {
    if (this.isReviewer()) return;
    if (!this.geomEditing) return;
    alert('Geometry is fixed and Edit Geometry Mode is OFF.');
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
    return RAILWAY_CODE_MAP[this.getRailwayName()] || this.getRailwayName();
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

  shouldShowAttachmentField(): boolean {
    return this.mode === 'edit' && !!this.draft;
  }

  onAttachmentSelected(event: Event, kind: 'other'): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;
    this.selectedAttachmentFile = file;
    this.selectedAttachmentName = file?.name || this.getExistingAttachmentName(this.draft);
    this.selectedAttachmentKind = file ? kind : (this.selectedAttachmentName ? 'other' : null);
  }

  clearAttachmentSelection(input?: HTMLInputElement | null): void {
    this.selectedAttachmentFile = null;
    this.selectedAttachmentName = this.getExistingAttachmentName(this.draft);
    this.selectedAttachmentKind = this.selectedAttachmentName ? 'other' : null;
    if (input) input.value = '';
  }

  private getExistingAttachmentName(source: any): string {
    return String(
      source?.attachment_name ??
      source?.attachment ??
      source?.file_name ??
      source?.filename ??
      ''
    ).trim();
  }

  cancelEdit() {
    if (this.originalDraft) this.draft = { ...this.originalDraft };
    this.edit.cancelCreateStation(); this.mode = 'table'; this.draft = null; this.originalDraft = null; this.error = null; this.validating = false; this.stationValidated = false; this.validatedBridgeAssetId = null; this.showAddRecordModal = false; this.addRecordShapefileName = ''; this.selectedAttachmentFile = null; this.selectedAttachmentName = ''; this.selectedAttachmentKind = null; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.zoomHome(); this.mapZoom.clearHighlight();
  }

  send() {
    if (this.isReviewer()) return;
    if (!this.supportsCurrentLayerPersistence()) {
      alert(`${this.currentLayerSchema?.label || 'This layer'} form is configured, but save workflow is not wired yet.`);
      return;
    }
    if (this.requiresStationValidationBeforeSend()) {
      alert('Please validate the station before sending the record to checker');
      return;
    }
    if (this.requiresBridgeAssetValidationBeforeSend()) {
      alert('Please validate the Asset ID before sending the record to checker');
      return;
    }
    if (this.hasMissingMandatoryFields()) {
      alert('Not all mandatory fields are filled');
      return;
    }
    const draftObjectId = this.draft?.objectid;
    const hasExistingId = draftObjectId !== null && draftObjectId !== undefined && String(draftObjectId).trim() !== '' && Number.isFinite(Number(draftObjectId));
    const isCreate = !hasExistingId;
    const lat = Number(this.draft.lat); const lng = Number(this.draft.lng);
    if (this.requiresGeometryForSave() && (!Number.isFinite(lat) || !Number.isFinite(lng))) { this.error = 'New geometry not captured. Please drag the point and click Save Geometry.'; this.cdr.detectChanges(); return; }
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
    this.saving = true;
    const rawStatus = this.originalDraft?.status == null ? '' : String(this.originalDraft.status).trim().toLowerCase();
    const isMakerRejectedResend = !isCreate && this.isMaker() && rawStatus === 'sent back to maker';
    const isMakerSend = !isCreate && this.isMaker() && !rawStatus;
    if (isCreate) {
      alert(`${this.currentLayerSchema?.label || 'Asset'} creation sent successfully to checker`);
    } else if (isMakerRejectedResend || isMakerSend) {
      alert('Message sent successfully to checker');
    }
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) {
      this.saving = false;
      this.error = 'Layer workflow is not available';
      this.cdr.detectChanges();
      return;
    }

    const request$ = isCreate
      ? this.api.sendNewLayerEdit(layerKey, payload)
      : isMakerRejectedResend
        ? this.api.resendLayerDraft(layerKey, this.draft.objectid, payload)
        : isMakerSend
          ? this.api.sendLayerEdit(layerKey, this.draft.objectid, payload)
          : this.api.updateLayer(layerKey, this.draft.objectid, payload);
    request$.subscribe({
      next: () => {
        this.saving = false;
        this.edit.cancelCreateStation();
        this.mode = 'table';
        this.draft = null;
        this.originalDraft = null;
        this.stationValidated = false;
        this.validatedBridgeAssetId = null;
        this.showAddRecordModal = false;
        this.addRecordShapefileName = '';
        this.selectedAttachmentFile = null;
        this.selectedAttachmentName = '';
        this.selectedAttachmentKind = null;
        this.geomEditing = false;
        this.dragSub?.unsubscribe();
        this.dragSub = undefined;
        this.mapZoom.zoomHome();
        this.mapZoom.clearHighlight();
        setTimeout(() => this.load(false), 0);
        this.cdr.detectChanges();
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
        if (!this.draft) return;
        const row = res?.row || {};
        const validatedName = row?.station_name || this.draft.sttnname;
        const validatedCategory = row?.category || this.draft.category;
        const nameChanged = String(this.draft.sttnname || '') !== String(validatedName || '');
        const categoryChanged = String(this.draft.category || '') !== String(validatedCategory || '');
        this.draft.sttnname = validatedName;
        this.draft.category = validatedCategory;
        if (this.draft?.objectid && (nameChanged || categoryChanged) && !(this.isMaker() && String(this.originalDraft?.status || '').trim().toLowerCase() === 'sent back to maker')) {
          const payload = { distkm: this.draft.distkm, distm: this.draft.distm, state: this.draft.state, district: this.draft.district, constituncy: this.draft.constituncy, sttnname: this.draft.sttnname, category: this.draft.category, sttntype: this.draft.stationtype };
          this.api.updateStation(this.draft.objectid, payload).subscribe({ next: () => { this.validating = false; this.stationValidated = true; alert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges(); }, error: (err: any) => { this.validating = false; alert(err?.error?.message || 'Station code validated but failed to update station details'); this.cdr.detectChanges(); } });
          return;
        }
        this.validating = false; this.stationValidated = true; alert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges();
      },
      error: (err: any) => { this.validating = false; this.stationValidated = false; alert(err?.error?.message || 'Station code validation failed'); this.cdr.detectChanges(); },
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
      alert('Please enter Asset ID');
      return;
    }
    if (this.isRejectedBridgeAssetIdUnchanged()) {
      this.validatedBridgeAssetId = assetId;
      alert('Asset ID is unchanged for this rejected record, so validation is not required.');
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
        alert(res?.message || 'Asset ID is validated. Please fill the rest of the details.');
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.validating = false;
        this.validatedBridgeAssetId = null;
        alert(err?.error?.message || err?.error?.error || 'Asset ID not validated. Please enter a valid Asset ID.');
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
      this.selectedAttachmentFile = null;
      this.selectedAttachmentName = '';
      this.selectedAttachmentKind = null;
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
        alert('Asset Sent to Checker for Deletion');
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
        alert('Asset Sent to Checker for Deletion');
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
        alert('Message sent successfully to checker');
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
    this.mode = 'table'; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.page = 1; this.pageSize = 8; this.search = ''; this.loading = false; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.validatedBridgeAssetId = null; this.showAddRecordModal = false; this.addRecordShapefileName = ''; this.selectedAttachmentFile = null; this.selectedAttachmentName = ''; this.selectedAttachmentKind = null; this.saving = false; this.deleting = false; this.validating = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.error = null; this.edit.setLayer(null as any); this.mapZoom.clearHighlight();
  }

  close() {
    this.mapZoom.zoomHome(); this.mapZoom.clearHighlight(); this.ui.activePanel = null; this.resetPanelState(); this.edit.disable();
  }

  private requiresGeometryForSave(): boolean {
    if (this.currentTableLayer === 'stations' || this.isBridgeLayer()) return true;
    return this.formFields.some((field) => ['latitude', 'longitude', 'xcoord', 'ycoord'].includes(field.key));
  }
}










