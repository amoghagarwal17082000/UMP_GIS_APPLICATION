import * as L from 'leaflet';
import { NgZone } from '@angular/core';

import { Api } from '../../../api/api';
import { FilterState } from '../../../services/filter-state';
import { EditState } from '../../../services/edit-state';
import { StationCategoryVisibilityService } from '../../../services/station-category-visibility';
import {
  DynamicDepartmentLayer,
  LandBoundaryLayer,
  LandOffsetLayer,
  LandPlanOntrackViewingLayer,
  StationViewingLayer,
} from '../viewing/civil-engineering-assets-viewing';

export const CIVIL_ENGINEERING_ASSET_LAYER_ALIASES: Record<string, string> = {
  stations: 'Stations',
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

export function normalizeCivilEngineeringLayerId(layerId: string): string {
  const normalized = String(layerId || '').trim().toLowerCase();
  const compact = normalized.replace(/[\s-]+/g, '_');
  if (normalized === 'station') return 'stations';
  if (normalized === 'landboundary' || compact === 'landboundary') return 'land_boundary';
  if (normalized === 'land plan on track' || compact === 'land_plan_on_track') return 'landplan_ontrack';
  if (normalized === 'landplan' || compact === 'landplan') return 'landplan_ontrack';
  if (compact === 'bridge_start') return 'bridge_start';
  if (compact === 'bridge_end') return 'bridge_end';
  if (compact === 'bridge_minor') return 'bridge_minor';
  if (compact === 'land_offset') return 'land_offset';
  if (compact === 'land_boundary') return 'land_boundary';
  if (compact === 'km_post') return 'km_post';
  return compact;
}

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
  const normalized = normalizeCivilEngineeringLayerId(layerId);
  if (!normalized) return '';

  if (CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalized]) {
    return CIVIL_ENGINEERING_ASSET_LAYER_ALIASES[normalized];
  }

  return toTitleCase(normalized);
}

export function getCivilEngineeringAssetLayerDisplayName(layerId: string, layerName?: string): string {
  const normalizedId = normalizeCivilEngineeringLayerId(layerId);
  const normalizedName = normalizeCivilEngineeringLayerId(layerName || '');

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
  private markerIndex = new Map<string, L.Marker>();

  constructor(
    api: Api,
    _filters: FilterState,
    private edit: EditState,
    zone: NgZone,
    stationCategoryVisibility: StationCategoryVisibilityService,
    onData?: (geojson: any) => void
  ) {
    super(api, zone, stationCategoryVisibility, onData);
  }

  protected override onMarkerCreated(feature: any, marker: L.Marker) {
    const props = feature?.properties || {};
    [
      props.objectid,
      props.OBJECTID,
      props.gid,
      props.sttncode,
      props.assetid,
      feature?.id,
    ].forEach((key) => {
      const normalized = String(key ?? '').trim().toLowerCase();
      if (normalized) this.markerIndex.set(normalized, marker);
    });
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
    return this.markerIndex.get(String(id).trim().toLowerCase()) || null;
  }

  getRenderedLatLngForKey(...keys: any[]): L.LatLng | null {
    for (const key of keys) {
      const normalized = String(key ?? '').trim().toLowerCase();
      if (!normalized) continue;
      const marker = this.markerIndex.get(normalized);
      if (marker?.getLatLng) return marker.getLatLng();
    }
    return null;
  }

  getBestRenderedLayer(row: any): L.Marker | null {
    const keys = [
      row?.objectid,
      row?.OBJECTID,
      row?.gid,
      row?.sttncode,
      row?.assetid,
      row?.asset_id,
    ];
    for (const key of keys) {
      const normalized = String(key ?? '').trim().toLowerCase();
      if (!normalized) continue;
      const marker = this.markerIndex.get(normalized);
      if (marker) return marker;
    }
    return null;
  }

  getBestRenderedLatLng(row: any): L.LatLng | null {
    return this.getBestRenderedLayer(row)?.getLatLng?.() || null;
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
      if (!this.edit.enabled || normalizeCivilEngineeringLayerId(this.edit.editLayer || '') !== 'landplan_ontrack') return;
      this.edit.select(feature);
    });
  }
}

export class LandOffsetEditLayer extends LandOffsetLayer {
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

  protected override onFeatureReady(feature: any, layer: any): void {
    layer.on('click', () => {
      if (!this.edit.enabled || normalizeCivilEngineeringLayerId(this.edit.editLayer || '') !== 'land_offset') return;
      this.edit.select(feature);
    });
  }
}

export class LandBoundaryEditLayer extends LandBoundaryLayer {
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

  protected override onFeatureReady(feature: any, layer: any): void {
    layer.on('click', () => {
      if (!this.edit.enabled || normalizeCivilEngineeringLayerId(this.edit.editLayer || '') !== 'land_boundary') return;
      this.edit.select(feature);
    });
  }
}

export class DynamicDepartmentEditLayer extends DynamicDepartmentLayer {
  constructor(
    id: string,
    title: string,
    api: Api,
    departmentRef: string,
    layerKey: string,
    private edit: EditState,
    onData?: (geojson: any) => void
  ) {
    super(id, title, api, departmentRef, layerKey, onData);
  }

  protected override isInteractive(): boolean {
    return true;
  }

  protected override onFeatureReady(feature: any, layer: any): void {
    const normalizedLayerKey = normalizeCivilEngineeringLayerId(this.id.replace(/^department_/, ''));
    layer.on('click', () => {
      if (!this.edit.enabled) return;
      if (normalizeCivilEngineeringLayerId(this.edit.editLayer || '') !== normalizedLayerKey) return;
      this.edit.select(feature);
    });
  }
}
