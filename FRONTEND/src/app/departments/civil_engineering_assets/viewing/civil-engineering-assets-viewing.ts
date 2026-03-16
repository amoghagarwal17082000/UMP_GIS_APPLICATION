import { GeoJsonObject } from 'geojson';
import * as L from 'leaflet';
import 'leaflet-polylinedecorator';
import { NgZone } from '@angular/core';
import { Api } from '../../../api/api';
import { circleMarkerOptionsFromLegend, defineLegend, MapLayer, pathStyleFromLegend } from '../../../services/interface';

const STATION_LEGEND = defineLegend({
  type: 'point' as const,
  color: '#d32f2f',
  label: 'Railway Station',
  fillColor: '#d32f2f',
  fillOpacity: 0.9,
  strokeColor: '#ffffff',
  strokeWidth: 1,
  radius: 6,
});

const LANDPLAN_ONTRACK_LEGEND = defineLegend({
  type: 'polygon' as const,
  color: '#FFA500',
  label: 'Landplan Ontrack',
  fillColor: '#FFA500',
  fillOpacity: 0.15,
  strokeColor: '#FFA500',
  strokeWidth: 3,
});

const LAND_OFFSET_LEGEND = defineLegend({
  type: 'line' as const,
  color: '#000000',
  label: 'Land Offset',
  strokeColor: '#000000',
  strokeWidth: 2,
});

const LAND_BOUNDARY_LEGEND = defineLegend({
  type: 'line' as const,
  color: 'orange',
  label: 'Land Boundary',
  strokeColor: 'orange',
  strokeWidth: 3,
});

export class StationViewingLayer implements MapLayer {
  id = 'stations';
  title = 'Stations';
  visible = true;
  layerGroup = 'department' as const;

  protected readonly LABEL_ZOOM = 12;

  legend = STATION_LEGEND;

  protected layer: L.GeoJSON;
  private lastBbox = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private onMoveStartHandler?: () => void;
  private onMoveEndHandler?: () => void;
  private requestSeq = 0;

  constructor(
    protected api: Api,
    protected zone: NgZone,
    protected onData?: (geojson: any) => void
  ) {
    this.layer = L.geoJSON(null, {
      pointToLayer: (feature: any, latlng: L.LatLng) => {
        const marker = L.circleMarker(latlng, circleMarkerOptionsFromLegend(this.legend));

        const p = feature?.properties || {};
        const name = (p.sttnname || '').toString().trim();
        this.onMarkerCreated(feature, marker as any);

        if (name) {
          marker.bindTooltip(name, {
            permanent: false,
            direction: 'top',
            offset: L.point(0, -8),
            opacity: 0.95,
            className: 'station-label',
          });
        }

        return marker;
      },
      onEachFeature: (feature: any, layer: any) => {
        const p: any = feature.properties || {};
        layer.bindPopup(`
          <b>${p.sttnname || 'Station'}</b><br>
          Code: ${p.sttncode || '-'}
        `);
        this.onFeatureReady(feature, layer);
      },
    });
  }

  protected onMarkerCreated(_feature: any, _marker: L.Marker) {}

  protected onFeatureReady(_feature: any, _layer: any) {}

  addTo(map: L.Map) {
    if (this.visible && !this.isOnMap) {
      this.layer.addTo(map);
      this.isOnMap = true;

      if (!this.onZoomEndHandler) {
        this.onZoomEndHandler = () => this.updateLabels(map);
      }
      if (!this.onMoveStartHandler) {
        this.onMoveStartHandler = () => this.closeLabels();
      }
      if (!this.onMoveEndHandler) {
        this.onMoveEndHandler = () => this.updateLabels(map);
      }
      map.on('zoomend', this.onZoomEndHandler);
      map.on('zoomstart', this.onMoveStartHandler);
      map.on('movestart', this.onMoveStartHandler);
      map.on('moveend', this.onMoveEndHandler);
      this.updateLabels(map);
    }
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
    }
    if (this.onMoveStartHandler) {
      map.off('zoomstart', this.onMoveStartHandler);
      map.off('movestart', this.onMoveStartHandler);
    }
    if (this.onMoveEndHandler) {
      map.off('moveend', this.onMoveEndHandler);
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.isOnMap = false;
  }

  protected closeLabels() {
    this.layer.eachLayer((l: any) => {
      if (l.getTooltip?.()) l.closeTooltip();
    });
  }

  protected updateLabels(map: L.Map) {
    const show = map.getZoom() >= this.LABEL_ZOOM;
    this.layer.eachLayer((l: any) => {
      const tooltip = l.getTooltip?.();
      if (!tooltip) return;
      show ? l.openTooltip() : l.closeTooltip();
    });
  }

  protected beforeRender(_geojson: any) {}

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    this.addTo(map);

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;

