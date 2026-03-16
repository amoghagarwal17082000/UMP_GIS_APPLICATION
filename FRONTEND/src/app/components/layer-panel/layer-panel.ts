import { Component } from '@angular/core';
import { UiState } from '../../services/ui-state';
import { LayerManager } from '../../services/layer-manager';
import { MapRegistry } from '../../services/map-registry';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';


@Component({
  selector: 'app-layer-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './layer-panel.html',
  styleUrls: ['./layer-panel.css'],
})
export class LayerPanel {
constructor(public ui: UiState,                 
    public layerManager: LayerManager,  
    private mapRegistry: MapRegistry   ) {}

    close() {
      this.ui.activePanel = null;
    }

  getLabel(layer: { title?: string; legend?: { label?: string } }): string {
    return layer.title?.trim() || layer.legend?.label?.trim() || 'Layer';
  }

  trackByLayerId(_index: number, layer: { id: string }): string {
    return layer.id;
  }

    toggleLayer() {
    if (!this.mapRegistry.hasMap()) return;

    const map = this.mapRegistry.getMap();
    this.layerManager.applyVisibility(map);
    this.layerManager.reloadVisible(map);
  }
}

