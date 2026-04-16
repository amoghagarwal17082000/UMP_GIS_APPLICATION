export type EditLayerKey = string;

export type EditFieldType = 'text' | 'number';

export type EditFieldConfig = {
  key: string;
  label: string;
  type?: EditFieldType;
  required?: boolean;
  full?: boolean;
  validateButton?: boolean;
};

export type TableColumnConfig = {
  key: string;
  label: string;
  stationLink?: boolean;
};

export type LayerFormConfig = {
  id: EditLayerKey;
  label: string;
  formTitle?: string;
  note?: string;
  tableColumns: TableColumnConfig[];
  formFields: EditFieldConfig[];
};

const GENERIC_STATUS_COLUMNS: TableColumnConfig[] = [
  { key: 'objectid', label: 'Object ID' },
  { key: 'status', label: 'Status' },
  { key: 'modified_by', label: 'Modified By' },
];

const GENERIC_STATUS_FIELDS: EditFieldConfig[] = [
  { key: 'objectid', label: 'Object ID', full: true },
  { key: 'status', label: 'Current Status', full: true },
  { key: 'edited_by', label: 'Edited By', full: true },
  { key: 'edited_at', label: 'Edited At', full: true },
  { key: 'checked_by', label: 'Checked By', full: true },
  { key: 'checked_at', label: 'Checked At', full: true },
  { key: 'approved_by', label: 'Approved By', full: true },
  { key: 'approved_at', label: 'Approved At', full: true },
  { key: 'modified_by', label: 'Modified By', full: true },
];

function createGenericConfig(
  id: string,
  label: string,
  extraColumns: TableColumnConfig[] = [],
  extraFields: EditFieldConfig[] = []
): LayerFormConfig {
  return {
    id,
    label,
    note: '* This layer is now supported in the edit tool shell. Select a feature on the map to inspect it. Save workflow remains wired only where backend editing is available.',
    tableColumns: [...extraColumns, ...GENERIC_STATUS_COLUMNS],
    formFields: [...extraFields, ...GENERIC_STATUS_FIELDS],
  };
}

