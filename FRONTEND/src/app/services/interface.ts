import * as L from 'leaflet';

export type LegendSymbolKind =
  | 'auto'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'square'
  | 'ring'
  | 'ring-slash'
  | 'point-crossing'
  | 'level-crossing'
  | 'rob'
  | 'rub'
  | 'fob'
  | 'track'
  | 'line';

export interface LayerLegend {
  type: 'point' | 'line' | 'polygon';
  color: string;
  label: string;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  radius?: number;
  dashArray?: string;
  symbolKind?: LegendSymbolKind;
  symbolText?: string;
  textColor?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
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
    dashArray: legend.dashArray,
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

export function resolveLegendSymbolKind(legend: LayerLegend): LegendSymbolKind {
  if (legend.symbolKind && legend.symbolKind !== 'auto') return legend.symbolKind;
  if (legend.type === 'line') return 'line';
  if (legend.type === 'polygon') return 'square';
  return 'circle';
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pointLayerFromLegend(legend: LayerLegend, latlng: L.LatLng, paneName?: string): L.CircleMarker | L.Marker {
  if (legend.imageUrl) {
    const iconWidth = legend.imageWidth ?? 18;
    const iconHeight = legend.imageHeight ?? 18;
    return L.marker(latlng, {
      icon: L.divIcon({
        className: 'map-symbol-icon',
        html: '<img src="' + legend.imageUrl + '" style="display:block;width:' + iconWidth + 'px;height:' + iconHeight + 'px;object-fit:contain;" alt="' + escapeHtml(legend.label || 'symbol') + '">',
        iconSize: [iconWidth, iconHeight],
        iconAnchor: [iconWidth / 2, iconHeight / 2],
      }),
      keyboard: false,
      interactive: true,
      pane: paneName,
    });
  }

  const kind = resolveLegendSymbolKind(legend);
  const hasCustomShape = kind !== 'circle' || !!legend.symbolText;
  if (!hasCustomShape) {
    return L.circleMarker(latlng, { ...circleMarkerOptionsFromLegend(legend), pane: paneName });
  }

  const stroke = legend.strokeColor || legend.color;
  const fill = legend.fillColor || legend.color;
  const textColor = legend.textColor || stroke;
  const radius = legend.radius ?? 7;
  const size = radius * 2 + 4;
  const weight = legend.strokeWidth || 2;
  const fontSize = Math.max(9, Math.round(size * 0.5));
  const text = escapeHtml(legend.symbolText || '');
  const commonTextStyle = [
    'position:absolute',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%)',
    'line-height:1',
    'font-weight:800',
    'font-family:Arial,sans-serif',
    'text-transform:uppercase',
    'z-index:2',
    `color:${textColor}`,
    `font-size:${fontSize}px`
  ].join(';');

  let html = '';
  if (kind === 'diamond') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;transform:rotate(45deg);background:${fill};border:${weight}px solid ${stroke};border-radius:3px;box-sizing:border-box;">${text ? `<span style="${commonTextStyle};transform:translate(-50%,-50%) rotate(-45deg);">${text}</span>` : ''}</div>`;
  } else if (kind === 'triangle') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;clip-path:polygon(50% 0,0 100%,100% 100%);background:${fill};border:${weight}px solid ${stroke};box-sizing:border-box;">${text ? `<span style="${commonTextStyle};top:62%;">${text}</span>` : ''}</div>`;
  } else if (kind === 'point-crossing') {
    html = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/><rect x="7.8" y="7.8" width="4.4" height="4.4" fill="#ffffff" transform="rotate(45 10 10)"/><line x1="5.4" y1="14.6" x2="14.6" y2="5.4" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>`;
  } else if (kind === 'level-crossing') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;clip-path:polygon(50% 0,0 100%,100% 100%);background:${fill};border:${weight}px solid ${stroke};box-sizing:border-box;"><span style="position:absolute;left:50%;top:66%;width:${Math.round(size * 0.44)}px;height:${Math.round(size * 0.18)}px;background:${textColor};transform:translate(-50%,-50%);border-radius:1px;"></span><span style="position:absolute;left:50%;top:42%;width:${Math.max(2, weight)}px;height:${Math.round(size * 0.24)}px;background:${textColor};transform:translate(-50%,-50%);border-radius:1px;"></span></div>`;
  } else if (kind === 'ring') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:#ffffff;border:${weight}px solid ${stroke};box-sizing:border-box;">${text ? `<span style="${commonTextStyle}">${text}</span>` : ''}</div>`;
  } else if (kind === 'ring-slash') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:#ffffff;border:${weight}px solid ${stroke};box-sizing:border-box;"><span style="position:absolute;left:50%;top:50%;width:${Math.round(size * 0.8)}px;height:${Math.max(2, weight)}px;background:${stroke};transform:translate(-50%,-50%) rotate(-45deg);border-radius:999px;z-index:1;"></span>${text ? `<span style="${commonTextStyle}">${text}</span>` : ''}</div>`;
  } else if (kind === 'rob') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:${weight}px solid ${stroke};box-sizing:border-box;"><span style="position:absolute;left:50%;top:42%;width:${Math.round(size * 0.52)}px;height:${Math.max(2, weight)}px;background:${textColor};transform:translate(-50%,-50%);border-radius:999px;"></span><span style="position:absolute;left:38%;top:60%;width:${Math.max(2, weight)}px;height:${Math.round(size * 0.22)}px;background:${textColor};transform:translate(-50%,-50%);border-radius:999px;"></span><span style="position:absolute;left:62%;top:60%;width:${Math.max(2, weight)}px;height:${Math.round(size * 0.22)}px;background:${textColor};transform:translate(-50%,-50%);border-radius:999px;"></span></div>`;
  } else if (kind === 'rub') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:${weight}px solid ${stroke};box-sizing:border-box;"><span style="position:absolute;left:50%;top:50%;width:${Math.round(size * 0.64)}px;height:${Math.max(2, weight)}px;background:${textColor};transform:translate(-50%,-50%) rotate(45deg);border-radius:999px;"></span><span style="position:absolute;left:50%;top:50%;width:${Math.round(size * 0.64)}px;height:${Math.max(2, weight)}px;background:${textColor};transform:translate(-50%,-50%) rotate(-45deg);border-radius:999px;"></span></div>`;
  } else if (kind === 'fob') {
    html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:${weight}px solid ${stroke};box-sizing:border-box;">${text ? `<span style="${commonTextStyle}">${text}</span>` : `<span style="${commonTextStyle}">F</span>`}</div>`;
  } else {
    html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:${weight}px solid ${stroke};box-sizing:border-box;">${text ? `<span style="${commonTextStyle}">${text}</span>` : ''}</div>`;
  }

  return L.marker(latlng, {
    icon: L.divIcon({
      className: 'map-symbol-icon',
      html,
      iconSize: [size + 4, size + 4],
      iconAnchor: [(size + 4) / 2, (size + 4) / 2],
    }),
    keyboard: false,
    interactive: true,
    pane: paneName,
  });
}


