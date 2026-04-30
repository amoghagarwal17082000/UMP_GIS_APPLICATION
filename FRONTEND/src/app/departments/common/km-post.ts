import * as L from 'leaflet';
import { Api } from '../../api/api';
import { defineLegend, MapLayer, pointLayerFromLegend } from '../../services/interface';

const KM_POST_PANE = 'KmPostPane';

const KM_POST_LEGEND = defineLegend({
  type: 'point' as const,
  color: '#2563eb',
  label: 'KM Post',
  fillColor: '#2563eb',
  fillOpacity: 0.95,
  strokeColor: '#1d4ed8',
  strokeWidth: 1,
  radius: 6,
  symbolKind: 'diamond' as const,
});

function ensureKmPostPane(map: L.Map): void {
  if (!map.getPane(KM_POST_PANE)) {
    map.createPane(KM_POST_PANE);
  }
  const pane = map.getPane(KM_POST_PANE)!;
  pane.style.zIndex = '450';
  pane.style.pointerEvents = 'none';
}


export class KmPostLayer implements MapLayer {
  id = 'km_posts';
  title = 'KM Posts';
  visible = true;
  layerGroup = 'common' as const;
  legend = KM_POST_LEGEND;

  private readonly MIN_ZOOM = 0;
  private readonly LABEL_ZOOM = 12;
  private layer: L.FeatureGroup;
  private lastBbox = '';
  private isLoading = false;
  private isOnMap = false;
  private requestSeq = 0;
  private onMoveStartHandler?: () => void;
  private onMoveEndHandler?: () => void;
  private labelUpdateTimer: any = null;

  constructor(private api: Api, private onData?: (geojson: any) => void) {
    this.layer = L.featureGroup();
  }

  private createKmPostMarker(feature: any, latlng: L.LatLng): L.Layer {
    const p = feature?.properties || {};
    const kmPostNo = (p.kmpostno ?? '').toString().trim();
    const radius = this.legend.radius ?? 4;
    const size = radius * 2;
    const fill = this.legend.fillColor || this.legend.color;
    const stroke = this.legend.strokeColor || this.legend.color;
    const marker = L.marker(latlng, {
      pane: KM_POST_PANE,
      keyboard: false,
      interactive: true,
      icon: L.divIcon({
        className: 'map-symbol-icon km-post-symbol-icon',
        html: '<div style="width:' + size + 'px;height:' + size + 'px;transform:rotate(45deg);background:' + fill + ';border:1px solid ' + stroke + ';border-radius:2px;box-sizing:border-box;"></div>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      }),
    }) as any;
    if (kmPostNo && marker.bindTooltip) {
      marker.bindTooltip(kmPostNo, {
        permanent: false,
        direction: 'top',
        offset: L.point(0, -8),
        opacity: 0.95,
        className: 'station-label',
      });
    }
    if (marker.bindPopup) {
      marker.bindPopup(
        '<b>KM Post</b><br>' +
        'KM: ' + (p.kmpostno ?? '-') + '<br>' +
        'Line: ' + (p.line ?? '-') + '<br>' +
        'Railway: ' + (p.railway ?? '-')
      );
    }
    return marker;
  }

  addTo(map: L.Map) {
    if (!this.visible) return;

    if (map.getZoom() >= this.MIN_ZOOM) {
      ensureKmPostPane(map);
      if (!this.isOnMap) {
        this.layer.addTo(map);
        this.isOnMap = true;
      }
      if (!this.onMoveStartHandler) {
        this.onMoveStartHandler = () => this.closeLabels();
      }
      if (!this.onMoveEndHandler) {
        this.onMoveEndHandler = () => this.scheduleLabelUpdate(map);
      }
      map.on('zoomstart', this.onMoveStartHandler);
      map.on('movestart', this.onMoveStartHandler);
      map.on('moveend', this.onMoveEndHandler);
      this.updateLabels(map);
    } else {
      this.removeFrom(map);
    }
  }

  removeFrom(map: L.Map) {
    if (this.onMoveStartHandler) {
      map.off('zoomstart', this.onMoveStartHandler);
      map.off('movestart', this.onMoveStartHandler);
    }
    if (this.onMoveEndHandler) map.off('moveend', this.onMoveEndHandler);
    this.onMoveStartHandler = undefined;
    this.onMoveEndHandler = undefined;
    if (this.labelUpdateTimer) clearTimeout(this.labelUpdateTimer);
    this.labelUpdateTimer = null;
    if (map.hasLayer(this.layer)) map.removeLayer(this.layer);
    this.isOnMap = false;
  }

  private closeLabels() {
    this.layer.eachLayer((l: any) => {
      if (l.getTooltip?.()) l.closeTooltip();
    });
  }

  private scheduleLabelUpdate(map: L.Map) {
    if (this.labelUpdateTimer) clearTimeout(this.labelUpdateTimer);
    this.labelUpdateTimer = setTimeout(() => this.updateLabels(map), 180);
  }

  private updateLabels(map: L.Map) {
    const show = map.getZoom() >= this.LABEL_ZOOM;
    const bounds = map.getBounds();
    const occupied: Array<{ x: number; y: number }> = [];
    const minDistancePx = 54;
    let shownCount = 0;
    const maxLabels = 120;
    this.layer.eachLayer((l: any) => {
      const tooltip = l.getTooltip?.();
      if (!tooltip || !l.getLatLng) return;
      if (!show) { l.closeTooltip(); return; }
      const latlng = l.getLatLng();
      if (!bounds.contains(latlng)) { l.closeTooltip(); return; }
      const p = map.latLngToContainerPoint(latlng);
      const tooClose = occupied.some((q) => {
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        return (dx * dx + dy * dy) < (minDistancePx * minDistancePx);
      });
      if (tooClose || shownCount >= maxLabels) { l.closeTooltip(); return; }
      occupied.push({ x: p.x, y: p.y });
      shownCount++;
      l.openTooltip();
    });
  }

  loadForMap(map: L.Map) {
    if (!this.visible) return;

    const z = map.getZoom();
    const b = map.getBounds();
    const bbox = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;

    if (bbox === this.lastBbox || this.isLoading) {
      if (z < this.MIN_ZOOM) {
        this.layer.clearLayers();
      } else {
        this.addTo(map);
      }
      return;
    }

    this.lastBbox = bbox;
    this.isLoading = true;
    const requestId = ++this.requestSeq;

    this.api.getkmposts(bbox).subscribe({
      next: (geojson: any) => {
        if (requestId !== this.requestSeq) {
          this.isLoading = false;
          return;
        }
        this.onData?.(geojson);

        if (z < this.MIN_ZOOM) {
          this.layer.clearLayers();
          this.isLoading = false;
          return;
        }

        this.addTo(map);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        this.layer.clearLayers();
        features.forEach((feature: any) => {
          const coords = feature?.geometry?.coordinates || [];
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          this.layer.addLayer(this.createKmPostMarker(feature, L.latLng(lat, lng)));
        });

        this.scheduleLabelUpdate(map);
        this.isLoading = false;
      },
      error: (err: any) => {
        console.error('KM post layer error', err);
        this.isLoading = false;
      },
    });
  }
}