    if (bbox === this.lastBbox) return;
    this.lastBbox = bbox;
    const requestId = ++this.requestSeq;

    this.api.getStations(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.zone.run(() => {
          this.beforeRender(geojson);
          this.layer.clearLayers();
          this.layer.addData(geojson);
          this.onData?.(geojson);
          this.updateLabels(map);
        });
      },
      error: (err: any) => console.error('Station layer error', err),
    });
  }
}

export class LandPlanOntrackViewingLayer implements MapLayer {
  id = 'landplan_ontrack';
  title = 'Landplan Ontrack';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = 10;

  legend = LANDPLAN_ONTRACK_LEGEND;

  protected layer: L.GeoJSON;
  private lastKey = '';
  private paneReady = false;

  private onZoomEndHandler?: () => void;
  private requestSeq = 0;

  constructor(protected api: Api, protected onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      interactive: this.isInteractive(),
      onEachFeature: (feature: any, layer: any) => {
        this.onFeatureReady(feature, layer);
      },
    });
  }

  protected isInteractive(): boolean {
    return false;
  }

  protected panePointerEvents(): string {
    return 'none';
  }

  protected onFeatureReady(_feature: any, _layer: any): void {}

  private canShow(map: L.Map) {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map) {
    const paneName = 'LandPlanOntrackPane';

    if (!this.paneReady) {
      if (!map.getPane(paneName)) {
        map.createPane(paneName);
      }
      const pane = map.getPane(paneName)!;
      pane.style.zIndex = '450';
      pane.style.pointerEvents = this.panePointerEvents();

      this.paneReady = true;
    }

    this.onZoomEndHandler = () => this.syncVisibility(map);
    map.on('zoomend', this.onZoomEndHandler);
    this.syncVisibility(map);
  }

  private syncVisibility(map: L.Map) {
    const shouldShow = this.canShow(map);

    if (shouldShow) {
      if (!map.hasLayer(this.layer)) this.layer.addTo(map);
      this.layer.bringToFront();
      this.loadForMap(map);
    } else {
      if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
      this.lastKey = '';
    }
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) map.off('zoomend', this.onZoomEndHandler);

    this.onZoomEndHandler = undefined;

    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    const zActual = map.getZoom();
    const zForQuery = Math.max(zActual, this.minZoom);

    const b = map.getBounds();
    const bboxKey = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
    const key = `${zForQuery}|${bboxKey}`;

    if (key === this.lastKey) return;
    this.lastKey = key;
    const requestId = ++this.requestSeq;

    this.api.getLandPlanOntrack(zForQuery).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        if (!geojson || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
          console.error('LandPlanOntrack invalid GeoJSON returned:', geojson);
          return;
        }

        const fc =
          geojson.type === 'Feature'
            ? { type: 'FeatureCollection', features: [geojson] }
            : geojson;

        fc.features = (fc.features ?? []).map((f: any) => ({
          ...f,
          properties: f?.properties ?? f?.attributes ?? {},
        }));

        this.onData?.(fc);

        if (zActual < this.minZoom) {
          this.layer.clearLayers();
          return;
        }

        this.layer.clearLayers();
        this.layer.addData(fc);
        this.layer.bringToFront();
      },
      error: (err: any) => {
        console.error('LandPlanOntrack API error', err);
      },
    });
  }
}

export class LandOffsetLayer implements MapLayer {
  id = 'land_offset';
  title = 'Land Offset';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = 11;

  legend = LAND_OFFSET_LEGEND;

  private layer: L.GeoJSON;
  private decorators: L.LayerGroup;
  private lastKey = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private onInteractionStartHandler?: () => void;
  private requestSeq = 0;
  private readonly DECORATOR_ZOOM = 13;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.decorators = L.layerGroup();

