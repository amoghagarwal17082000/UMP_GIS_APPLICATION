import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditState } from '../../services/edit-state';
import { Api } from 'src/app/api/api';
import { UiState } from '../../services/ui-state';
import { MapZoomService } from 'src/app/services/map-zoom';
import { CurrentUserService } from 'src/app/services/current-user';
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
type MakerLayerOption = {
  value: string;
  label: string;
  supported: boolean;
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
  private allRows: any[] = [];
  private filteredRows: any[] = [];
  private makerLayerOptions: MakerLayerOption[] = EDIT_LAYER_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    supported: true,
  }));

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
  error: string | null = null;
  makerTab: MakerTabKey = 'edit';
  checkerTab: CheckerTabKey = 'pending';
  rejectedLayer: EditLayerKey | null = null;

  geomEditing = false;
  private dragSub?: Subscription;
  private stateSub?: Subscription;
  private createPointSub?: Subscription;
  private loadSeq = 0;

  constructor(
    public ui: UiState,
    public edit: EditState,
    private api: Api,
    private cdr: ChangeDetectorRef,
    private mapZoom: MapZoomService,
    private currentUser: CurrentUserService
  ) {}

  ngOnInit(): void {
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
      this.beginStationCreationDraft(lat, lng);
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
    return this.isMaker()
      ? this.makerLayerOptions
      : CIVIL_ENGINEERING_ASSET_LAYER_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          supported: !!getEditLayerConfig(option.value),
        }));
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

  getSendButtonLabel(): string {
    if (this.saving) return 'Saving...';
    if (this.isBridgeLayer()) return 'Send to Checker';
    return 'Send';
  }

  get formFields(): EditFieldConfig[] {
    const fields = this.currentLayerSchema?.formFields
      ? [...this.currentLayerSchema.formFields]
      : [];
    if (this.isMakerRejectedDraftView()) {
      fields.push({ key: 'comments', label: 'Comments', full: true });
    }
    if (this.currentTableLayer === 'stations' && this.isMakerSentForDeletionView()) {
      return fields;
    }
    return fields.filter((field) => field.key !== 'status');
  }

  get activeTableColumns(): TableColumnConfig[] {
    return this.currentLayerSchema?.tableColumns
      ? [...this.currentLayerSchema.tableColumns]
      : [];
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
    this.error = null;
    this.stationValidated = false;
    this.validating = false;
    this.saving = false;
    this.deleting = false;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;

    const normalized = this.normalizeCurrentLayerDraft(this.edit.draft);
    this.draft = { ...normalized };
    this.originalDraft = { ...normalized };
    this.cdr.detectChanges();
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
        const maker = makers.find((item: any) => String(item?.user_id || '').trim() === currentUserId);

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
    const allowed = new Set(this.makerLayerOptions.map((option) => option.value));
    if (this.edit.editLayer && !allowed.has(this.edit.editLayer)) {
      this.edit.editLayer = null as any;
      this.edit.resetSelection();
    }
    if (this.rejectedLayer && !allowed.has(this.rejectedLayer)) {
      this.rejectedLayer = null;
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

  setMakerTab(tab: MakerTabKey) { this.makerTab = tab; this.mode = 'table'; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.search = ''; this.page = 1; this.error = null; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; if (tab === 'edit') { this.rejectedLayer = null; this.edit.setLayer(null as any); this.edit.editLayer = null as any; } else if (tab !== 'rejected') { this.rejectedLayer = null; } }
  setCheckerTab(tab: CheckerTabKey) { this.checkerTab = tab; this.mode = 'table'; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.search = ''; this.page = 1; this.error = null; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.edit.setLayer(null as any); this.edit.editLayer = null as any; }
  isCheckerSentToApproverView(): boolean { return this.isReviewer() && this.mode === 'table' && this.checkerTab === 'approved'; }
  isCheckerDeletionProposedView(): boolean { return this.isReviewer() && this.checkerTab === 'deletion_proposed'; }
  isMakerRejectedView(): boolean { return this.isMaker() && this.mode === 'table' && this.makerTab === 'rejected'; }
  isMakerRejectedDraftView(): boolean { return this.isMaker() && this.mode === 'edit' && this.makerTab === 'rejected'; }
  isMakerSentForDeletionView(): boolean { return this.isMaker() && this.makerTab === 'sent_for_deletion'; }
  isStationFieldsLocked(): boolean { return this.stationValidated || this.isReviewer() || this.isMakerSentForDeletionView(); }
  private getReviewerDraftStatus(): string {
    if (!this.isReviewer()) return '';
    if (this.checkerTab === 'pending') {
      return this.isApprover() ? 'Sent to Approver' : 'Sent to Checker';
    }
    if (this.checkerTab === 'approved') return 'Sent to Database';
    if (this.checkerTab === 'deletion_proposed') {
      return this.isApprover() ? 'Sent to Approver for Deletion' : 'Sent to Checker for Deletion';
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
      if (this.isBridgeLayer()) return true;
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
    if (this.isMakerRejectedView()) return 'Sent Back to Maker';
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
          console.error('getStationTable failed', err);
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

  startAddStation() {
    if (this.currentTableLayer !== 'stations') return;
    this.error = null;
    this.mode = 'table';
    this.draft = null;
    this.originalDraft = null;
    this.stationValidated = false;
    this.validating = false;
    this.saving = false;
    this.geomEditing = false;
    this.dragSub?.unsubscribe();
    this.dragSub = undefined;
    this.mapZoom.clearHighlight();
    this.edit.startCreateStation();
    alert('Point drawing mode is on. Double-click inside the division buffer to place the new station.');
    this.cdr.detectChanges();
  }

  private beginStationCreationDraft(lat: number, lng: number) {
    const railway = this.getRailwayName();
    const department = localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '';

    this.mode = 'edit';
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
    this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: false } as any);
    this.cdr.detectChanges();
  }

  editRow(row: any) {
    const loadDraftDetail = this.isReviewer() || this.isMakerRejectedView() || this.isMakerSentForDeletionView();

    this.mode = 'edit'; this.error = null; this.draft = { ...row }; this.originalDraft = { ...row }; this.stationValidated = false;
    this.validating = false; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.clearHighlight();

    const id = Number(row?.objectid); if (!Number.isFinite(id)) return;
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) {
      const normalized = this.normalizeCurrentLayerDraft(row);
      this.draft = { ...normalized };
      this.originalDraft = { ...normalized };
      this.cdr.detectChanges();
      return;
    }

    const detailRequest$ = loadDraftDetail
      ? this.api.getLayerDraftById(layerKey, id)
      : this.api.getLayerById(layerKey, id);

    detailRequest$.subscribe({
      next: (full) => {
        const n = this.normalizeCurrentLayerDraft(full);
        this.draft = { ...this.draft, ...n };
        this.draft.lat = n.lat; this.draft.lng = n.lng; this.originalDraft = { ...this.draft };
        if (Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
          this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: 17, draggable: false } as any);
        }
        this.cdr.detectChanges();
      },
      error: (err) => { console.error('getLayerById failed:', err); this.error = err?.error?.error || 'Failed to load asset details'; this.cdr.detectChanges(); },
    });
  }

  zoomToStationFromRow(row: any) {
    const lat = Number(row?.lat ?? row?.ycoord ?? row?.latitude);
    const lng = Number(row?.lon ?? row?.lng ?? row?.xcoord ?? row?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: false } as any);
      return;
    }
    const id = Number(row?.objectid); if (!Number.isFinite(id)) return;
    const layerKey = this.getPersistenceLayerKey();
    if (!layerKey) return;
    this.api.getLayerById(layerKey, id).subscribe({ next: (full) => { const n = this.normalizeCurrentLayerDraft(full); if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return; this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: 17, draggable: false } as any); }, error: (err) => { console.error('zoomToAssetFromRow/getLayerById failed:', err); } });
  }

  private normalizeStation(s: any) {
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
      constituency: s?.constituncy ?? s?.constituency,
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
    const normalized: any = {};
    Object.keys(props).forEach((key) => {
      normalized[key] = props[key];
    });
    normalized.objectid = props?.objectid ?? row?.id ?? row?.objectid ?? null;
    normalized.status = props?.status ?? row?.status ?? '';
    normalized.lat = Number(props?.lat ?? props?.ycoord ?? props?.latitude);
    normalized.lng = Number(props?.lon ?? props?.lng ?? props?.xcoord ?? props?.longitude);
    return normalized;
  }

  startGeometryEdit() {
    if (this.isReviewer()) return;
    if (!this.draft) return;
    const lat = Number(this.draft.lat); const lng = Number(this.draft.lng);
    alert('Edit Geometry Mode is ON. You can now move the station point.');
    this.geomEditing = true;
    this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: true });
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
      this.mapZoom.zoomTo({ type: 'latlng', lat, lng, zoom: 17, draggable: false } as any);
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
    return ['stations', 'bridge_start', 'bridge_end', 'bridge_minor'].includes(String(this.currentTableLayer || '').trim().toLowerCase());
  }

  supportsCurrentLayerListing(): boolean {
    return this.supportsCurrentLayerPersistence();
  }

  isFieldReadonly(field: EditFieldConfig): boolean {
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
        'comments',
      ]);
      if (readonlyKeys.has(field.key)) return true;
      return this.isReviewer() || this.isMakerSentForDeletionView();
    }
    return true;
  }

  showValidateButton(field: EditFieldConfig): boolean {
    return Boolean(
      field.validateButton &&
      this.currentTableLayer === 'stations' &&
      !this.isReviewer() &&
      !this.isMakerSentForDeletionView()
    );
  }

  cancelEdit() {
    if (this.originalDraft) this.draft = { ...this.originalDraft };
    this.edit.cancelCreateStation(); this.mode = 'table'; this.draft = null; this.originalDraft = null; this.error = null; this.validating = false; this.stationValidated = false; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.zoomHome(); this.mapZoom.clearHighlight();
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
    if (this.hasMissingMandatoryFields()) {
      alert('Not all mandatory fields are filled');
      return;
    }
    const draftObjectId = this.draft?.objectid;
    const hasExistingId = draftObjectId !== null && draftObjectId !== undefined && String(draftObjectId).trim() !== '' && Number.isFinite(Number(draftObjectId));
    const isCreate = !hasExistingId;
    const lat = Number(this.draft.lat); const lng = Number(this.draft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { this.error = 'New geometry not captured. Please drag the point and click Save Geometry.'; this.cdr.detectChanges(); return; }
    const payload = {
      ...this.draft,
      lat,
      lng,
      lon: lng,
      longitude: lng,
      latitude: lat,
      xcoord: lng,
      ycoord: lat,
      railway: this.draft?.railway ?? this.getRailwayCode(),
      zone_name: this.draft?.zone_name ?? this.getRailwayName(),
      fname: this.draft?.fname ?? this.getRailwayName(),
      div_name: this.draft?.div_name ?? (localStorage.getItem('division') || this.currentUser.getSnapshot()?.division || ''),
      department: this.draft?.department ?? (localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || ''),
    };
    this.saving = true;
    const rawStatus = this.originalDraft?.status == null ? '' : String(this.originalDraft.status).trim().toLowerCase();
    const isMakerRejectedResend = !isCreate && this.isMaker() && rawStatus === 'sent back to maker';
    const isMakerSend = !isCreate && this.isMaker() && !rawStatus;
    if (isCreate) {
      alert('Station creation sent successfully to checker');
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
          const payload = { distkm: this.draft.distkm, distm: this.draft.distm, state: this.draft.state, district: this.draft.district, constituncy: this.draft.constituency, sttnname: this.draft.sttnname, category: this.draft.category, sttntype: this.draft.stationtype };
          this.api.updateStation(this.draft.objectid, payload).subscribe({ next: () => { this.validating = false; this.stationValidated = true; alert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges(); }, error: (err: any) => { this.validating = false; alert(err?.error?.message || 'Station code validated but failed to update station details'); this.cdr.detectChanges(); } });
          return;
        }
        this.validating = false; this.stationValidated = true; alert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges();
      },
      error: (err: any) => { this.validating = false; this.stationValidated = false; alert(err?.error?.message || 'Station code validation failed'); this.cdr.detectChanges(); },
    });
  }

  private completeDeleteRequestSuccess() {
    this.deleting = false;
    if (this.draft) {
      this.mode = 'table';
      this.draft = null;
      this.originalDraft = null;
      this.stationValidated = false;
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
    if (!confirm(`Delete station "${row?.sttncode || ''}"?`)) return;
    this.requestDeletionFromMain(row);
  }

  deleteDraft() {
    if (!this.draft?.objectid) return;
    if (!confirm(`Delete station "${this.draft?.sttncode || ''}"?`)) return;
    const isRejectedDraft = this.isMaker() && this.makerTab === 'rejected';
    if (isRejectedDraft) {
      this.requestDeletionFromDraft(this.draft);
      return;
    }
    this.requestDeletionFromMain(this.draft);
  }

  previewRejectedRow(row: any) { this.editRow(row); }
  sendForwardRejected(row: any) { alert(`Send Forward clicked for station ${row?.sttncode || ''}.`); }
  deleteRejectedRow(row: any) {
    if (!confirm(`Delete station "${row?.sttncode || ''}"?`)) return;
    this.requestDeletionFromDraft(row);
  }
  acceptDeletionRow(row: any) {
    const status = this.isApprover() ? 'Asset Deleted' : 'Sent to Approver for Deletion';
    this.updateReviewerDraftStatus(row, status);
  }
  rejectDeletionRow(row: any) { this.updateReviewerDraftStatus(row, 'Sent Back to Maker'); }
  acceptDeletionDraft() { if (!this.draft) return; this.acceptDeletionRow(this.draft); }
  rejectDeletionDraft() { if (!this.draft) return; this.rejectDeletionRow(this.draft); }

  private resetPanelState() {
    this.mode = 'table'; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.page = 1; this.pageSize = 8; this.search = ''; this.loading = false; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.saving = false; this.deleting = false; this.validating = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.error = null; this.edit.setLayer(null as any); this.mapZoom.clearHighlight();
  }

  close() {
    this.mapZoom.zoomHome(); this.mapZoom.clearHighlight(); this.ui.activePanel = null; this.resetPanelState(); this.edit.disable();
  }
}










