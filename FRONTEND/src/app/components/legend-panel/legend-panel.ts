import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { LayerManager } from '../../services/layer-manager';
import { LayerLegend } from '../../services/interface';
import { UiState } from '../../services/ui-state';


@Component({
  selector: 'app-legend-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './legend-panel.html',
  styleUrls: ['./legend-panel.css'],
})
export class LegendPanel {
  private readonly legendTypeOrder: Record<LayerLegend['type'], number> = {
    point: 0,
    line: 1,
    polygon: 2,
  };

  constructor(
    public layerManager: LayerManager,
    public ui: UiState
  ) {}

  close() {
    this.ui.activePanel = null;
  }

  getSortedLayers() {
    return [...this.layerManager.getLayers()].sort((a, b) => {
      const orderDiff = this.legendTypeOrder[a.legend.type] - this.legendTypeOrder[b.legend.type];
      if (orderDiff !== 0) return orderDiff;
      return a.legend.label.localeCompare(b.legend.label);
    });
  }

  resolveSymbolKind(legend: LayerLegend): string {
    if (legend.symbolKind && legend.symbolKind !== 'auto') return legend.symbolKind;
    if (legend.type === 'line') return 'line';
    if (legend.type === 'polygon') return 'square';
    return 'circle';
  }

  getSymbolClasses(legend: LayerLegend): string[] {
    if (legend.imageUrl) {
      return ['symbol', 'symbol-image-wrapper'];
    }
    const kind = this.resolveSymbolKind(legend);
    return ['symbol', `symbol-${kind}`, legend.dashArray ? 'symbol-dashed' : ''].filter(Boolean);
  }

  getSymbolStyle(legend: LayerLegend): Record<string, string | number> {
    if (legend.imageUrl) {
      return {
        width: legend.imageWidth || 20,
        height: legend.imageHeight || 20,
        background: 'transparent',
        border: 'none',
        opacity: 1,
      };
    }

    const kind = this.resolveSymbolKind(legend);
    const stroke = legend.strokeColor || legend.color;
    const fill = legend.fillColor || legend.color;
    const textColor = legend.textColor || stroke;
    const style: Record<string, string | number> = {
      color: textColor,
      borderColor: stroke,
      borderWidth: legend.strokeWidth || 2,
    };

    if (kind === 'line') {
      style.borderTopColor = stroke;
      style.borderTopWidth = legend.strokeWidth || 3;
      style.opacity = 1;
      return style;
    }

    style.background = kind === 'ring' || kind === 'ring-slash' ? '#ffffff' : fill;
    style.opacity = kind === 'square' ? (legend.fillOpacity ?? 1) : 1;

    if (kind === 'circle' || kind === 'diamond' || kind === 'ring' || kind === 'ring-slash') {
      const size = (legend.radius || 7) * 2 + 2;
      style.width = size;
      style.height = size;
    }

    return style;
  }
}