    this.layer = L.geoJSON(null, {
      style: () => pathStyleFromLegend(this.legend),
      interactive: false,
    });
  }

  private canShow(map: L.Map): boolean {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map) {
    if (!this.onZoomEndHandler) {
      this.onZoomEndHandler = () => this.syncVisibility(map);
    }

    if (!this.isOnMap) {
      map.on('zoomend', this.onZoomEndHandler);
      if (!this.onInteractionStartHandler) {
        this.onInteractionStartHandler = () => {
          if (map.hasLayer(this.decorators)) map.removeLayer(this.decorators);
        };
      }
      map.on('zoomstart', this.onInteractionStartHandler);
      map.on('movestart', this.onInteractionStartHandler);
      this.isOnMap = true;
    }

    this.syncVisibility(map);
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
    }
    if (this.onInteractionStartHandler) {
      map.off('zoomstart', this.onInteractionStartHandler);
      map.off('movestart', this.onInteractionStartHandler);
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    if (map.hasLayer(this.decorators)) map.removeLayer(this.decorators);
    this.layer.clearLayers();
    this.decorators.clearLayers();
    this.lastKey = '';
    this.isOnMap = false;
  }

  private syncVisibility(map: L.Map) {
    if (this.canShow(map)) {
      if (!map.hasLayer(this.layer)) this.layer.addTo(map);
      if (map.getZoom() >= this.DECORATOR_ZOOM) {
        if (!map.hasLayer(this.decorators)) this.decorators.addTo(map);
      } else if (map.hasLayer(this.decorators)) {
        map.removeLayer(this.decorators);
        this.decorators.clearLayers();
      }
      return;
    }

    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    if (map.hasLayer(this.decorators)) map.removeLayer(this.decorators);
    this.layer.clearLayers();
    this.decorators.clearLayers();
    this.lastKey = '';
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;
    if (!this.canShow(map)) {
      this.syncVisibility(map);
      return;
    }

    this.syncVisibility(map);

    const b = map.getBounds();
    const z = map.getZoom();
    const bbox = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;

    const key = `${bbox}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const requestId = ++this.requestSeq;

    this.api.getLandOffset(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        if (!geojson) return;

        const fc =
          geojson.type === 'Feature'
            ? { type: 'FeatureCollection', features: [geojson] }
            : geojson;

        fc.features = (fc.features ?? []).map((f: any) => ({
          ...f,
          properties: f?.properties ?? f?.attributes ?? {},
        }));

        this.onData?.(fc);

        if (z < this.minZoom) {
          this.layer.clearLayers();
          this.decorators.clearLayers();
          return;
        }

        this.layer.clearLayers();
        this.decorators.clearLayers();
        this.layer.addData(fc);

        if (z < this.DECORATOR_ZOOM) {
          return;
        }

        this.layer.eachLayer((lyr: any) => {
          if (!(lyr instanceof L.Polyline) || lyr instanceof L.Polygon) return;

          const decorator = (L as any).polylineDecorator(lyr, {
            patterns: [
              {
                offset: '0%',
                repeat: 0,
                symbol: (L as any).Symbol.arrowHead({
                  pixelSize: 10,
                  polygon: true,
                  pathOptions: { color: this.legend.strokeColor || this.legend.color, fillColor: this.legend.strokeColor || this.legend.color, opacity: 1 },
                }),
              },
              {
                offset: '100%',
                repeat: 0,
                symbol: (L as any).Symbol.arrowHead({
                  pixelSize: 10,
                  polygon: true,
                  pathOptions: { color: this.legend.strokeColor || this.legend.color, fillColor: this.legend.strokeColor || this.legend.color, opacity: 1 },
                }),
              },
            ],
          });

          this.decorators.addLayer(decorator);
        });
      },
      error: (err: any) => console.error('Land Offset error', err),
    });
  }
}

export class LandBoundaryLayer implements MapLayer {
  id = 'landboundary';
  title = 'Land Boundary';
  visible = true;
  layerGroup = 'department' as const;

  minZoom = 10;

  legend = LAND_BOUNDARY_LEGEND;

  private layer!: L.GeoJSON;
  private lastBbox = '';
  private isOnMap = false;
  private onZoomEndHandler?: () => void;
  private requestSeq = 0;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.layer = L.geoJSON(null, {
      style: pathStyleFromLegend(this.legend),
    });
  }

  private canShow(map: L.Map) {
    return this.visible && map.getZoom() >= this.minZoom;
  }

  addTo(map: L.Map) {
    if (!this.onZoomEndHandler) {
      this.onZoomEndHandler = () => {
        if (this.canShow(map)) {
          if (!map.hasLayer(this.layer)) this.layer.addTo(map);
        } else if (map.hasLayer(this.layer)) {
          map.removeLayer(this.layer);
        }
      };
    }

    if (!this.isOnMap) {
      map.on('zoomend', this.onZoomEndHandler);
      this.isOnMap = true;
    }

    if (this.canShow(map)) {
      if (!map.hasLayer(this.layer)) this.layer.addTo(map);
    }
  }

  removeFrom(map: L.Map) {
    if (this.onZoomEndHandler) {
      map.off('zoomend', this.onZoomEndHandler);
    }
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.isOnMap = false;
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    const z = map.getZoom();
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;

    if (bbox === this.lastBbox) {
      if (z < this.minZoom) {
        this.layer.clearLayers();
      } else {
        if (!map.hasLayer(this.layer)) this.layer.addTo(map);
      }
      return;
    }
    this.lastBbox = bbox;
    const requestId = ++this.requestSeq;

    this.api.getlandboundary(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) return;
        this.onData?.(geojson);

        if (z < this.minZoom) {
          this.layer.clearLayers();
          return;
        }

        if (!map.hasLayer(this.layer)) this.layer.addTo(map);
        this.layer.clearLayers();
        this.layer.addData(geojson);
      },
      error: (err: any) => console.error('Land Boundary layer error', err),
    });
  }
}








