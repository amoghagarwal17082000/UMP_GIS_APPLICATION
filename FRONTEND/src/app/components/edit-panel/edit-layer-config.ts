export type EditLayerKey = 'stations' | 'landplan';

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
  note?: string;
  tableColumns: TableColumnConfig[];
  formFields: EditFieldConfig[];
};

export const EDIT_LAYER_CONFIG: Record<EditLayerKey, LayerFormConfig> = {
  stations: {
    id: 'stations',
    label: 'Stations',
    note: '* For Station: All starred fields are mandatory | For Landplan: Polygon geometry required',
    tableColumns: [
      { key: 'sttncode', label: 'Station Code', stationLink: true },
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
};

export const EDIT_LAYER_OPTIONS = Object.values(EDIT_LAYER_CONFIG).map((config) => ({
  value: config.id,
  label: config.label,
}));
