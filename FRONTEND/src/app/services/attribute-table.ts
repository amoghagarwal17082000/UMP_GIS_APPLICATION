import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export type AttrRow = Record<string, any>;
export type LayerKey = string;

export type Dataset = {
  rows: AttrRow[];
  columns: string[];
  count: number;
  features: any[];
};

@Injectable({ providedIn: 'root' })
export class AttributeTableService {
  private readonly emptyDataset: Dataset = {
    rows: [],
    columns: [],
    count: 0,
    features: [],
  };

  private _open = new BehaviorSubject<boolean>(false);
  open$ = this._open.asObservable();

  private _tabs = new BehaviorSubject<LayerKey[]>(['Km Post', 'Railway Track']);
  tabs$ = this._tabs.asObservable();

  private _active = new BehaviorSubject<LayerKey>('Km Post');
  active$ = this._active.asObservable();

  private _datasets = new BehaviorSubject<Record<LayerKey, Dataset>>({
    'Km Post': { rows: [], columns: [], count: 0, features: [] },
    'Railway Track': { rows: [], columns: [], count: 0, features: [] },
  });
  datasets$ = this._datasets.asObservable();

  private rawFeatures: Record<LayerKey, any[]> = {
    'Km Post': [],
    'Railway Track': [],
  };

  private _selected = new BehaviorSubject<{ layer: LayerKey; rowId: number; signature: string } | null>(null);
  selected$ = this._selected.asObservable();

  private _zoomTo = new Subject<{ layer: LayerKey; feature: any }>();
  zoomTo$ = this._zoomTo.asObservable();

  private _clearSelection = new Subject<void>();
  clearSelection$ = this._clearSelection.asObservable();

  private materializeTimer: ReturnType<typeof setTimeout> | null = null;

  setTabs(tabs: LayerKey[]) {
    const uniqueTabs = Array.from(new Set(tabs.filter(Boolean)));
    const nextTabs = uniqueTabs.length ? uniqueTabs : ['Km Post', 'Railway Track'];
    const currentDatasets = this._datasets.getValue();
    const nextDatasets: Record<LayerKey, Dataset> = {};

    nextTabs.forEach((tab) => {
      nextDatasets[tab] = currentDatasets[tab] ?? { ...this.emptyDataset };
      this.rawFeatures[tab] = this.rawFeatures[tab] ?? [];
    });

    this._tabs.next(nextTabs);
    this._datasets.next(nextDatasets);

    if (!nextTabs.includes(this._active.getValue())) {
      this._active.next(nextTabs[0]);
    }
  }

  setActive(tab: LayerKey) {
    this._active.next(tab);
    if (this._open.getValue()) this.scheduleMaterialize(tab);
  }

  toggle() {
    const next = !this._open.getValue();
    this._open.next(next);
    if (next) this.scheduleMaterialize(this._active.getValue());
  }

  show() {
    this._open.next(true);
    this.scheduleMaterialize(this._active.getValue());
  }

  hide() {
    this._open.next(false);
  }

  pushFeatureCollection(tab: LayerKey, geojson: any) {
    const fc =
      geojson?.type === 'Feature'
        ? { type: 'FeatureCollection', features: [geojson] }
        : geojson;

    const features = (fc?.features ?? []).map((f: any) => ({
      ...f,
      properties: f?.properties ?? f?.attributes ?? {},
    }));

    this.rawFeatures[tab] = features;

    const next = { ...this._datasets.getValue() };
    const previous = next[tab] ?? { ...this.emptyDataset };
    next[tab] = {
      ...previous,
      count: features.length,
    };
    this._datasets.next(next);

    if (this._open.getValue() && this._active.getValue() === tab) {
      this.scheduleMaterialize(tab);
    }
  }

  zoomToRow(tab: LayerKey, row: AttrRow) {
    const ds = this._datasets.getValue()[tab];
    const idx = Number((row as any).__rowid);
    const feature = ds?.features?.[idx];
    if (feature) this._zoomTo.next({ layer: tab, feature });
  }

  selectRow(tab: LayerKey, row: AttrRow) {
    const rowId = Number((row as any).__rowid);
    if (Number.isNaN(rowId)) return;
    this._selected.next({ layer: tab, rowId, signature: this.getRowSignature(row) });
  }

  getSelected() {
    return this._selected.getValue();
  }

  clearSelection() {
    this._selected.next(null);
    this._clearSelection.next();
  }

  private scheduleMaterialize(tab: LayerKey) {
    if (this.materializeTimer) {
      clearTimeout(this.materializeTimer);
    }

    this.materializeTimer = setTimeout(() => {
      this.materializeTimer = null;
      this.materializeTab(tab);
    }, 0);
  }

  private materializeTab(tab: LayerKey) {
    const features = this.rawFeatures[tab] ?? [];
    const rows: AttrRow[] = features.map((f: any, i: number) => ({
      __rowid: i,
      ...(f.properties ?? {}),
    }));

    const colSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key !== '__rowid') colSet.add(key);
      }
    }

    const preferred = ['OBJECTID', 'objectid', 'id', 'km', 'division', 'railway'];
    const cols = [
      ...preferred.filter((p) => colSet.has(p)),
      ...Array.from(colSet).filter((k) => !preferred.includes(k)).sort(),
    ];

    const next = { ...this._datasets.getValue() };
    next[tab] = {
      rows,
      columns: cols,
      count: rows.length,
      features,
    };

    this._datasets.next(next);

    const selected = this._selected.getValue();
    if (!selected || selected.layer !== tab) return;

    const sameRowExists = rows.some((row) => Number((row as any).__rowid) === selected.rowId);
    if (sameRowExists) return;

    const matchedRow = rows.find((row) => this.getRowSignature(row) === selected.signature);
    if (matchedRow) {
      this._selected.next({
        layer: tab,
        rowId: Number((matchedRow as any).__rowid),
        signature: selected.signature,
      });
      return;
    }

    this._selected.next(null);
  }

  private getRowSignature(row: AttrRow): string {
    const payload = Object.keys(row)
      .filter((key) => key !== '__rowid')
      .sort()
      .map((key) => [key, row[key] ?? null]);
    return JSON.stringify(payload);
  }
}