export interface ClusteredPointLayerOptions {
  map: L.Map;
  features: any[];
  legend: LayerLegend;
  pointFactory: (feature: any, latlng: L.LatLng) => L.Layer;
  clusterRadiusPx?: number;
  disableClusteringZoom?: number;
  minClusterCount?: number;
}

function createClusterMarker(latlng: L.LatLng, count: number, legend: LayerLegend): L.Marker {
  const stroke = legend.strokeColor || legend.color;
  const fill = legend.fillColor || legend.color;
  const size = count >= 100 ? 40 : count >= 10 ? 34 : 30;
  const fontSize = count >= 100 ? 13 : 12;
  const html = '<div style="' +
    'width:' + size + 'px;' +
    'height:' + size + 'px;' +
    'border-radius:999px;' +
    'display:flex;' +
    'align-items:center;' +
    'justify-content:center;' +
    'background:' + fill + ';' +
    'border:2px solid ' + stroke + ';' +
    'color:#ffffff;' +
    'font-weight:800;' +
    'font-size:' + fontSize + 'px;' +
    'box-shadow:0 2px 6px rgba(0,0,0,0.24);' +
    '">' + count + '</div>';

  return L.marker(latlng, {
    icon: L.divIcon({
      className: 'map-cluster-icon',
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
    keyboard: false,
    interactive: true,
  });
}

export function buildClusteredPointLayers(options: ClusteredPointLayerOptions): L.Layer[] {
  const {
    map,
    features,
    legend,
    pointFactory,
    clusterRadiusPx = 48,
    disableClusteringZoom = 14,
    minClusterCount = 40,
  } = options;

  const validFeatures = (features || []).filter((feature) => {
    const type = String(feature?.geometry?.type || '').toLowerCase();
    return type === 'point';
  });

  if (!validFeatures.length) return [];

  const shouldCluster = validFeatures.length >= minClusterCount && map.getZoom() < disableClusteringZoom;
  if (!shouldCluster) {
    return validFeatures.map((feature) => {
      const coords = feature.geometry.coordinates || [];
      const latlng = L.latLng(Number(coords[1]), Number(coords[0]));
      return pointFactory(feature, latlng);
    });
  }

  const buckets = new Map();
  for (const feature of validFeatures) {
    const coords = feature.geometry.coordinates || [];
    const latlng = L.latLng(Number(coords[1]), Number(coords[0]));
    const point = map.project(latlng, map.getZoom());
    const key = Math.floor(point.x / clusterRadiusPx) + ':' + Math.floor(point.y / clusterRadiusPx);
    const existing = buckets.get(key);
    if (existing) {
      existing.features.push(feature);
      existing.lat += latlng.lat;
      existing.lng += latlng.lng;
      existing.bounds.extend(latlng);
    } else {
      buckets.set(key, {
        features: [feature],
        lat: latlng.lat,
        lng: latlng.lng,
        bounds: L.latLngBounds([latlng]),
      });
    }
  }

  const layers: L.Layer[] = [];
  buckets.forEach((bucket) => {
    if (bucket.features.length === 1) {
      const feature = bucket.features[0];
      const coords = feature.geometry.coordinates || [];
      const latlng = L.latLng(Number(coords[1]), Number(coords[0]));
      layers.push(pointFactory(feature, latlng));
      return;
    }

    const latlng = L.latLng(bucket.lat / bucket.features.length, bucket.lng / bucket.features.length);
    const marker = createClusterMarker(latlng, bucket.features.length, legend);
    marker.on('click', () => {
      map.fitBounds(bucket.bounds.pad(0.4));
    });
    marker.bindPopup('<b>' + bucket.features.length + '</b> features in this area');
    layers.push(marker);
  });

  return layers;
}

