type PopupProperties = Record<string, any>;

const HIDDEN_KEYS = new Set([
  'shape',
  'geom',
  'geometry',
  'wkb_geometry',
]);

const PRIORITY_KEYS = [
  'asset_id',
  'assetid',
  'sttnname',
  'sttncode',
  'kmpostno',
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
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function orderedKeys(props: PopupProperties): string[] {
  const keys = Object.keys(props || {}).filter((key) => {
    const normalized = key.toLowerCase();
    return !HIDDEN_KEYS.has(normalized) && hasValue(props[key]);
  });

  const priority = PRIORITY_KEYS.filter((key) => keys.includes(key));
  const remaining = keys
    .filter((key) => !priority.includes(key))
    .sort((a, b) => a.localeCompare(b));

  return [...priority, ...remaining];
}

export function buildAssetPopupHtml(title: string, properties: PopupProperties, maxRows = 18): string {
  const props = properties || {};
  const rows = orderedKeys(props)
    .slice(0, maxRows)
    .map((key) => `
      <tr>
        <th style="padding:4px 10px 4px 0;text-align:left;vertical-align:top;color:#374151;font-weight:700;white-space:nowrap;">${escapeHtml(toLabel(key))}</th>
        <td style="padding:4px 0;vertical-align:top;color:#111827;">${escapeHtml(props[key])}</td>
      </tr>
    `)
    .join('');

  return `
    <div style="min-width:240px;max-width:360px;font-family:Segoe UI,Arial,sans-serif;">
      <div style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:800;">${escapeHtml(title || 'Asset Details')}</div>
      ${
        rows
          ? `<table style="border-collapse:collapse;width:100%;font-size:12px;line-height:1.35;">${rows}</table>`
          : '<div style="color:#6b7280;font-size:12px;">No details available</div>'
      }
    </div>
  `;
}