export const EDIT_LAYER_CONFIG: Record<string, LayerFormConfig> = {
  stations: {
    id: 'stations',
    label: 'Stations',
    note: '* For Station: All starred fields are mandatory | For Landplan: Polygon geometry required',
    tableColumns: [
      { key: 'sttncode', label: 'Station Code', stationLink: true },
      { key: 'sttnname', label: 'Station Name' },
      { key: 'distkm', label: 'Dist (km)' },
      { key: 'distm', label: 'Dist (m)' },
      { key: 'state', label: 'State' },
      { key: 'district', label: 'District' },
    ],
    formFields: [
      { key: 'sttncode', label: 'Station Code', required: true, full: true, validateButton: true },
      { key: 'sttnname', label: 'Station Name', required: true },
      { key: 'stationtype', label: 'Station Type', required: true },
      { key: 'distkm', label: 'Dist (KM)', type: 'number', required: true },
      { key: 'distm', label: 'Dist (M)', type: 'number', required: true },
      { key: 'state', label: 'State', required: true },
      { key: 'district', label: 'District', required: true },
      { key: 'category', label: 'Category', required: true },
      { key: 'constituency', label: 'Constituency', required: true, full: true },
      { key: 'status', label: 'Current Status', full: true },
    ],
  },
  landplan: {
    id: 'landplan',
    label: 'Land Plan On Track',
    note: '* Layer forms are configuration-driven. Station workflow is fully wired; other layers can now plug into the same form engine.',
    tableColumns: [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'distfromm', label: 'From M' },
      { key: 'disttokm', label: 'To KM' },
      { key: 'disttom', label: 'To M' },
      { key: 'status', label: 'Status' },
    ],
    formFields: [
      { key: 'distfromkm', label: 'From KM', type: 'number', required: true },
      { key: 'distfromm', label: 'From M', type: 'number', required: true },
      { key: 'disttokm', label: 'To KM', type: 'number', required: true },
      { key: 'disttom', label: 'To M', type: 'number', required: true },
      { key: 'railway', label: 'Railway' },
      { key: 'division', label: 'Division' },
      { key: 'status', label: 'Status', full: true },
    ],
  },
  km_post: createGenericConfig(
    'km_post',
    'Km Post',
    [
      { key: 'km', label: 'KM' },
      { key: 'km_post', label: 'KM Post' },
      { key: 'sttncode', label: 'Station Code' },
    ],
    [
      { key: 'km', label: 'KM' },
      { key: 'km_post', label: 'KM Post' },
      { key: 'sttncode', label: 'Station Code' },
      { key: 'sttnname', label: 'Station Name', full: true },
    ]
  ),
  landplan_ontrack: createGenericConfig(
    'landplan_ontrack',
    'Landplan Ontrack',
    [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'disttokm', label: 'To KM' },
      { key: 'distfromm', label: 'From M' },
      { key: 'disttom', label: 'To M' },
    ],
    [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'distfromm', label: 'From M' },
      { key: 'disttokm', label: 'To KM' },
      { key: 'disttom', label: 'To M' },
      { key: 'railway', label: 'Railway' },
      { key: 'division', label: 'Division' },
    ]
  ),
  landplan_offtrack: createGenericConfig(
    'landplan_offtrack',
    'Landplan Offtrack',
    [
      { key: 'state', label: 'State' },
      { key: 'district', label: 'District' },
      { key: 'agency_name', label: 'Agency' },
    ],
    [
      { key: 'state', label: 'State' },
      { key: 'district', label: 'District' },
      { key: 'agency_name', label: 'Agency Name' },
      { key: 'land_plot', label: 'Land Plot' },
    ]
  ),
  land_offset: createGenericConfig(
    'land_offset',
    'Land Offset',
    [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'disttokm', label: 'To KM' },
    ],
    [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'distfromm', label: 'From M' },
      { key: 'disttokm', label: 'To KM' },
      { key: 'disttom', label: 'To M' },
    ]
  ),
  land_boundary: createGenericConfig(
    'land_boundary',
    'Land Boundary',
    [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'disttokm', label: 'To KM' },
    ],
    [
      { key: 'distfromkm', label: 'From KM' },
      { key: 'distfromm', label: 'From M' },
      { key: 'disttokm', label: 'To KM' },
      { key: 'disttom', label: 'To M' },
    ]
  ),
  bridge_start: createGenericConfig('bridge_start', 'Bridge Start'),
  bridge_end: createGenericConfig('bridge_end', 'Bridge End'),
  bridge_minor: createGenericConfig('bridge_minor', 'Bridge Minor'),
  levelxing: createGenericConfig('levelxing', 'Levelxing', [{ key: 'sttncode', label: 'Station Code' }, { key: 'assetid', label: 'Asset ID' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  road_over_bridge: createGenericConfig('road_over_bridge', 'Road Over Bridge', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  rub_lhs: createGenericConfig('rub_lhs', 'Rub Lhs', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  ror: createGenericConfig('ror', 'Ror', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  rob: createGenericConfig('rob', 'Rob', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  pointxing: createGenericConfig('pointxing', 'Pointxing', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  switch_expansion_joint: createGenericConfig('switch_expansion_joint', 'Switch Expansion Joint', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  buffer_rails: createGenericConfig('buffer_rails', 'Buffer Rails', [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }], [{ key: 'assetid', label: 'Asset ID' }, { key: 'sttncode', label: 'Station Code' }, { key: 'sttnname', label: 'Station Name', full: true }]),
  gradient_start: createGenericConfig('gradient_start', 'Gradient Start', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  gradient_end: createGenericConfig('gradient_end', 'Gradient End', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  curve_start: createGenericConfig('curve_start', 'Curve Start', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  curve_end: createGenericConfig('curve_end', 'Curve End', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  cutting_start: createGenericConfig('cutting_start', 'Cutting Start', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  cutting_end: createGenericConfig('cutting_end', 'Cutting End', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  tunnel_start: createGenericConfig('tunnel_start', 'Tunnel Start', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
  tunnel_end: createGenericConfig('tunnel_end', 'Tunnel End', [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }], [{ key: 'distkm', label: 'Dist (KM)' }, { key: 'distm', label: 'Dist (M)' }, { key: 'sttncode', label: 'Station Code' }]),
};

export const EDIT_LAYER_OPTIONS = Object.values(EDIT_LAYER_CONFIG).map((config) => ({
  value: config.id,
  label: config.label,
}));

const BRIDGE_TABLE_COLUMNS: TableColumnConfig[] = [
  { key: 'asset_id', label: 'Asset ID', stationLink: true },
  { key: 'bridgeno', label: 'Bridge No' },
  { key: 'distkm', label: 'Distance (KM)' },
  { key: 'distm', label: 'Distance (M)' },
  { key: 'state', label: 'State' },
  { key: 'district', label: 'District' },
];

const BRIDGE_FORM_FIELDS: EditFieldConfig[] = [
  { key: 'asset_id', label: 'Asset ID', required: true, full: true },
  { key: 'distkm', label: 'Distance (km)', required: true, full: true },
  { key: 'distm', label: 'Distance (m)', required: true, full: true },
  { key: 'latitude', label: 'Latitude', required: true, full: true },
  { key: 'longitude', label: 'Longitude', required: true, full: true },
  { key: 'line', label: 'Line', required: true, full: true },
  { key: 'railway', label: 'Railway', required: true, full: true },
  { key: 'division', label: 'Division', required: true, full: true },
  { key: 'tmssection', label: 'TMS Section', required: true, full: true },
  { key: 'state', label: 'State', required: true, full: true },
  { key: 'district', label: 'District', required: true, full: true },
  { key: 'xcoord', label: 'X Coordinate', required: true, full: true },
  { key: 'ycoord', label: 'Y Coordinate', required: true, full: true },
  { key: 'bridgeno', label: 'Bridge No', required: true, full: true },
  { key: 'constituncy', label: 'Constituency', required: true, full: true },
  { key: 'bridgetype', label: 'Bridge Type', required: true, full: true },
  { key: 'spanconf', label: 'Span Configuration', required: true, full: true },
];

EDIT_LAYER_CONFIG.bridge_start = {
  id: 'bridge_start',
  label: 'Bridge Start',
  formTitle: 'Bridge Details',
  note: '* Fill all mandatory bridge fields before sending the record to checker.',
  tableColumns: BRIDGE_TABLE_COLUMNS,
  formFields: BRIDGE_FORM_FIELDS,
};

EDIT_LAYER_CONFIG.bridge_end = {
  id: 'bridge_end',
  label: 'Bridge End',
  formTitle: 'Bridge Details',
  note: '* Fill all mandatory bridge fields before sending the record to checker.',
  tableColumns: BRIDGE_TABLE_COLUMNS,
  formFields: BRIDGE_FORM_FIELDS,
};

EDIT_LAYER_CONFIG.bridge_minor = {
  id: 'bridge_minor',
  label: 'Bridge Minor',
  formTitle: 'Bridge Details',
  note: '* Fill all mandatory bridge fields before sending the record to checker.',
  tableColumns: BRIDGE_TABLE_COLUMNS,
  formFields: BRIDGE_FORM_FIELDS,
};

export function getEditLayerConfig(layerId: string | null | undefined): LayerFormConfig | null {
  const normalized = String(layerId || '').trim().toLowerCase();
  if (!normalized) return null;
  return EDIT_LAYER_CONFIG[normalized] || null;
}
