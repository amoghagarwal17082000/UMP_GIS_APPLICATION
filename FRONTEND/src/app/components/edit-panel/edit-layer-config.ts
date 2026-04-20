export type EditLayerKey = string;

export type EditFieldType = 'text' | 'number';
export type EditControlType = 'input' | 'textarea';

export type EditFieldConfig = {
  key: string;
  label: string;
  type?: EditFieldType;
  control?: EditControlType;
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
  tableColumnKeys: string[];
  formFieldKeys: string[];
  tableColumns: TableColumnConfig[];
  formFields: EditFieldConfig[];
};

const COLUMN_LIBRARY: Record<string, TableColumnConfig> = {
  objectid: { key: 'objectid', label: 'Object ID' },
  status: { key: 'status', label: 'Status' },
  modified_by: { key: 'modified_by', label: 'Modified By' },
  sttncode: { key: 'sttncode', label: 'Station Code', stationLink: true },
  sttnname: { key: 'sttnname', label: 'Station Name' },
  distkm: { key: 'distkm', label: 'Distance (KM)' },
  distm: { key: 'distm', label: 'Distance (M)' },
  state: { key: 'state', label: 'State' },
  district: { key: 'district', label: 'District' },
  bridgeno: { key: 'bridgeno', label: 'Bridge No' },
  asset_id: { key: 'asset_id', label: 'Asset ID', stationLink: true },
  km: { key: 'km', label: 'KM' },
  km_post: { key: 'km_post', label: 'KM Post' },
  distfromkm: { key: 'distfromkm', label: 'From KM' },
  distfromm: { key: 'distfromm', label: 'From M' },
  disttokm: { key: 'disttokm', label: 'To KM' },
  disttom: { key: 'disttom', label: 'To M' },
  agency_name: { key: 'agency_name', label: 'Agency' },
  assetid: { key: 'assetid', label: 'Asset ID' },
};

const FIELD_LIBRARY: Record<string, EditFieldConfig> = {
  objectid: { key: 'objectid', label: 'Object ID', full: true },
  status: { key: 'status', label: 'Current Status', full: true },
  edited_by: { key: 'edited_by', label: 'Edited By', full: true },
  edited_at: { key: 'edited_at', label: 'Edited At', full: true },
  checked_by: { key: 'checked_by', label: 'Checked By', full: true },
  checked_at: { key: 'checked_at', label: 'Checked At', full: true },
  approved_by: { key: 'approved_by', label: 'Approved By', full: true },
  approved_at: { key: 'approved_at', label: 'Approved At', full: true },
  modified_by: { key: 'modified_by', label: 'Modified By', full: true },
  comments: { key: 'comments', label: 'Comments', full: true, control: 'textarea' },

  sttncode: { key: 'sttncode', label: 'Station Code', required: true, full: true, validateButton: true },
  sttnname: { key: 'sttnname', label: 'Station Name', required: true },
  stationtype: { key: 'stationtype', label: 'Station Type', required: true },
  distkm: { key: 'distkm', label: 'Distance (KM)', type: 'number', required: true },
  distm: { key: 'distm', label: 'Distance (M)', type: 'number', required: true },
  state: { key: 'state', label: 'State', required: true },
  district: { key: 'district', label: 'District', required: true },
  category: { key: 'category', label: 'Category', required: true },
  constituency: { key: 'constituency', label: 'Constituency', required: true, full: true },

  km: { key: 'km', label: 'KM' },
  km_post: { key: 'km_post', label: 'KM Post' },

  distfromkm: { key: 'distfromkm', label: 'From KM', type: 'number', required: true },
  distfromm: { key: 'distfromm', label: 'From M', type: 'number', required: true },
  disttokm: { key: 'disttokm', label: 'To KM', type: 'number', required: true },
  disttom: { key: 'disttom', label: 'To M', type: 'number', required: true },
  railway: { key: 'railway', label: 'Railway' },
  division: { key: 'division', label: 'Division' },
  agency_name: { key: 'agency_name', label: 'Agency Name' },
  land_plot: { key: 'land_plot', label: 'Land Plot' },

  asset_id: { key: 'asset_id', label: 'Asset ID', required: true, full: true },
  latitude: { key: 'latitude', label: 'Latitude', required: true, full: true },
  longitude: { key: 'longitude', label: 'Longitude', required: true, full: true },
  line: { key: 'line', label: 'Line', required: true, full: true },
  tmssection: { key: 'tmssection', label: 'TMS Section', required: true, full: true },
  xcoord: { key: 'xcoord', label: 'X Coordinate', required: true, full: true },
  ycoord: { key: 'ycoord', label: 'Y Coordinate', required: true, full: true },
  bridgeno: { key: 'bridgeno', label: 'Bridge No', required: true, full: true },
  constituncy: { key: 'constituncy', label: 'Constituency', required: true, full: true },
  bridgetype: { key: 'bridgetype', label: 'Bridge Type', required: true, full: true },
  spanconf: { key: 'spanconf', label: 'Span Configuration', required: true, full: true },

  assetid: { key: 'assetid', label: 'Asset ID' },
};

