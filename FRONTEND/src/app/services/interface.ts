import * as L from 'leaflet';

export interface LayerLegend {
  type: 'point' | 'line' | 'polygon';
  color: string;
  label: string;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface MapLayer {
  id: string;
  title: string;
  visible: boolean;
  layerGroup?: 'common' | 'department';
  legend: LayerLegend;
  addTo(map: L.Map): void;
  removeFrom(map: L.Map): void;
  loadForMap(map: L.Map): void;
}

export function defineLegend<T extends LayerLegend>(legend: T): T {
  return legend;
}

export function pathStyleFromLegend(legend: LayerLegend): L.PathOptions {
  return {
    color: legend.strokeColor || legend.color,
    weight: legend.strokeWidth || 2,
    opacity: 1,
    fillColor: legend.fillColor || legend.color,
    fillOpacity: legend.type === 'polygon' ? (legend.fillOpacity ?? 0) : undefined,
  };
}

export function circleMarkerOptionsFromLegend(legend: LayerLegend): L.CircleMarkerOptions {
  return {
    radius: legend.radius ?? 6,
    fillColor: legend.fillColor || legend.color,
    color: legend.strokeColor || legend.color,
    weight: legend.strokeWidth || 1,
    opacity: 1,
    fillOpacity: legend.fillOpacity ?? 1,
  };
}
