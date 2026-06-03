import * as L from 'leaflet';
import { Injectable } from '@angular/core';
import { MapLayer } from './interface';

export interface LayerGroupView {
  key: 'common' | 'department';
  title: string;
  layers: MapLayer[];
}

@Injectable({ providedIn: 'root' })
export class LayerManager {
  private layers: MapLayer[] = [];
  private activeDepartmentLabel = 'Department Layers';
  private groupedLayers: LayerGroupView[] = [];
  private loadFrame: number | null = null;

  // ✅ use only for quick tests; prefer registerOnce
  register(layer: MapLayer) {
    this.layers.push(layer);
    this.rebuildGroups();
  }

  // ✅ prevents duplicates by id (IMPORTANT in Angular services)
  registerOnce(layer: MapLayer) {
    const idx = this.layers.findIndex(l => l.id === layer.id);
    if (idx !== -1) {
      // replace existing instance (so latest constructor deps are used)
      this.layers[idx] = layer;
      this.rebuildGroups();
      return;
    }
    this.layers.push(layer);
    this.rebuildGroups();
  }

  replaceLayer(layer: MapLayer, map?: L.Map) {
    const idx = this.layers.findIndex((l) => l.id === layer.id);
    if (idx !== -1) {
      const prev = this.layers[idx];
      if (map) {
        try {
          prev.removeFrom(map);
        } catch (e) {
          console.error(`Layer replace remove failed: ${prev.id}`, e);
        }
      }
      this.layers[idx] = layer;
    } else {
      this.layers.push(layer);
    }

    this.rebuildGroups();

    if (map && layer.visible) {
      try {
        layer.addTo(map);
        layer.loadForMap(map);
      } catch (e) {
        console.error(`Layer replace add/load failed: ${layer.id}`, e);
      }
    }
  }

  // ✅ call this when you want a fresh start (optional)
  clear() {
    this.layers = [];
    this.groupedLayers = [];
  }

  addAll(map: L.Map) {
    if (!map) return;

    // ✅ ensure Leaflet is ready before adding vector layers
    map.whenReady(() => {
      this.layers.forEach(layer => {
        try {
          layer.addTo(map);
        } catch (e) {
          console.error(`Layer addTo failed: ${layer.id}`, e);
        }
      });
    });
  }

  removeAll(map: L.Map) {
    if (!map) return;
    this.layers.forEach(layer => {
      try {
        layer.removeFrom(map);
      } catch (e) {
        console.error(`Layer removeFrom failed: ${layer.id}`, e);
      }
    });
  }

  reloadAll(map: L.Map) {
    if (!map) return;

    // ✅ wait for renderer/panes to exist
    map.whenReady(() => {
      this.loadLayersSmoothly(map, this.layers, 'loadForMap');
    });
  }

  getLayers(): MapLayer[] {
    return this.layers;
  }

  setActiveDepartmentLabel(label: string) {
    this.activeDepartmentLabel = label?.trim() || 'Department Layers';
    this.rebuildGroups();
  }

  getGroupedLayers(): LayerGroupView[] {
    return this.groupedLayers;
  }

  private rebuildGroups() {
    const commonLayers = this.layers.filter((layer) => layer.layerGroup === 'common');
    const departmentLayers = this.layers.filter((layer) => layer.layerGroup !== 'common');
    const groups: LayerGroupView[] = [];

    if (commonLayers.length) {
      groups.push({
        key: 'common',
        title: 'Common Layers',
        layers: commonLayers,
      });
    }

    if (departmentLayers.length) {
      groups.push({
        key: 'department',
        title: this.activeDepartmentLabel,
        layers: departmentLayers,
      });
    }

    this.groupedLayers = groups;
  }

  // Show / hide layers based on `visible` flag
  applyVisibility(map: L.Map) {
    if (!map) return;

    map.whenReady(() => {
      this.layers.forEach(layer => {
        try {
          if (layer.visible) layer.addTo(map);
          else layer.removeFrom(map);
        } catch (e) {
          console.error(`Layer applyVisibility failed: ${layer.id}`, e);
        }
      });
    });
  }

  // Reload ONLY visible layers (called on map move)
  reloadVisible(map: L.Map) {
    if (!map) return;

    map.whenReady(() => {
      this.loadLayersSmoothly(map, this.layers.filter((layer) => layer.visible), 'reloadVisible');
    });
  }

  private loadLayersSmoothly(map: L.Map, layers: MapLayer[], label: string) {
    if (this.loadFrame !== null) {
      cancelAnimationFrame(this.loadFrame);
      this.loadFrame = null;
    }

    const priorityIds = new Set(['division_buffer', 'tracks', 'stations', 'landboundary', 'landplan_ontrack', 'land_offset', 'land_boundary']);
    const priorityLayers = layers.filter((layer) => priorityIds.has(layer.id));
    const deferredLayers = layers.filter((layer) => !priorityLayers.includes(layer));

    priorityLayers.forEach((layer) => {
      try {
        layer.loadForMap(map);
      } catch (e) {
        console.error(`Layer ${label} failed: ${layer.id}`, e);
      }
    });

    let index = 0;
    const layersPerFrame = label === 'loadForMap' ? 6 : 4;
    const runNext = () => {
      this.loadFrame = null;
      if (!map || index >= deferredLayers.length) return;

      for (let i = 0; i < layersPerFrame && index < deferredLayers.length; i++) {
        const layer = deferredLayers[index++];
        try {
          layer.loadForMap(map);
        } catch (e) {
          console.error(`Layer ${label} failed: ${layer.id}`, e);
        }
      }

      if (index < deferredLayers.length) {
        this.loadFrame = requestAnimationFrame(runNext);
      }
    };

    if (deferredLayers.length) {
      this.loadFrame = requestAnimationFrame(runNext);
    }
  }

  // add these methods at bottom of LayerManager class

findById(id: string): MapLayer | undefined {
  return this.layers.find(l => l.id === id);
}

setVisible(id: string, visible: boolean, map?: L.Map) {
  const layer = this.findById(id);
  if (!layer) return;

  if (layer.visible === visible) return;
  layer.visible = visible;

  if (!map) return;

  if (visible) {
    layer.addTo(map);
    // also load if needed
    try { layer.loadForMap(map); } catch {}
  } else {
    layer.removeFrom(map);
  }
}

}