const GENERIC_STATUS_COLUMN_KEYS = ['objectid', 'status', 'modified_by'];
const GENERIC_STATUS_FIELD_KEYS = [
  'objectid',
  'status',
  'edited_by',
  'edited_at',
  'checked_by',
  'checked_at',
  'approved_by',
  'approved_at',
  'modified_by',
];

function resolveColumn(key: string): TableColumnConfig {
  const column = COLUMN_LIBRARY[key];
  return column ? { ...column } : { key, label: key };
}

function resolveField(key: string): EditFieldConfig {
  const field = FIELD_LIBRARY[key];
  return field ? { ...field } : { key, label: key, full: true };
}

function buildLayerConfig(def: {
  id: string;
  label: string;
  formTitle?: string;
  note?: string;
  tableColumnKeys?: string[];
  formFieldKeys?: string[];
  includeGenericStatusColumns?: boolean;
  includeGenericStatusFields?: boolean;
}): LayerFormConfig {
  const tableColumnKeys = [
    ...(def.tableColumnKeys || []),
    ...(def.includeGenericStatusColumns === false ? [] : GENERIC_STATUS_COLUMN_KEYS),
  ];
  const formFieldKeys = [
    ...(def.formFieldKeys || []),
    ...(def.includeGenericStatusFields === false ? [] : GENERIC_STATUS_FIELD_KEYS),
  ];

  return {
    id: def.id,
    label: def.label,
    formTitle: def.formTitle,
    note: def.note,
    tableColumnKeys,
    formFieldKeys,
    tableColumns: tableColumnKeys.map(resolveColumn),
    formFields: formFieldKeys.map(resolveField),
  };
}

