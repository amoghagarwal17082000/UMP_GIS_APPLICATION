import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UiState {
  activePanel: string | null = null;

  // ✅ ADD: layout change notifier (for Leaflet resize etc.)
  private _layoutChanged = new Subject<void>();
  layoutChanged$ = this._layoutChanged.asObservable();

  notifyLayoutChanged(): void {
    this._layoutChanged.next();
  }

  toggle(panel: string) {
    this.activePanel = this.activePanel === panel ? null : panel;
  }

  isOpen(panel: string): boolean {
    return this.activePanel === panel;
  }

  close() {
    this.activePanel = null;
  }

  selectedBasemap:
    | 'Open Street Map'
    | 'satellite'
    | 'Google Satellite'
    | 'Esri Topographic'
    | 'Bhuvan India' = 'Esri Topographic';
}
