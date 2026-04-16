import * as L from 'leaflet';
import { NgZone } from '@angular/core';

import { Api } from '../../../api/api';
import { FilterState } from '../../../services/filter-state';
import { EditState } from '../../../services/edit-state';
import {
  LandPlanOntrackViewingLayer,
  StationViewingLayer,
} from '../viewing/civil-engineering-assets-viewing';

export const CIVIL_ENGINEERING_ASSET_LAYER_ALIASES: Record<string, string> = {
  stations: 'Stations',
  station: 'Station',
  km_post: 'Km Post',
  landplan_ontrack: 'Landplan Ontrack',
  landplan_offtrack: 'Landplan Offtrack',
  land_offset: 'Land Offset',
  land_boundary: 'Land Boundary',
  bridge_start: 'Bridge Start',
  bridge_end: 'Bridge End',
  bridge_minor: 'Bridge Minor',
  levelxing: 'Levelxing',
  road_over_bridge: 'Road Over Bridge',
  rub_lhs: 'Rub Lhs',
  ror: 'Ror',
  rob: 'Rob',
  pointxing: 'Pointxing',
  switch_expansion_joint: 'Switch Expansion Joint',
  buffer_rails: 'Buffer Rails',
  gradient_start: 'Gradient Start',
  gradient_end: 'Gradient End',
  curve_start: 'Curve Start',
  curve_end: 'Curve End',
  cutting_start: 'Cutting Start',
  cutting_end: 'Cutting End',
  tunnel_start: 'Tunnel Start',
  tunnel_end: 'Tunnel End',
};

export const CIVIL_ENGINEERING_ASSET_LAYER_OPTIONS = Object.entries(
  CIVIL_ENGINEERING_ASSET_LAYER_ALIASES
).map(([value, label]) => ({
  value,
  label,
}));

function toTitleCase(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function toCivilEngineeringAssetLayerAlias(layerId: string): string {
  const normalized = String(layerId || '').trim().toLowerCase();
  if (!normalized) return '';

  if (CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalized]) {
    return CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalized];
  }

  return toTitleCase(normalized);
}

export function getCivilEngineeringAssetLayerDisplayName(layerId: string, layerName?: string): string {
  const normalizedId = String(layerId || '').trim().toLowerCase();
  const normalizedName = String(layerName || '').trim().toLowerCase();

  if (normalizedId && CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalizedId]) {
    return CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalizedId];
  }

  if (normalizedName && CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalizedName]) {
    return CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalizedName];
  }

  if (normalizedName) {
    return toTitleCase(normalizedName);
  }

  return toCivilEngineeringAssetLayerAlias(layerId);
}

export class StationLayer extends StationViewingLayer {
  private markerIndex = new Map<number, L.Marker>();

  constructor(
    api: Api,
    _filters: FilterState,
    private edit: EditState,
    zone: NgZone,
    onData?: (geojson: any) => void
  ) {
    super(api, zone, onData);
  }

  protected override onMarkerCreated(feature: any, marker: L.Marker) {
    const id = feature?.properties?.objectid;
    if (id) this.markerIndex.set(id, marker);
  }

  protected override onFeatureReady(feature: any, layer: any) {
    layer.on('click', () => {
      if (!this.edit.enabled || this.edit.editLayer !== 'stations') return;
      this.edit.select(feature);
    });
  }

  protected override beforeRender(_geojson: any) {
    this.markerIndex.clear();
  }

  getMarkerById(id: number): L.Marker | null {
    return this.markerIndex.get(id) || null;
  }
}

export class LandPlanOntrackLayer extends LandPlanOntrackViewingLayer {
  constructor(
    api: Api,
    private edit: EditState,
    onData?: (geojson: any) => void
  ) {
    super(api, onData);
  }

  protected override isInteractive(): boolean {
    return true;
  }

  protected override panePointerEvents(): string {
    return 'auto';
  }

  protected override onFeatureReady(feature: any, layer: any): void {
    layer.on('click', () => {
      if (!this.edit.enabled || this.edit.editLayer !== 'landplan') return;
      this.edit.select(feature);
    });
  }
}
