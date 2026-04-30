import * as L from 'leaflet';
import { BASE_URL, getDivision } from '../../api/shared/api-utils';
import { getAccessToken } from '../../services/current-user.store';

type PopupProperties = Record<string, any>;
type PopupEntry = {
  layer: any;
  layerTitle: string;
  layerKey?: string;
  properties: PopupProperties;
};

type PopupBindOptions = {
  layerKey?: string;
};

const popupEntries: PopupEntry[] = [];
const layerEntries = new WeakMap<object, PopupEntry>();
const NEARBY_PIXEL_TOLERANCE = 28;
const POPUP_GAP_PX = 8;
const SYMBOL_CLEARANCE_PX = 12;
const POPUP_VIEW_PADDING_PX = 18;
const ASSET_HIGHLIGHT_PANE = 'AssetPopupHighlightPane';
const POPUP_CONTROL_STOP_EVENTS = 'click dblclick mousedown mouseup pointerdown pointerup contextmenu';
let highlightedElement: Element | null = null;
let highlightLayer: L.Layer | null = null;
let activeAssetPopup: L.Popup | null = null;

const HIDDEN_KEYS = new Set([
  'shape',
  'geom',
  'geometry',
  'wkb_geometry',
  'the_geom',
  'fid',
  'objectid',
  'gid',
  'xcoord',
  'ycoord',
  'globalid',
  'makerdet',
  'checkerdet',
  'approverdet',
  'obj_old',
  'objold',
  'remark',
  'remarks',
  'modified_by',
  'modifiedby',
  'modified_date',
  'modifieddate',
  'mapped_flag',
  'mappedflag',
]);

const PRIORITY_KEYS = [
  'kmpostno',
  'asset_id',
  'assetid',
  'sttnname',
  'sttncode',
  'bridgeno',
  'rorno',
  'line',
  'railway',
  'division',
  'state',
  'district',
  'constituency',
  'constituncy',
  'status',
];

const TITLE_KEYS = [
  'asset_id',
  'assetid',
  'sttnname',
  'sttncode',
  'tmssection',
  'tms_section',
  'bridgeno',
  'rorno',
  'kmpostno',
  'name',
  'id',
];

const LAND_POPUP_FIELDS = [
  { label: 'Dist From KM', keys: ['distfromkm', 'distfrom_km', 'dist_from_km', 'fromkm', 'from_km'] },
  { label: 'Dist From M', keys: ['distfromm', 'distfrom_m', 'dist_from_m', 'fromm', 'from_m'] },
  { label: 'Dist To KM', keys: ['disttokm', 'distto_km', 'dist_to_km', 'tokm', 'to_km'] },
  { label: 'Dist To M', keys: ['disttom', 'distto_m', 'dist_to_m', 'tom', 'to_m'] },
  { label: 'State', keys: ['state', 'name_of_st', 'state_name'] },
  { label: 'District', keys: ['district', 'district_name', 'distname'] },
  { label: 'TMS Section', keys: ['tmssection', 'tms_section', 'section'] },
];

function escapeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toLabel(key: string): string {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasValue(value: any): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).trim() !== '';
}

function isDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(value);
}