export const EDIT_LAYER_CONFIG: Record<string, LayerFormConfig> = {
  stations: buildLayerConfig({
    id: 'stations',
    label: 'Stations',
    note: '* For Station: All starred fields are mandatory | For Landplan: Polygon geometry required',
    includeGenericStatusColumns: false,
    includeGenericStatusFields: false,
    tableColumnKeys: ['sttncode', 'sttnname', 'distkm', 'distm', 'state', 'district'],
    formFieldKeys: ['sttncode', 'sttnname', 'stationtype', 'distkm', 'distm', 'state', 'district', 'category', 'constituency', 'status'],
  }),

  landplan: buildLayerConfig({
    id: 'landplan',
    label: 'Land Plan On Track',
    note: '* Layer forms are configuration-driven. Station workflow is fully wired; other layers can now plug into the same form engine.',
    includeGenericStatusColumns: false,
    includeGenericStatusFields: false,
    tableColumnKeys: ['distfromkm', 'distfromm', 'disttokm', 'disttom', 'status'],
    formFieldKeys: ['distfromkm', 'distfromm', 'disttokm', 'disttom', 'railway', 'division', 'status'],
  }),

  km_post: buildLayerConfig({
    id: 'km_post',
    label: 'Km Post',
    tableColumnKeys: ['km', 'km_post', 'sttncode'],
    formFieldKeys: ['km', 'km_post', 'sttncode', 'sttnname'],
  }),

  landplan_ontrack: buildLayerConfig({
    id: 'landplan_ontrack',
    label: 'Landplan Ontrack',
    tableColumnKeys: ['distfromkm', 'disttokm', 'distfromm', 'disttom'],
    formFieldKeys: ['distfromkm', 'distfromm', 'disttokm', 'disttom', 'railway', 'division'],
  }),

  landplan_offtrack: buildLayerConfig({
    id: 'landplan_offtrack',
    label: 'Landplan Offtrack',
    tableColumnKeys: ['state', 'district', 'agency_name'],
    formFieldKeys: ['state', 'district', 'agency_name', 'land_plot'],
  }),

  land_offset: buildLayerConfig({
    id: 'land_offset',
    label: 'Land Offset',
    tableColumnKeys: ['distfromkm', 'disttokm'],
    formFieldKeys: ['distfromkm', 'distfromm', 'disttokm', 'disttom'],
  }),

  land_boundary: buildLayerConfig({
    id: 'land_boundary',
    label: 'Land Boundary',
    tableColumnKeys: ['distfromkm', 'disttokm'],
    formFieldKeys: ['distfromkm', 'distfromm', 'disttokm', 'disttom'],
  }),

  bridge_start: buildLayerConfig({
    id: 'bridge_start',
    label: 'Bridge Start',
    formTitle: 'Bridge Details',
    note: '* Fill all mandatory bridge fields before sending the record to checker.',
    includeGenericStatusColumns: false,
    includeGenericStatusFields: false,
    tableColumnKeys: ['asset_id', 'bridgeno', 'distkm', 'distm', 'state', 'district'],
    formFieldKeys: [
      'asset_id',
      'distkm',
      'distm',
      'railway',
      'division',
      'state',
      'district',
      'bridgeno',
      'constituncy',
      'bridgetype',
      'spanconf',
    ],
  }),

  bridge_end: buildLayerConfig({
    id: 'bridge_end',
    label: 'Bridge End',
    formTitle: 'Bridge Details',
    note: '* Fill all mandatory bridge fields before sending the record to checker.',
    includeGenericStatusColumns: false,
    includeGenericStatusFields: false,
    tableColumnKeys: ['asset_id', 'bridgeno', 'distkm', 'distm', 'state', 'district'],
    formFieldKeys: [
      'asset_id',
      'distkm',
      'distm',
      'railway',
      'division',
      'state',
      'district',
      'bridgeno',
      'constituncy',
      'bridgetype',
      'spanconf',
    ],
  }),

  bridge_minor: buildLayerConfig({
    id: 'bridge_minor',
    label: 'Bridge Minor',
    formTitle: 'Bridge Details',
    note: '* Fill all mandatory bridge fields before sending the record to checker.',
    includeGenericStatusColumns: false,
    includeGenericStatusFields: false,
    tableColumnKeys: ['asset_id', 'bridgeno', 'distkm', 'distm', 'state', 'district'],
    formFieldKeys: [
      'asset_id',
      'distkm',
      'distm',
      'railway',
      'division',
      'state',
      'district',
      'bridgeno',
      'constituncy',
      'bridgetype',
      'spanconf',
    ],
  }),

  levelxing: buildLayerConfig({
    id: 'levelxing',
    label: 'Levelxing',
    tableColumnKeys: ['sttncode', 'assetid'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  road_over_bridge: buildLayerConfig({
    id: 'road_over_bridge',
    label: 'Road Over Bridge',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  rub_lhs: buildLayerConfig({
    id: 'rub_lhs',
    label: 'Rub Lhs',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  ror: buildLayerConfig({
    id: 'ror',
    label: 'Ror',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  rob: buildLayerConfig({
    id: 'rob',
    label: 'Rob',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  pointxing: buildLayerConfig({
    id: 'pointxing',
    label: 'Pointxing',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  switch_expansion_joint: buildLayerConfig({
    id: 'switch_expansion_joint',
    label: 'Switch Expansion Joint',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  buffer_rails: buildLayerConfig({
    id: 'buffer_rails',
    label: 'Buffer Rails',
    tableColumnKeys: ['assetid', 'sttncode'],
    formFieldKeys: ['assetid', 'sttncode', 'sttnname'],
  }),

  gradient_start: buildLayerConfig({
    id: 'gradient_start',
    label: 'Gradient Start',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  gradient_end: buildLayerConfig({
    id: 'gradient_end',
    label: 'Gradient End',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  curve_start: buildLayerConfig({
    id: 'curve_start',
    label: 'Curve Start',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  curve_end: buildLayerConfig({
    id: 'curve_end',
    label: 'Curve End',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  cutting_start: buildLayerConfig({
    id: 'cutting_start',
    label: 'Cutting Start',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  cutting_end: buildLayerConfig({
    id: 'cutting_end',
    label: 'Cutting End',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  tunnel_start: buildLayerConfig({
    id: 'tunnel_start',
    label: 'Tunnel Start',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),

  tunnel_end: buildLayerConfig({
    id: 'tunnel_end',
    label: 'Tunnel End',
    tableColumnKeys: ['distkm', 'distm'],
    formFieldKeys: ['distkm', 'distm', 'sttncode'],
  }),
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
  { key: 'asset_id', label: 'Asset ID', required: true, full: true, validateButton: true },
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
