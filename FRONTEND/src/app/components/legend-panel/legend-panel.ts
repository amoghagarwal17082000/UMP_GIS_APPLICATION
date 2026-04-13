import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { LayerManager } from '../../services/layer-manager';
import { LayerLegend, defineLegend, resolveLegendSymbolKind } from '../../services/interface';
import { UiState } from '../../services/ui-state';

function svgDataUrl(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const POINT_CROSSING_ICON = 'assets/images/pointxing.png';
const LEVEL_CROSSING_ICON = 'assets/images/levelxing.png';
const BRIDGE_START_ICON = 'assets/images/bridge_start.png';
const BRIDGE_END_ICON = 'assets/images/bridge_end.png';
const BRIDGE_MINOR_ICON = 'assets/images/bridge_minor.png';
const ROB_ICON = 'assets/images/rob.png';
const RUB_LHS_ICON = 'assets/images/rub_lhs.png';
const FOB_ICON = 'assets/images/fob.png';
const TUNNEL_START_ICON = 'assets/images/tunnel_start.png';
const TUNNEL_END_ICON = 'assets/images/tunnel_end.png';
const GRADIENT_START_ICON = 'assets/images/gradient_start.png';
const GRADIENT_END_ICON = 'assets/images/gradient_end.png';
const CURVE_START_ICON = 'assets/images/curve_start.png';
const CURVE_END_ICON = 'assets/images/curve_end.png';
const CUTTING_START_ICON = 'assets/images/cutting_start.png';
const CUTTING_END_ICON = 'assets/images/cutting_end.png';

export function inferCivilLegendFromTitle(title: string, type: 'point' | 'line' | 'polygon', matchSource?: string): LayerLegend {
  const normalized = String(matchSource || title || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const entries: Array<{ match: string[]; legend: LayerLegend }> = [
    { match: ['railway track', 'track'], legend: defineLegend({ type: 'line' as const, color: '#111827', label: title, strokeColor: '#111827', strokeWidth: 2, symbolKind: 'track' as const }) },
    { match: ['km post'], legend: defineLegend({ type: 'point' as const, color: '#2563eb', label: title, fillColor: '#2563eb', fillOpacity: 0.95, strokeColor: '#ffffff', strokeWidth: 1, radius: 6, symbolKind: 'diamond' as const }) },
    { match: ['point & crossing', 'point and crossing', 'point xing', 'pointxing', 'point_xing', 'pointxing_1'], legend: defineLegend({ type: 'point' as const, color: '#b86b68', label: title, fillColor: '#d79a97', strokeColor: '#b86b68', strokeWidth: 2, radius: 7, symbolKind: 'point-crossing' as const, imageUrl: POINT_CROSSING_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['level crossing', 'levelxing'], legend: defineLegend({ type: 'point' as const, color: '#1f2937', label: title, fillColor: '#f4b321', strokeColor: '#d97706', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: LEVEL_CROSSING_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['switch expansion joint', '(sej)', 'sej'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: 'S', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['buffer rail', 'buffer rails'], legend: defineLegend({ type: 'point' as const, color: '#65a30d', label: title, fillColor: '#84cc16', strokeColor: '#65a30d', strokeWidth: 1, radius: 5, symbolKind: 'diamond' as const }) },
    { match: ['gradient start'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: GRADIENT_START_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['gradient end'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: GRADIENT_END_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['curve start'], legend: defineLegend({ type: 'point' as const, color: '#d97706', label: title, fillColor: '#f59e0b', strokeColor: '#d97706', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: CURVE_START_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['curve end'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: CURVE_END_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['cutting start'], legend: defineLegend({ type: 'point' as const, color: '#84a65b', label: title, fillColor: '#eef7d0', strokeColor: '#84a65b', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: CUTTING_START_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['cutting end'], legend: defineLegend({ type: 'point' as const, color: '#e57373', label: title, fillColor: '#fff1f1', strokeColor: '#e57373', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: CUTTING_END_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['tunnel start'], legend: defineLegend({ type: 'point' as const, color: '#ff8a65', label: title, fillColor: '#ffab91', strokeColor: '#ff8a65', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: TUNNEL_START_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['tunnel end'], legend: defineLegend({ type: 'point' as const, color: '#0f172a', label: title, fillColor: '#0f172a', strokeColor: '#0f172a', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: TUNNEL_END_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['road over bridge', 'rob'], legend: defineLegend({ type: 'point' as const, color: '#4b5563', label: title, fillColor: '#a3aab5', strokeColor: '#6b7280', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: ROB_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['rub_lhs', 'rub lhs', 'rub'], legend: defineLegend({ type: 'point' as const, color: '#ffffff', label: title, fillColor: '#e7a61b', strokeColor: '#d97706', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: RUB_LHS_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['foot over bridge', 'fob'], legend: defineLegend({ type: 'point' as const, color: '#d97706', label: title, fillColor: '#fde047', strokeColor: '#eab308', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: FOB_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['rail over rail', 'ror'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 7, symbolText: 'R', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['bridge start'], legend: defineLegend({ type: 'point' as const, color: '#66bb6a', label: title, fillColor: '#9be59d', strokeColor: '#66bb6a', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: BRIDGE_START_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['bridge end', 'bridge stop'], legend: defineLegend({ type: 'point' as const, color: '#6b7280', label: title, fillColor: '#9ca3af', strokeColor: '#6b7280', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: BRIDGE_END_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['bridge minor'], legend: defineLegend({ type: 'point' as const, color: '#2f80d1', label: title, fillColor: '#eaf3ff', strokeColor: '#2f80d1', strokeWidth: 2, radius: 8, symbolKind: 'square' as const, imageUrl: BRIDGE_MINOR_ICON, imageWidth: 18, imageHeight: 18 }) },
    { match: ['bridge'], legend: defineLegend({ type: 'point' as const, color: '#66bb6a', label: title, fillColor: '#9be59d', strokeColor: '#66bb6a', strokeWidth: 2, radius: 7, symbolText: 'B', textColor: '#ffffff', symbolKind: 'circle' as const }) },
    { match: ['land boundary'], legend: defineLegend({ type: 'line' as const, color: '#f59e0b', label: title, strokeColor: '#f59e0b', strokeWidth: 3, symbolKind: 'line' as const }) },
    { match: ['land offset'], legend: defineLegend({ type: 'line' as const, color: '#111827', label: title, strokeColor: '#111827', strokeWidth: 2, symbolKind: 'line' as const }) },
    { match: ['landplan ontrack', 'land plan ontrack', 'land plans (on-track)', 'land plans on-track'], legend: defineLegend({ type: 'polygon' as const, color: '#FFA500', label: title, fillColor: '#FFA500', fillOpacity: 0.15, strokeColor: '#FFA500', strokeWidth: 3, symbolKind: 'square' as const }) },
    { match: ['land plans (off-track)', 'land plans off-track', 'land plan offtrack', 'landplan offtrack'], legend: defineLegend({ type: 'polygon' as const, color: '#f59e0b', label: title, fillColor: '#f59e0b', fillOpacity: 0.15, strokeColor: '#f59e0b', strokeWidth: 2, symbolKind: 'square' as const }) },
    { match: ['land parcels', 'land parcel'], legend: defineLegend({ type: 'polygon' as const, color: '#818cf8', label: title, fillColor: '#818cf8', fillOpacity: 0.15, strokeColor: '#818cf8', strokeWidth: 2, symbolKind: 'square' as const }) },
  ];

  const matched = entries.find((entry) => entry.match.some((token) => normalized.includes(token)));
  if (matched) return matched.legend;

  if (type === 'point') {
    return defineLegend({ type: 'point' as const, color: '#f97316', label: title, fillColor: '#f97316', fillOpacity: 0.9, strokeColor: '#ffffff', strokeWidth: 1, radius: 7, symbolKind: 'circle' as const });
  }

  if (type === 'line') {
    return defineLegend({ type: 'line' as const, color: '#facc15', label: title, strokeColor: '#facc15', strokeWidth: 3, symbolKind: 'line' as const });
  }

  return defineLegend({ type: 'polygon' as const, color: '#4dd0e1', label: title, fillColor: '#4dd0e1', fillOpacity: 0.15, strokeColor: '#4dd0e1', strokeWidth: 2, symbolKind: 'square' as const });
}

export function inferCivilLegendFromFeatureCollection(title: string, layerKey: string, geojson: any): LayerLegend {
  const feature = geojson?.features?.find((f: any) => !!f?.geometry?.type);
  const type = String(feature?.geometry?.type || '').toLowerCase();
  const resolvedType: 'point' | 'line' | 'polygon' = type.includes('point') ? 'point' : type.includes('line') ? 'line' : 'polygon';
  const matchSource = [title, layerKey].filter(Boolean).join(' ');
  return inferCivilLegendFromTitle(title, resolvedType, matchSource);
}

export function getLegendSymbolKind(legend: LayerLegend): string {
  return resolveLegendSymbolKind(legend);
}

export function getLegendCustomSymbolHtml(legend: LayerLegend): string | null {
  const kind = getLegendSymbolKind(legend);
  const stroke = legend.strokeColor || legend.color;
  const fill = legend.fillColor || legend.color;
  const textColor = legend.textColor || stroke;
  const weight = legend.strokeWidth || 2;

  if (kind === 'point-crossing' && !legend.imageUrl) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"/><rect x="7.8" y="7.8" width="4.4" height="4.4" fill="#ffffff" transform="rotate(45 10 10)"/><line x1="5.4" y1="14.6" x2="14.6" y2="5.4" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  if (kind === 'level-crossing' && !legend.imageUrl) {
    return '<div style="position:relative;width:18px;height:18px;clip-path:polygon(50% 0,0 100%,100% 100%);background:' + fill + ';border:' + weight + 'px solid ' + stroke + ';box-sizing:border-box;">'
      + '<span style="position:absolute;left:50%;top:66%;width:8px;height:3px;background:' + textColor + ';transform:translate(-50%,-50%);border-radius:1px;"></span>'
      + '<span style="position:absolute;left:50%;top:42%;width:2px;height:5px;background:' + textColor + ';transform:translate(-50%,-50%);border-radius:1px;"></span>'
      + '</div>';
  }

  return null;
}

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
    return getLegendSymbolKind(legend);
  }

  getCustomSymbolHtml(legend: LayerLegend): string | null {
    return getLegendCustomSymbolHtml(legend);
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