function formatValue(value: any): string {
  if (!hasValue(value)) return '-';
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');

  const raw = String(value).trim();
  if (isDateLike(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('en-IN');
  }
  return raw;
}

function normalizeKey(key: string): string {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAssetIdField(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === 'assetid';
}

function isPopupLinkField(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === 'imageno'
    || normalized === 'imagenumber'
    || normalized === 'mapsheetno'
    || normalized === 'mapsheetnumber';
}

function isPopupImageField(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === 'imageno' || normalized === 'imagenumber';
}

function toPopupHref(value: string): string | null {
  const raw = value.trim();
  if (/^(https?:|mailto:|data:image\/)/i.test(raw)) return raw;
  if (/^\/(?!\/)/.test(raw) || /^assets\//i.test(raw)) return raw;
  return null;
}

function resolveAssetLayerKey(title: string, layerKey?: string): string | null {
  const direct = String(layerKey || '').trim();
  if (direct) return direct;

  const normalized = normalizeKey(title);
  const knownLayers: Record<string, string> = {
    bridgestart: 'bridge_start',
    bridgeend: 'bridge_end',
    bridgeminor: 'bridge_minor',
    roadoverbridge: 'road_over_bridge',
    roadunderbridge: 'road_under_bridge',
    footoverbridge: 'foot_over_bridge',
    railoverrail: 'rail_over_rail',
    switchexpansionjoint: 'switch_expansion_joint',
    bufferrails: 'buffer_rails',
    curvestart: 'curve_start',
    curveend: 'curve_end',
    pointxing: 'pointxing',
    levelxing: 'levelxing',
    tunnelstart: 'tunnel_start',
    tunnelend: 'tunnel_end',
  };

  for (const [token, resolved] of Object.entries(knownLayers)) {
    if (normalized.includes(token)) return resolved;
  }
  return null;
}

function getObjectId(props: PopupProperties): number | null {
  const value = props?.['objectid'] ?? props?.['OBJECTID'] ?? props?.['gid'];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPopupValue(key: string, value: any, title = '', props: PopupProperties = {}, layerKey?: string): string {
  const formatted = formatValue(value);
  if (isAssetIdField(key) && formatted !== '-') {
    const resolvedLayerKey = resolveAssetLayerKey(title, layerKey);
    if (resolvedLayerKey) {
      return `<button type="button" class="asset-popup-link asset-popup-asset-id" data-asset-popup-action="asset-details" data-layer-key="${escapeHtml(resolvedLayerKey)}" data-asset-id="${escapeHtml(formatted)}" data-object-id="${escapeHtml(getObjectId(props) ?? '')}">${escapeHtml(formatted)}</button>`;
    }
  }

  if (!isPopupLinkField(key) || formatted === '-') return escapeHtml(formatted);

  const href = toPopupHref(formatted);
  if (!href) {
    return `<span class="asset-popup-link asset-popup-link-disabled">${escapeHtml(formatted)}</span>`;
  }

  return `<a class="asset-popup-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatted)}</a>`;
}

function splitImageValues(value: any): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitImageValues(item));
  return String(value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getImageSourceCandidates(value: string): string[] {
  const raw = value.trim();
  const href = toPopupHref(raw);
  const normalized = raw.replace(/^\/+/, '');
  const filename = normalized.split(/[\\/]/).pop() || normalized;
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(filename);

  if (href) {
    return uniqueValues([href]);
  }

  const candidates = [
    raw,
    `assets/images/${filename}`,
  ];

  if (!hasExtension) {
    candidates.push(
      `assets/images/${filename}.jpg`,
      `assets/images/${filename}.jpeg`,
      `assets/images/${filename}.png`,
      `assets/images/${filename}.webp`,
      `assets/images/${filename}.pdf`
    );
  }

  return uniqueValues(candidates);
}

function getUploadedLandPlanImages(props: PopupProperties): string[][] {
  const imageKeys = Object.keys(props || {}).filter(isPopupImageField);
  return imageKeys
    .flatMap((key) => splitImageValues(props[key]).map(getImageSourceCandidates))
    .filter((sources) => sources.length > 0);
}

function imageFallbackAttributes(sources: string[]): string {
  return `data-fallback-index="0" data-fallback-srcs="${escapeHtml(JSON.stringify(sources))}" onerror="this.dataset.fallbackIndex=String(Number(this.dataset.fallbackIndex||0)+1);const s=JSON.parse(this.dataset.fallbackSrcs||'[]');if(s[Number(this.dataset.fallbackIndex)]){this.src=s[Number(this.dataset.fallbackIndex)];}else{this.style.display='none';}"`;
}

function isPdfSource(src: string): boolean {
  return /\.pdf(?:[?#].*)?$/i.test(src);
}

function isIrGeoportalLandPlanSource(src: string): boolean {
  try {
    const url = new URL(src, window.location.origin);
    const host = url.hostname.toLowerCase();
    return (host === 'irgeoportal.gov.in' || host === 'www.irgeoportal.gov.in')
      && url.pathname.toLowerCase().startsWith('/offtrack/landplans/');
  } catch {
    return false;
  }
}

function toPreviewSource(src: string): string {
  try {
    const url = new URL(src, window.location.origin);
    if (isIrGeoportalLandPlanSource(url.toString())) {
      return `${BASE_URL}/api/common/view/preview/land-plan?url=${encodeURIComponent(url.toString())}`;
    }
  } catch {
    return src;
  }
  return src;
}

function focusPdfPageOne(src: string): string {
  const base = String(src || '').split('#')[0];
  return `${base}#page=1&view=FitH`;
}

function buildUploadedPlanPreview(sources: string[]): string {
  const pdfSource = sources.find(isPdfSource);
  const imageSources = sources.filter((src) => !isPdfSource(src));
  const primary = pdfSource || imageSources[0] || sources[0];
  const previewPrimary = toPreviewSource(primary);

  if (pdfSource) {
    return `
      <div class="asset-popup-plan-link">
        <iframe class="asset-popup-plan-pdf" src="${escapeHtml(focusPdfPageOne(previewPrimary))}" title="Uploaded Land Plan PDF"></iframe>
        <a class="asset-popup-plan-open" href="${escapeHtml(primary)}" target="_blank" rel="noopener noreferrer">Open Land Plan</a>
      </div>
    `;
  }

  const previewImageSources = (imageSources.length ? imageSources : sources).map(toPreviewSource);
  return `
    <a class="asset-popup-plan-link" href="${escapeHtml(primary)}" target="_blank" rel="noopener noreferrer">
      <img class="asset-popup-plan-image" src="${escapeHtml(previewPrimary)}" alt="Uploaded Land Plan" ${imageFallbackAttributes(previewImageSources)}>
    </a>
  `;
}

function isFocusedLandPopup(title: string): boolean {
  const normalized = normalizeKey(title);
  return normalized.includes('landplan')
    || normalized.includes('landparcel')
    || normalized.includes('landplot')
    || normalized.includes('landboundary');
}

function isLandPlanUploadPopup(title: string): boolean {
  const normalized = normalizeKey(title);
  return normalized.includes('landplan')
    || normalized.includes('landparcel')
    || normalized.includes('landplot');
}

function isLandPlanOntrackPopup(title: string, layerKey?: string): boolean {
  const normalizedTitle = normalizeKey(title);
  const normalizedLayerKey = normalizeKey(layerKey || '');
  return normalizedLayerKey === 'landplanontrack'
    || normalizedTitle.includes('landplanontrack');
}

function findPropKey(props: PopupProperties, candidates: string[]): string | null {
  const keyByNormalized = new Map(Object.keys(props || {}).map((key) => [normalizeKey(key), key]));
  for (const candidate of candidates) {
    const key = keyByNormalized.get(normalizeKey(candidate));
    if (key) return key;
  }
  return null;
}

function fieldSortBucket(key: string): number {
  return isPopupLinkField(key) ? 2 : 1;
}

function orderedLandPopupKeys(props: PopupProperties, visibleKeys: string[]): string[] {
  const landKeys = LAND_POPUP_FIELDS.map((field) => findPropKey(props, field.keys) || field.keys[0]);
  const assetIdKeys = visibleKeys.filter(isAssetIdField);
  const remainingKeys = visibleKeys
    .filter((key) => !landKeys.some((landKey) => normalizeKey(landKey) === normalizeKey(key)))
    .filter((key) => !assetIdKeys.includes(key))
    .sort((a, b) => fieldSortBucket(a) - fieldSortBucket(b));

  return [...landKeys, ...remainingKeys, ...assetIdKeys];
}

function orderedKeys(props: PopupProperties, title = ''): string[] {
  const keys = Object.keys(props || {}).filter((key) => {
    const normalized = key.toLowerCase();
    if (isLandPlanOntrackPopup(title) && (normalized === 'mapsheetno' || normalized === 'mapsheetnumber')) return false;
    return !HIDDEN_KEYS.has(normalized) && hasValue(props[key]);
  });

  if (isFocusedLandPopup(title)) {
    return orderedLandPopupKeys(props, keys);
  }

  const assetIdKeys = keys.filter(isAssetIdField);
  const priority = PRIORITY_KEYS.filter((key) => keys.includes(key) && !assetIdKeys.includes(key));
  const remaining = keys
    .filter((key) => !priority.includes(key))
    .filter((key) => !assetIdKeys.includes(key))
    .sort((a, b) => {
      const bucketDiff = fieldSortBucket(a) - fieldSortBucket(b);
      return bucketDiff || a.localeCompare(b);
    });

  return [...priority, ...remaining, ...assetIdKeys];
}

function resolveFieldLabel(key: string, title: string): string {
  if (isFocusedLandPopup(title)) {
    const normalized = normalizeKey(key);
    const landField = LAND_POPUP_FIELDS.find((field) =>
      field.keys.some((candidate) => normalizeKey(candidate) === normalized)
    );
    if (landField) return landField.label;
  }
  return toLabel(key);
}

function resolveTitle(fallbackTitle: string, props: PopupProperties): string {
  const normalizedTitle = String(fallbackTitle || '').trim().toLowerCase();
  if (normalizedTitle.includes('railway track')) {
    for (const key of ['tmssection', 'tms_section']) {
      if (hasValue(props?.[key])) return `${toLabel(key)}: ${formatValue(props[key])}`;
    }
  }
  if (normalizedTitle.includes('km post') && hasValue(props?.['kmpostno'])) {
    return `${toLabel('kmpostno')}: ${formatValue(props['kmpostno'])}`;
  }
  for (const key of TITLE_KEYS) {
    if (hasValue(props?.[key])) {
      return `${toLabel(key)}: ${formatValue(props[key])}`;
    }
  }
  return fallbackTitle || 'Asset Details';
}

function getEntryTitle(entry: PopupEntry): string {
  return resolveTitle(entry.layerTitle, entry.properties);
}

function getEntryTypeLabel(entry: PopupEntry): string {
  return String(entry.layerTitle || '').trim() || getEntryTitle(entry);
}

function getSwitcherLabels(entries: PopupEntry[]): string[] {
  const typeCounts = entries.reduce((counts, entry) => {
    const label = getEntryTypeLabel(entry);
    counts.set(label, (counts.get(label) || 0) + 1);
    return counts;
  }, new Map<string, number>());

  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const label = getEntryTypeLabel(entry);
    const count = typeCounts.get(label) || 0;
    if (count <= 1) return label;

    const next = (seen.get(label) || 0) + 1;
    seen.set(label, next);
    return `${label} ${next}`;
  });
}

function clearAssetHighlight(): void {
  highlightedElement?.classList.remove('asset-popup-highlighted');
  highlightedElement = null;

  const map = (highlightLayer as any)?._map as L.Map | undefined;
  if (highlightLayer && map) {
    map.removeLayer(highlightLayer);
  }
  highlightLayer = null;
}

function getEntryLatLng(entry: PopupEntry): L.LatLng | null {
  try {
    if (entry.layer?.getLatLng) return entry.layer.getLatLng();
    if (entry.layer?.getBounds) {
      const bounds = entry.layer.getBounds();
      if (bounds?.isValid?.()) return bounds.getCenter();
    }
  } catch {
    return null;
  }
  return null;
}

function ensureAssetHighlightPane(map: L.Map): void {
  if (!map.getPane(ASSET_HIGHLIGHT_PANE)) {
    map.createPane(ASSET_HIGHLIGHT_PANE);
  }
  const pane = map.getPane(ASSET_HIGHLIGHT_PANE);
  if (!pane) return;
  pane.style.zIndex = '1200';
  pane.style.pointerEvents = 'none';
}

function createTargetRing(latLng: L.LatLng): L.LayerGroup {
  return L.layerGroup([
    L.circleMarker(latLng, {
      radius: 25,
      color: '#ffffff',
      weight: 8,
      opacity: 1,
      fillColor: '#ffffff',
      fillOpacity: 0.34,
      interactive: false,
      pane: ASSET_HIGHLIGHT_PANE,
    }),
    L.circleMarker(latLng, {
      radius: 17,
      color: '#7c3aed',
      weight: 5,
      opacity: 1,
      fillColor: '#a78bfa',
      fillOpacity: 0.48,
      interactive: false,
      pane: ASSET_HIGHLIGHT_PANE,
    }),
    L.circleMarker(latLng, {
      radius: 5,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillColor: '#7c3aed',
      fillOpacity: 1,
      interactive: false,
      pane: ASSET_HIGHLIGHT_PANE,
    }),
  ]);
}

function highlightPopupEntry(popup: L.Popup, entry: PopupEntry): void {
  const map = (popup as any)._map as L.Map | undefined;
  if (!map) return;

  clearAssetHighlight();
  ensureAssetHighlightPane(map);

  const element = entry.layer?.getElement?.();
  if (element?.classList) {
    element.classList.add('asset-popup-highlighted');
    highlightedElement = element;
  }

  const latLng = getEntryLatLng(entry) || popup.getLatLng?.();
  const geojson = entry.layer?.toGeoJSON?.();
  if (geojson) {
    const highlightGroup = L.featureGroup();
    const halo = L.geoJSON(geojson, {
      interactive: false,
      pane: ASSET_HIGHLIGHT_PANE,
      pointToLayer: (_feature, latLng) => L.circleMarker(latLng, {
        radius: 22,
        color: '#ffffff',
        weight: 7,
        opacity: 0.95,
        fillColor: '#ffffff',
        fillOpacity: 0.28,
        pane: ASSET_HIGHLIGHT_PANE,
      }),
      style: () => ({
        color: '#ffffff',
        weight: 9,
        opacity: 0.95,
        fillColor: '#ffffff',
        fillOpacity: 0.08,
        pane: ASSET_HIGHLIGHT_PANE,
      }),
    });
    const selected = L.geoJSON(geojson, {
      interactive: false,
      pane: ASSET_HIGHLIGHT_PANE,
      pointToLayer: (_feature, latLng) => L.circleMarker(latLng, {
        radius: 17,
        color: '#7c3aed',
        weight: 5,
        opacity: 1,
        fillColor: '#a78bfa',
        fillOpacity: 0.42,
        pane: ASSET_HIGHLIGHT_PANE,
      }),
      style: () => ({
        color: '#7c3aed',
        weight: 5,
        opacity: 1,
        fillColor: '#a78bfa',
        fillOpacity: 0.2,
        dashArray: '10 6',
        pane: ASSET_HIGHLIGHT_PANE,
      }),
    });

    highlightGroup.addLayer(halo);
    highlightGroup.addLayer(selected);
    if (latLng) {
      highlightGroup.addLayer(createTargetRing(latLng));
    }
    highlightLayer = highlightGroup.addTo(map);
    (highlightLayer as any).bringToFront?.();
    return;
  }

  if (!latLng) return;

  highlightLayer = createTargetRing(latLng).addTo(map);
  (highlightLayer as any).bringToFront?.();
}

export function buildAssetPopupHtml(
  title: string,
  properties: PopupProperties,
  options: { index?: number; total?: number; layerKey?: string; switcherLabels?: string[] } = {}
): string {
  const props = properties || {};
  const keys = orderedKeys(props, title);
  const popupTitle = resolveTitle(title, props);
  const total = options.total || 1;
  const index = options.index || 0;
  const switcherLabels = options.switcherLabels || [];
  const shellClass = isLandPlanUploadPopup(title) ? 'asset-popup-shell asset-popup-shell-wide' : 'asset-popup-shell';
  const uploadedPlanImages = getUploadedLandPlanImages(props);
  const uploadedPlanHtml = uploadedPlanImages.length
    ? `
      <div class="asset-popup-uploaded-plans">
        <div class="asset-popup-section-heading">Uploaded Land Plans</div>
        <div class="asset-popup-plan-list">
          ${uploadedPlanImages.map(buildUploadedPlanPreview).join('')}
        </div>
      </div>
    `
    : '';
  const rows = keys
    .map((key) => `
      <tr>
        <th class="asset-popup-field">${escapeHtml(resolveFieldLabel(key, title))}</th>
        <td class="asset-popup-value">${formatPopupValue(key, props[key], title, props, options.layerKey)}</td>
      </tr>
    `)
    .join('');

  return `
    <div class="${shellClass}">
      <div class="asset-popup-header">
        <div class="asset-popup-title">${escapeHtml(popupTitle)}</div>
        <div class="asset-popup-subtitle">
          <span>${escapeHtml(title || 'Layer')}</span>
          ${total > 1 ? `<span>${index + 1} of ${total}</span>` : ''}
        </div>
      </div>
      ${
        total > 1
          ? `
            <div class="asset-popup-switcher">
              <button type="button" class="asset-popup-nav" data-asset-popup-action="prev" title="Previous asset" aria-label="Previous asset"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
              <select class="asset-popup-select" data-asset-popup-action="select">
                ${Array.from({ length: total }, (_unused, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${escapeHtml(switcherLabels[i] || `Asset ${i + 1}`)}</option>`).join('')}
              </select>
              <button type="button" class="asset-popup-nav" data-asset-popup-action="next" title="Next asset" aria-label="Next asset"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
            </div>
          `
          : ''
      }
      <div class="asset-popup-actions">
        <button type="button" class="asset-popup-zoom" data-asset-popup-action="zoom"><i class="bi bi-crosshair" aria-hidden="true"></i><span>Zoom to</span></button>
      </div>
      <div class="asset-popup-scroll-body">
        <div class="asset-popup-original-details">
          <div class="asset-popup-section-heading">Original Asset Details</div>
          ${
            rows
              ? `<div class="asset-popup-table-wrap"><table class="asset-popup-table">${rows}</table></div>`
              : '<div class="asset-popup-empty">No details available</div>'
          }
        </div>
        <div class="asset-popup-asset-details" data-asset-popup-details hidden></div>
        ${uploadedPlanHtml}
      </div>
      <div class="asset-popup-count">${keys.length} field${keys.length === 1 ? '' : 's'}</div>
    </div>
  `;
}

function detailRowsFromApiRow(row: any): Array<[string, any]> {
  const normalizedEntries = Object.entries(row || {}).filter(([key, value]) => key !== 'raw' && hasValue(value));
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : null;
  const normalizedKeys = new Set(normalizedEntries.map(([key]) => normalizeKey(key)));
  const rawEntries = raw
    ? Object.entries(raw).filter(([key, value]) => hasValue(value) && !normalizedKeys.has(normalizeKey(key)))
    : [];
  return [...normalizedEntries, ...rawEntries];
}

function renderAssetDetails(row: any): string {
  const rows = detailRowsFromApiRow(row);
  if (!rows.length) return '<div class="asset-popup-asset-detail-empty">No API details returned</div>';

  return `
    <div class="asset-popup-section-heading">Asset Details from API</div>
    <div class="asset-popup-table-wrap asset-popup-asset-detail-wrap">
      <table class="asset-popup-table">
        ${rows.map(([key, value]) => `
          <tr>
            <th class="asset-popup-field">${escapeHtml(toLabel(key))}</th>
            <td class="asset-popup-value">${escapeHtml(formatValue(value))}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
}

async function loadAssetIdDetails(layerKey: string, assetId: string, objectId: string): Promise<any> {
  const token = getAccessToken();
  const division = getDivision();
  const params = new URLSearchParams();
  if (division) params.set('division', division);

  const response = await fetch(
    `${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layerKey)}/asset-id/validate?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        asset_id: assetId,
        objectid: Number.isFinite(Number(objectId)) ? Number(objectId) : null,
      }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Asset details failed (${response.status})`);
  }
  return payload?.row || payload;
}

function panPopupIntoView(popup: L.Popup): void {
  requestAnimationFrame(() => {
    const element = popup.getElement();
    const map = (popup as any)._map as L.Map | undefined;
    if (!element || !map) return;

    const mapContainer = map.getContainer();
    const popupBounds = element.getBoundingClientRect();
    const mapBounds = mapContainer.getBoundingClientRect();
    const padding = POPUP_VIEW_PADDING_PX;
    let dx = 0;
    let dy = 0;

    if (popupBounds.left < mapBounds.left + padding) {
      dx = popupBounds.left - mapBounds.left - padding;
    } else if (popupBounds.right > mapBounds.right - padding) {
      dx = popupBounds.right - mapBounds.right + padding;
    }

    if (popupBounds.top < mapBounds.top + padding) {
      dy = popupBounds.top - mapBounds.top - padding;
    } else if (popupBounds.bottom > mapBounds.bottom - padding) {
      dy = popupBounds.bottom - mapBounds.bottom + padding;
    }

    if (dx || dy) {
      map.panBy([dx, dy], { animate: true, duration: 0.18 });
    }
  });
}

function schedulePopupPanIntoView(popup: L.Popup): void {
  [0, 80, 240, 600, 1100].forEach((delay) => {
    window.setTimeout(() => panPopupIntoView(popup), delay);
  });
}

function isEditToolFormOpen(): boolean {
  return !!document.querySelector('#panelEdit .edit-form');
}

function positionPopupSmartly(popup: L.Popup, panIntoView = false): void {
  requestAnimationFrame(() => {
    const element = popup.getElement();
    const map = (popup as any)._map as L.Map | undefined;
    const anchor = popup.getLatLng?.();
    if (!element || !map || !anchor) return;

    const height = element.offsetHeight || 0;
    const width = element.offsetWidth || 360;
    const gap = POPUP_GAP_PX;
    const clearance = SYMBOL_CLEARANCE_PX;
    const edgePad = 28;
    const mapSize = map.getSize();
    const anchorPoint = map.latLngToContainerPoint(anchor);
    const spaceTop = anchorPoint.y;
    const spaceBottom = mapSize.y - anchorPoint.y;
    const spaceLeft = anchorPoint.x;
    const spaceRight = mapSize.x - anchorPoint.x;

    element.classList.remove('asset-popup-place-above', 'asset-popup-place-below', 'asset-popup-place-side');

    const baseTransform = (element.style.transform || '')
      .replace(/\s*translateX\([^)]*\)/g, '')
      .replace(/\s*translateY\([^)]*\)/g, '');

    let translateX = 0;
    let translateY = 0;
    let placement: 'above' | 'below' | 'side' = 'above';

    if (spaceBottom < height + gap + edgePad) {
      placement = 'above';
      translateY = -clearance;
    } else if (spaceTop < height + gap + edgePad) {
      placement = 'below';
      translateY = height + gap + clearance;
    } else {
      placement = 'side';
      translateX = spaceRight >= spaceLeft
        ? (width / 2) + gap + clearance
        : -((width / 2) + gap + clearance);
      translateY = height + gap + Math.round(clearance / 2);
    }

    element.classList.add(`asset-popup-place-${placement}`);
    element.style.transform = `${baseTransform} translateX(${translateX}px) translateY(${translateY}px)`;
    protectPopupElement(element);

    if (panIntoView && !isEditToolFormOpen()) {
      schedulePopupPanIntoView(popup);
    }
  });
}

function protectPopupElement(element: HTMLElement): void {
  if (element.dataset['assetPopupProtected'] === 'true') return;
  element.dataset['assetPopupProtected'] = 'true';

  L.DomEvent.disableClickPropagation(element);
  L.DomEvent.disableScrollPropagation(element);
  L.DomEvent.on(element, POPUP_CONTROL_STOP_EVENTS, L.DomEvent.stopPropagation);
}

function getLayerPoint(map: L.Map, layer: any, fallbackLatLng: L.LatLng): L.Point | null {
  try {
    if (layer?.getLatLng) return map.latLngToContainerPoint(layer.getLatLng());
    if (layer?.getBounds) {
      const bounds = layer.getBounds();
      if (bounds?.isValid?.()) {
        const boundsOnScreen = L.bounds(
          map.latLngToContainerPoint(bounds.getSouthWest()),
          map.latLngToContainerPoint(bounds.getNorthEast())
        );
        const clickPoint = map.latLngToContainerPoint(fallbackLatLng);
        if (boundsOnScreen.pad(0.05).contains(clickPoint)) return clickPoint;
        return boundsOnScreen.getCenter();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findNearbyEntries(map: L.Map, current: PopupEntry, anchor: L.LatLng): PopupEntry[] {
  const anchorPoint = map.latLngToContainerPoint(anchor);
  const candidates = popupEntries
    .map((entry) => {
      const point = getLayerPoint(map, entry.layer, anchor);
      if (!point) return null;
      const distance = point.distanceTo(anchorPoint);
      return { entry, distance };
    })
    .filter((item): item is { entry: PopupEntry; distance: number } => !!item && item.distance <= NEARBY_PIXEL_TOLERANCE)
    .sort((a, b) => a.distance - b.distance);

  const nearby = candidates.map((candidate) => candidate.entry);
  if (!nearby.includes(current)) nearby.unshift(current);
  return nearby;
}

function renderPopupEntry(popup: L.Popup, entries: PopupEntry[], index: number): void {
  const safeIndex = ((index % entries.length) + entries.length) % entries.length;
  const entry = entries[safeIndex];
  popup.setContent(buildAssetPopupHtml(entry.layerTitle, entry.properties, {
    index: safeIndex,
    total: entries.length,
    layerKey: entry.layerKey,
    switcherLabels: getSwitcherLabels(entries),
  }));
  highlightPopupEntry(popup, entry);
  wirePopupSwitcher(popup, entries, safeIndex);
  positionPopupSmartly(popup, isLandPlanOntrackPopup(entry.layerTitle, entry.layerKey));
}

function zoomToEntry(popup: L.Popup, entries: PopupEntry[], index: number): void {
  const map = (popup as any)._map as L.Map | undefined;
  if (!map) return;
  const entry = entries[index];

  highlightPopupEntry(popup, entry);
  keepPopupOpenAfterZoom(popup, entries, index);

  const layer = entry.layer;
  if (layer?.getBounds) {
    const bounds = layer.getBounds();
    if (bounds?.isValid?.()) {
      map.fitBounds(bounds.pad(0.25), { animate: false });
      return;
    }
  }

  if (layer?.getLatLng) {
    const latLng = layer.getLatLng();
    map.setView(latLng, Math.max(map.getZoom(), 17), { animate: false });
    return;
  }

  const anchor = popup.getLatLng?.();
  if (anchor) map.setView(anchor, Math.max(map.getZoom(), 17), { animate: false });
}

function keepPopupOpenAfterZoom(popup: L.Popup, entries: PopupEntry[], index: number): void {
  const map = (popup as any)._map as L.Map | undefined;
  const entry = entries[index];
  const latLng = getEntryLatLng(entry) || popup.getLatLng?.();
  if (!map || !latLng) return;

  const reopen = () => {
    popup.setLatLng(latLng);
    if (!map.hasLayer(popup as any)) {
      popup.openOn(map);
    }
    popup.setContent(buildAssetPopupHtml(entry.layerTitle, entry.properties, {
      index,
      total: entries.length,
      layerKey: entry.layerKey,
      switcherLabels: getSwitcherLabels(entries),
    }));
    highlightPopupEntry(popup, entry);
    wirePopupSwitcher(popup, entries, index);
    positionPopupSmartly(popup, isLandPlanOntrackPopup(entry.layerTitle, entry.layerKey));
  };

  map.once('zoomend moveend', reopen);
  [80, 240, 700, 1050, 1400, 1800].forEach((delay) => {
    window.setTimeout(reopen, delay);
  });
}

function wirePopupSwitcher(popup: L.Popup, entries: PopupEntry[], index: number): void {
  requestAnimationFrame(() => {
    const element = popup.getElement();
    if (!element) return;

    protectPopupElement(element);

    element.querySelectorAll<HTMLElement>('[data-asset-popup-action]').forEach((control) => {
      L.DomEvent.disableClickPropagation(control);
      L.DomEvent.disableScrollPropagation(control);
      L.DomEvent.on(control, POPUP_CONTROL_STOP_EVENTS, L.DomEvent.stopPropagation);
      const action = control.dataset['assetPopupAction'];
      if (action === 'prev') {
        control.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          renderPopupEntry(popup, entries, index - 1);
        }, { once: true });
      } else if (action === 'next') {
        control.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          renderPopupEntry(popup, entries, index + 1);
        }, { once: true });
      } else if (action === 'select') {
        control.addEventListener('change', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const value = Number((event.target as HTMLSelectElement).value);
          if (Number.isFinite(value)) renderPopupEntry(popup, entries, value);
        }, { once: true });
      } else if (action === 'zoom') {
        control.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          zoomToEntry(popup, entries, index);
        }, { once: true });
      } else if (action === 'asset-details') {
        control.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const details = element.querySelector<HTMLElement>('[data-asset-popup-details]');
          const button = control as HTMLButtonElement;
          if (!details || button.disabled) return;

          if (details.dataset['loaded'] === 'true' && !details.hidden) {
            details.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            positionPopupSmartly(popup);
            return;
          }

          if (details.dataset['loaded'] === 'true') {
            details.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            positionPopupSmartly(popup);
            return;
          }

          const layerKey = button.dataset['layerKey'] || '';
          const assetId = button.dataset['assetId'] || '';
          const objectId = button.dataset['objectId'] || '';

          details.hidden = false;
          details.innerHTML = '<div class="asset-popup-asset-detail-loading">Loading asset details...</div>';
          button.disabled = true;
          button.setAttribute('aria-expanded', 'true');
          positionPopupSmartly(popup);

          try {
            const row = await loadAssetIdDetails(layerKey, assetId, objectId);
            details.innerHTML = renderAssetDetails(row);
            details.dataset['loaded'] = 'true';
          } catch (err: any) {
            details.innerHTML = `<div class="asset-popup-asset-detail-error">${escapeHtml(err?.message || 'Asset details could not be loaded')}</div>`;
          } finally {
            button.disabled = false;
            positionPopupSmartly(popup);
          }
        });
      }
    });
  });
}

function registerPopupEntry(layer: any, title: string, properties: PopupProperties, options: PopupBindOptions = {}): PopupEntry {
  const existing = layerEntries.get(layer);
  if (existing) {
    existing.layerTitle = title;
    existing.layerKey = options.layerKey;
    existing.properties = properties;
    return existing;
  }

  const entry = { layer, layerTitle: title, layerKey: options.layerKey, properties };
  layerEntries.set(layer, entry);
  popupEntries.push(entry);
  layer.on?.('remove', () => {
    const index = popupEntries.indexOf(entry);
    if (index >= 0) popupEntries.splice(index, 1);
  });
  return entry;
}

export function bindAssetDetailsPopup(layer: any, title: string, properties: PopupProperties, options: PopupBindOptions = {}): void {
  if (!layer?.bindPopup) return;
  const entry = registerPopupEntry(layer, title, properties, options);

  layer.bindPopup(buildAssetPopupHtml(title, properties, { index: 0, total: 1, layerKey: options.layerKey }), {
    className: 'asset-below-popup',
    maxWidth: isLandPlanUploadPopup(title) ? 660 : 420,
    minWidth: isLandPlanUploadPopup(title) ? 460 : 300,
    offset: L.point(0, 0),
    closeOnClick: false,
    closeOnEscapeKey: false,
    autoClose: false,
    autoPan: false,
    keepInView: false,
  });

  layer.on?.('popupopen', (event: any) => {
    const popup = event?.popup || layer.getPopup?.();
    const map = popup?._map;
    const anchor = popup?.getLatLng?.();
    if (!popup || !map || !anchor) return;

    if (activeAssetPopup && activeAssetPopup !== popup) {
      try {
        activeAssetPopup.remove();
      } catch {
        map.closePopup(activeAssetPopup);
      }
    }
    activeAssetPopup = popup;

    const mapOptions = map.options as any;
    const previousClosePopupOnClick = mapOptions.closePopupOnClick;
    mapOptions.closePopupOnClick = false;
    popup.once?.('remove', () => {
      if (activeAssetPopup === popup) {
        activeAssetPopup = null;
      }
      mapOptions.closePopupOnClick = previousClosePopupOnClick;
      clearAssetHighlight();
    });

    const nearby = findNearbyEntries(map, entry, anchor);
    renderPopupEntry(popup, nearby, Math.max(0, nearby.indexOf(entry)));
  });
}
