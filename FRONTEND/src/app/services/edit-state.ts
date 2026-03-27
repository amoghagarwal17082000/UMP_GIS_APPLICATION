import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type EditableLayer = 'stations' | 'landplan' | null;

@Injectable({ providedIn: 'root' })
export class EditState {
  enabled = false;
  editLayer: EditableLayer = null;

  selectedFeatureId: number | null = null;
  draft: any = null;
  creatingStation = false;

  private _dragEnd$ = new Subject<{ lat: number; lng: number }>();
  readonly dragEnd$ = this._dragEnd$.asObservable();

  private _lockDrag$ = new Subject<void>();
  readonly lockDrag$ = this._lockDrag$.asObservable();

  private _createStationPoint$ = new Subject<{ lat: number; lng: number }>();
  readonly createStationPoint$ = this._createStationPoint$.asObservable();

  private _stateChanged$ = new Subject<void>();
  readonly stateChanged$ = this._stateChanged$.asObservable();

  private notify() {
    this._stateChanged$.next();
  }

  emitDragEnd(lat: number, lng: number) {
    this._dragEnd$.next({ lat, lng });
  }

  lockDrag() {
    this._lockDrag$.next();
  }

  startCreateStation() {
    this.creatingStation = true;
    this.selectedFeatureId = null;
    this.draft = null;
    this.notify();
  }

  cancelCreateStation() {
    if (!this.creatingStation) return;
    this.creatingStation = false;
    this.notify();
  }

  emitCreateStationPoint(lat: number, lng: number) {
    this.creatingStation = false;
    this._createStationPoint$.next({ lat, lng });
    this.notify();
  }

  enable() {
    this.enabled = true;
    this.reset();
    this.notify();
  }

  disable() {
    this.enabled = false;
    this.reset();
    this.notify();
  }

  setLayer(layer: EditableLayer) {
    this.editLayer = layer;
    this.resetSelection();
    this.notify();
  }

  resetSelection() {
    this.selectedFeatureId = null;
    this.draft = null;
    this.creatingStation = false;
  }

  reset() {
    this.editLayer = null;
    this.selectedFeatureId = null;
    this.draft = null;
    this.creatingStation = false;
  }

  select(feature: any) {
    const id = feature?.id ?? feature?.properties?.objectid ?? null;
    this.selectedFeatureId = id;
    this.draft = { ...(feature.properties || {}) };
    this.creatingStation = false;
    this.notify();
  }
}
