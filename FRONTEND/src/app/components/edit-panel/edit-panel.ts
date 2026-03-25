import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditState } from '../../services/edit-state';
import { Api } from 'src/app/api/api';
import { UiState } from '../../services/ui-state';
import { MapZoomService } from 'src/app/services/map-zoom';
import { CurrentUserService } from 'src/app/services/current-user';

type EditLayerKey = string;
type LayerGroupKey = 'bridge';
type MakerTabKey = 'edit' | 'rejected' | 'sent_for_deletion';
type CheckerTabKey = 'pending' | 'approved' | 'deletion_proposed';

type TableColumn = {
  key: string;
  label: string;
  universal?: boolean;
  layers?: EditLayerKey[];
  layerGroups?: LayerGroupKey[];
  stationLink?: boolean;
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
  private readonly mandatoryStationFields: Array<keyof any> = [
    'sttncode',
    'sttnname',
    'stationtype',
    'distkm',
    'distm',
    'state',
    'district',
    'category',
    'constituency',
  ];

  private tableColumns: TableColumn[] = [
    { key: 'sttncode', label: 'Station Code', layers: ['stations'], stationLink: true },
    { key: 'distkm', label: 'Dist (km)', universal: true },
    { key: 'distm', label: 'Dist (m)', universal: true },
    { key: 'state', label: 'State', universal: true },
    { key: 'district', label: 'District', universal: true },
    { key: 'bridgetype', label: 'Bridge Type', layerGroups: ['bridge'] },
    { key: 'spanconf', label: 'Span Configuration', layerGroups: ['bridge'] },
    { key: 'bridgeno', label: 'Bridge No.', layerGroups: ['bridge'] },
    { key: 'distfromkm', label: 'From KM', layers: ['landplan'] },
    { key: 'distfromm', label: 'From M', layers: ['landplan'] },
    { key: 'disttokm', label: 'To KM', layers: ['landplan'] },
    { key: 'disttom', label: 'To M', layers: ['landplan'] },
  ];

  constructor(
    public ui: UiState,
    public edit: EditState,
    private api: Api,
    private cdr: ChangeDetectorRef,
    private mapZoom: MapZoomService,
    private currentUser: CurrentUserService
  ) {}

  ngOnInit(): void {
    this.stateSub = this.edit.stateChanged$.subscribe(() => {
      if (!this.edit.enabled) return;
      if (this.edit.editLayer === 'stations' && this.mode === 'table' && !this.edit.creatingStation) this.load(true);
    });

    this.createPointSub = this.edit.createStationPoint$.subscribe(({ lat, lng }) => {
      this.beginStationCreationDraft(lat, lng);
    });

    if (this.edit.enabled && this.edit.editLayer === 'stations') {
      this.load(true);
    }
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

  get activeTableColumns(): TableColumn[] {
    const layer = this.currentTableLayer;
    if (!layer) return [];
    const columns = this.tableColumns.filter((c) => {
      if (c.universal) return true;
      if (c.layers?.includes(layer)) return true;
      if (c.layerGroups?.some((g) => this.isLayerInGroup(layer, g))) return true;
      return false;
    });
    if (this.isMakerRejectedView()) {
      columns.push({ key: 'comments', label: 'Comments' });
    }
    return columns;
  }

  get tableColSpan(): number {
    return this.activeTableColumns.length + 1;
  }

  getCellValue(row: any, key: string): any {
    if (!row) return null;
    if (key === 'sttntype') return row?.sttntype ?? row?.stationtype;
    if (key === 'bridgeno') return row?.bridgeno ?? row?.rorno;
    if (key === 'comments') {
      return row?.comments ?? row?.comment ?? row?.remarks ?? row?.remark ?? row?.reject_reason ?? row?.rejected_reason;
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

  private isLayerInGroup(layer: string, group: LayerGroupKey): boolean {
    const normalized = String(layer || '').trim().toLowerCase();
    if (!normalized) return false;

    if (group === 'bridge') {
      return normalized.includes('bridge') || normalized.includes('rail over rail') || normalized === 'ror';
    }

    return false;
  }

  onLayerChange() {
    this.edit.setLayer(this.edit.editLayer);

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

    if (this.edit.editLayer) setTimeout(() => this.load(true), 0);
  }

  private getUserType(): string {
    return (this.currentUser.getSnapshot()?.user_type || '').trim().toLowerCase();
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
  get currentTableLayer(): EditLayerKey | null { if (this.isMakerRejectedView()) return this.rejectedLayer; return (this.edit.editLayer as EditLayerKey | null) ?? null; }

  onRejectedLayerChange() {
    this.mode = 'table'; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.page = 1; this.search = ''; this.error = null; this.draft = null;
    this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.clearHighlight();
    this.edit.setLayer((this.rejectedLayer as any) ?? null);
    if (this.rejectedLayer) setTimeout(() => this.load(true), 0);
  }

  private updateReviewerDraftStatus(row: any, status: 'Sent to Approver' | 'Sent Back to Maker' | 'Sent to Database') {
    if (!this.isReviewer()) return;

    const id = Number(row?.objectid);
    if (!Number.isFinite(id)) {
      this.error = 'Invalid draft record';
      this.cdr.detectChanges();
      return;
    }

    this.saving = true;
    this.error = null;

    this.api.updateStationDraftStatus(id, status).subscribe({
      next: (res: any) => {
        const updatedDraft = res?.draft || row;
        const updatedId = Number(updatedDraft?.objectid ?? row?.objectid);
        this.saving = false;

        const alertText = status === 'Sent to Approver'
          ? 'Asset Sent to Approver'
          : status === 'Sent Back to Maker'
            ? 'Asset Sent Back to Maker'
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
    if (userType === 'maker') return status === '';
    if (userType === 'checker') return status === 'sent to checker';
    if (userType === 'approver') return status === 'sent to approver';
    return true;
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
    if (layer !== 'stations') {
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

    const fetchOne = (p: number) => {
      if (seq !== this.loadSeq) return;

      (this.isReviewer() ? this.api.getStationDraftTable(p, this.fetchPageSize, this.search, this.getReviewerDraftStatus()) : this.api.getStationTable(p, this.fetchPageSize, this.search)).subscribe({
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
      return status === 'sent to checker for deletion' || status === 'sent to approver for deletion' || status === 'sent for deletion';
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
    this.mode = 'edit'; this.error = null; this.draft = { ...row }; this.originalDraft = { ...row }; this.stationValidated = false;
    this.validating = false; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.clearHighlight();

    const id = Number(row?.objectid); if (!Number.isFinite(id)) return;

    const detailRequest$ = this.isReviewer() ? this.api.getStationDraftById(id) : this.api.getStationById(id);

    detailRequest$.subscribe({
      next: (full) => {
        const n = this.normalizeStation(full);
        this.draft = { ...this.draft, ...n };
        this.draft.lat = n.lat; this.draft.lng = n.lng; this.originalDraft = { ...this.draft };
        if (Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
          this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: 17, draggable: false } as any);
        }
        this.cdr.detectChanges();
      },
      error: (err) => { console.error('getStationById failed:', err); this.error = err?.error?.error || 'Failed to load station details'; this.cdr.detectChanges(); },
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
    this.api.getStationById(id).subscribe({ next: (full) => { const n = this.normalizeStation(full); if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return; this.mapZoom.zoomTo({ type: 'latlng', lat: n.lat, lng: n.lng, zoom: 17, draggable: false } as any); }, error: (err) => { console.error('zoomToStationFromRow/getStationById failed:', err); } });
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
      lat: Number(s?.lat ?? s?.ycoord ?? s?.latitude),
      lng: Number(s?.lon ?? s?.lng ?? s?.xcoord ?? s?.longitude),
    };
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
    return this.mandatoryStationFields.includes(field);
  }

  private isBlankValue(value: unknown): boolean {
    return value == null || String(value).trim() === '';
  }

  private hasMissingMandatoryStationFields(): boolean {
    if (!this.draft) return true;
    return this.mandatoryStationFields.some((field) => this.isBlankValue(this.draft?.[field]));
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

  cancelEdit() {
    if (this.originalDraft) this.draft = { ...this.originalDraft };
    this.edit.cancelCreateStation(); this.mode = 'table'; this.draft = null; this.originalDraft = null; this.error = null; this.validating = false; this.stationValidated = false; this.saving = false; this.deleting = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.zoomHome(); this.mapZoom.clearHighlight();
  }

  send() {
    if (this.isReviewer()) return;
    if (this.requiresStationValidationBeforeSend()) {
      alert('Please validate the station before sending the record to checker');
      return;
    }
    if (this.hasMissingMandatoryStationFields()) {
      alert('Not all mandatory fields are filled');
      return;
    }
    const draftObjectId = this.draft?.objectid;
    const hasExistingId = draftObjectId !== null && draftObjectId !== undefined && String(draftObjectId).trim() !== '' && Number.isFinite(Number(draftObjectId));
    const isCreate = !hasExistingId;
    const lat = Number(this.draft.lat); const lng = Number(this.draft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { this.error = 'New geometry not captured. Please drag the point and click Save Geometry.'; this.cdr.detectChanges(); return; }
    const payload = {
      sttncode: this.draft.sttncode,
      sttnname: this.draft.sttnname,
      sttntype: this.draft.stationtype,
      category: this.draft.category,
      distkm: this.draft.distkm,
      distm: this.draft.distm,
      state: this.draft.state,
      district: this.draft.district,
      constituncy: this.draft.constituency,
      lat,
      lng,
      lon: lng,
      longitude: lng,
      latitude: lat,
      xcoord: lng,
      ycoord: lat,
      railway: this.getRailwayCode(),
      zone_name: this.getRailwayName(),
      fname: this.getRailwayName(),
      div_name: localStorage.getItem('division') || this.currentUser.getSnapshot()?.division || '',
      department: localStorage.getItem('department') || this.currentUser.getSnapshot()?.department || '',
    };
    this.saving = true;
    const rawStatus = this.originalDraft?.status == null ? '' : String(this.originalDraft.status).trim().toLowerCase();
    const isMakerSend = !isCreate && this.isMaker() && !rawStatus;
    if (isCreate) {
      alert('Station creation sent successfully to checker');
    } else if (isMakerSend) {
      alert('Message sent successfully to checker');
    }
    const request$ = isCreate
      ? this.api.sendNewStationEdit(payload)
      : isMakerSend
        ? this.api.sendStationEdit(this.draft.objectid, payload)
        : this.api.updateStation(this.draft.objectid, payload);
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
        if (this.draft?.objectid && (nameChanged || categoryChanged)) {
          const payload = { distkm: this.draft.distkm, distm: this.draft.distm, state: this.draft.state, district: this.draft.district, constituncy: this.draft.constituency, sttnname: this.draft.sttnname, category: this.draft.category, sttntype: this.draft.stationtype };
          this.api.updateStation(this.draft.objectid, payload).subscribe({ next: () => { this.validating = false; this.stationValidated = true; alert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges(); }, error: (err: any) => { this.validating = false; alert(err?.error?.message || 'Station code validated but failed to update station details'); this.cdr.detectChanges(); } });
          return;
        }
        this.validating = false; this.stationValidated = true; alert(res?.message || 'Station code validated successfully'); this.cdr.detectChanges();
      },
      error: (err: any) => { this.validating = false; this.stationValidated = false; alert(err?.error?.message || 'Station code validation failed'); this.cdr.detectChanges(); },
    });
  }

  deleteRow(row: any) { if (!confirm(`Delete station "${row.sttncode}"?`)) return; this.deleting = true; this.api.deleteStation(row.objectid).subscribe({ next: () => { this.deleting = false; this.allRows = this.allRows.filter((r) => r.objectid !== row.objectid); this.filteredRows = this.allRows.filter((r) => this.isVisibleForCurrentView(r)); if (this.page > this.totalPages) this.page = this.totalPages; this.applyPagination(); this.cdr.detectChanges(); }, error: () => { this.deleting = false; this.cdr.detectChanges(); } }); }
  deleteDraft() { if (!this.draft?.objectid) return; const row = { objectid: this.draft.objectid, sttncode: this.draft.sttncode }; if (!confirm(`Delete station "${row.sttncode}"?`)) return; this.deleting = true; this.api.deleteStation(row.objectid).subscribe({ next: () => { this.deleting = false; this.mode = 'table'; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.error = null; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.mapZoom.zoomHome(); this.mapZoom.clearHighlight(); setTimeout(() => this.load(false), 0); this.cdr.detectChanges(); }, error: () => { this.deleting = false; this.cdr.detectChanges(); } }); }
  previewRejectedRow(row: any) { this.editRow(row); }
  sendForwardRejected(row: any) { alert(`Send Forward clicked for station ${row?.sttncode || ''}.`); }
  deleteRejectedRow(row: any) { this.deleteRow(row); }
  acceptDeletionRow(row: any) { alert(`Accept Deletion clicked for station ${row?.sttncode || ''}.`); }
  rejectDeletionRow(row: any) { alert(`Reject Deletion clicked for station ${row?.sttncode || ''}.`); }
  acceptDeletionDraft() { if (!this.draft) return; this.acceptDeletionRow(this.draft); }
  rejectDeletionDraft() { if (!this.draft) return; this.rejectDeletionRow(this.draft); }

  private resetPanelState() {
    this.mode = 'table'; this.rows = []; this.allRows = []; this.filteredRows = []; this.total = 0; this.filteredTotal = 0; this.page = 1; this.pageSize = 8; this.search = ''; this.loading = false; this.draft = null; this.originalDraft = null; this.stationValidated = false; this.saving = false; this.deleting = false; this.validating = false; this.geomEditing = false; this.dragSub?.unsubscribe(); this.dragSub = undefined; this.error = null; this.edit.setLayer(null as any); this.mapZoom.clearHighlight();
  }

  close() {
    this.mapZoom.zoomHome(); this.mapZoom.clearHighlight(); this.ui.activePanel = null; this.resetPanelState(); this.edit.disable();
  }
}










