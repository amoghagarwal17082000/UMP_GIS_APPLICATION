import { getEditLayerConfig } from './edit-layer-config';
import {
  getCivilEngineeringAssetLayerDisplayName,
  normalizeCivilEngineeringLayerId,
} from '../../departments/civil_engineering_assets/editing/civil-engineering-assets-editing';

export type DynamicEditLayerOption = {
  value: string;
  label: string;
  supported: boolean;
};

function normalizeLayerValue(value: any): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toEditLayerKey(layer: any): string | null {
  const id = normalizeCivilEngineeringLayerId(normalizeLayerValue(layer?.layer_id));
  const name = normalizeCivilEngineeringLayerId(normalizeLayerValue(layer?.layar_name));
  const combined = `${id} ${name}`.trim();

  if (id === 'station' || name === 'station' || combined.includes('station')) return 'station';
  if (id === 'landplan_ontrack' || name === 'landplan_ontrack' || combined.includes('land plan')) {
    return 'landplan_ontrack';
  }

  return getEditLayerConfig(id)?.id || getEditLayerConfig(name)?.id || null;
}

export function makeUnsupportedLayerValue(layerId: any): string {
  return `unsupported:${String(layerId || '').trim()}`;
}

export function buildDynamicEditLayerOptions(
  departmentLayers: any[],
  assignedIds: string[],
): DynamicEditLayerOption[] {
  const nextOptions: DynamicEditLayerOption[] = [];
  const seenValues = new Set<string>();

  (Array.isArray(departmentLayers) ? departmentLayers : [])
    .filter((layer: any) => assignedIds.includes(String(layer?.layer_id || '').trim()))
    .forEach((layer: any) => {
      const editKey = toEditLayerKey(layer);
      const value = editKey || makeUnsupportedLayerValue(layer?.layer_id);
      if (seenValues.has(value)) return;

      seenValues.add(value);
      nextOptions.push({
        value,
        label: getCivilEngineeringAssetLayerDisplayName(
          String(layer?.layer_id || '').trim(),
          String(layer?.layar_name || '').trim(),
        ),
        supported: !!editKey,
      });
    });

  return nextOptions;
}
