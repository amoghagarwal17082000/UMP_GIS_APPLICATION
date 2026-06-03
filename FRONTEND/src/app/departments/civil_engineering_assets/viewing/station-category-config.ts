export type StationCategoryGroup =
  | 'Non Suburban Group'
  | 'Suburban Group'
  | 'Halt Group'
  | 'Others';

export type StationCategory =
  | 'NSG1'
  | 'NSG2'
  | 'NSG3'
  | 'NSG4'
  | 'NSG5'
  | 'NSG6'
  | 'SG1'
  | 'SG2'
  | 'SG3'
  | 'HG1'
  | 'HG2'
  | 'HG3'
  | 'A1'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'NOT DEFINED';

export type StationCategoryNode = {
  group: StationCategoryGroup;
  categories: StationCategory[];
};

export type StationCategoryIconConfig = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
};

export const STATION_CATEGORY_GROUPS: StationCategoryNode[] = [
  {
    group: 'Non Suburban Group',
    categories: ['NSG1', 'NSG2', 'NSG3', 'NSG4', 'NSG5', 'NSG6'],
  },
  {
    group: 'Suburban Group',
    categories: ['SG1', 'SG2', 'SG3'],
  },
  {
    group: 'Halt Group',
    categories: ['HG1', 'HG2', 'HG3'],
  },
  {
    group: 'Others',
    categories: ['A1', 'A', 'B', 'C', 'D', 'E', 'F', 'NOT DEFINED'],
  },
];

export const STATION_CATEGORY_ORDER: StationCategory[] = STATION_CATEGORY_GROUPS.flatMap(
  (item) => item.categories,
);

export const STATION_CATEGORY_GROUP_BY_CATEGORY: Record<StationCategory, StationCategoryGroup> = {
  NSG1: 'Non Suburban Group',
  NSG2: 'Non Suburban Group',
  NSG3: 'Non Suburban Group',
  NSG4: 'Non Suburban Group',
  NSG5: 'Non Suburban Group',
  NSG6: 'Non Suburban Group',
  SG1: 'Suburban Group',
  SG2: 'Suburban Group',
  SG3: 'Suburban Group',
  HG1: 'Halt Group',
  HG2: 'Halt Group',
  HG3: 'Halt Group',
  A1: 'Others',
  A: 'Others',
  B: 'Others',
  C: 'Others',
  D: 'Others',
  E: 'Others',
  F: 'Others',
  'NOT DEFINED': 'Others',
};

const STATION_CATEGORY_SET = new Set<StationCategory>(STATION_CATEGORY_ORDER);

const DEFAULT_STATION_CATEGORY_ICON: StationCategoryIconConfig = {
  imageUrl: 'assets/images/download.png',
  imageWidth: 23,
  imageHeight: 23,
};

export const STATION_CATEGORY_ICON_MAP: Record<StationCategory, StationCategoryIconConfig> = {
  NSG1: { imageUrl: 'assets/images/station-nsg1.png', imageWidth: 23, imageHeight: 23 },
  NSG2: { imageUrl: 'assets/images/station-nsg2.png', imageWidth: 23, imageHeight: 23 },
  NSG3: { imageUrl: 'assets/images/station-nsg3.png', imageWidth: 23, imageHeight: 23 },
  NSG4: { imageUrl: 'assets/images/station-nsg4.png', imageWidth: 23, imageHeight: 23 },
  NSG5: { imageUrl: 'assets/images/station-nsg5.png', imageWidth: 23, imageHeight: 23 },
  NSG6: { imageUrl: 'assets/images/station-nsg6.png', imageWidth: 23, imageHeight: 23 },

  SG1: { imageUrl: 'assets/images/station-sg1.png', imageWidth: 23, imageHeight: 23 },
  SG2: { imageUrl: 'assets/images/station-sg2.png', imageWidth: 23, imageHeight: 23 },
  SG3: { imageUrl: 'assets/images/station-sg3.png', imageWidth: 23, imageHeight: 23 },

  HG1: { imageUrl: 'assets/images/station-hg1.png', imageWidth: 23, imageHeight: 23 },
  HG2: { imageUrl: 'assets/images/station-hg2.png', imageWidth: 23, imageHeight: 23 },
  HG3: { imageUrl: 'assets/images/station-hg3.png', imageWidth: 23, imageHeight: 23 },

  A1: { imageUrl: 'assets/images/station-a1.png', imageWidth: 23, imageHeight: 23 },
  A: { imageUrl: 'assets/images/station-a.png', imageWidth: 23, imageHeight: 23 },
  B: { imageUrl: 'assets/images/station-b.png', imageWidth: 23, imageHeight: 23 },
  C: { imageUrl: 'assets/images/station-c.png', imageWidth: 23, imageHeight: 23 },
  D: { imageUrl: 'assets/images/station-d.png', imageWidth: 23, imageHeight: 23 },
  E: { imageUrl: 'assets/images/station-e.png', imageWidth: 23, imageHeight: 23 },
  F: { imageUrl: 'assets/images/station-f.png', imageWidth: 23, imageHeight: 23 },

  'NOT DEFINED': {
    imageUrl: 'assets/images/station-not-defined.png',
    imageWidth: 23,
    imageHeight: 23,
  },
};

function normalizeRawCategory(value: any): string {
  return String(value ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normalizeStationCategory(value: any): StationCategory {
  const normalized = normalizeRawCategory(value);

  if (!normalized) return 'NOT DEFINED';
  if (normalized === 'NOTDEFINED') return 'NOT DEFINED';
  if (normalized === 'NOT DEFINED') return 'NOT DEFINED';
  if (normalized === 'NOT-DEFINED') return 'NOT DEFINED';
  if (normalized === 'NOT_DEFINED') return 'NOT DEFINED';

  if (STATION_CATEGORY_SET.has(normalized as StationCategory)) {
    return normalized as StationCategory;
  }

  return 'NOT DEFINED';
}

export function isKnownStationCategory(value: any): boolean {
  const normalized = normalizeRawCategory(value);
  return STATION_CATEGORY_SET.has(normalized as StationCategory);
}

export function getStationCategoryGroup(value: any): StationCategoryGroup {
  const category = normalizeStationCategory(value);
  return STATION_CATEGORY_GROUP_BY_CATEGORY[category];
}

export function getStationCategoriesByGroup(group: StationCategoryGroup): StationCategory[] {
  return STATION_CATEGORY_GROUPS.find((item) => item.group === group)?.categories.slice() || [];
}

export function isStationCategoryInGroup(value: any, group: StationCategoryGroup): boolean {
  return getStationCategoryGroup(value) === group;
}

export function getStationCategoryIconConfig(value: any): StationCategoryIconConfig {
  const category = normalizeStationCategory(value);
  return STATION_CATEGORY_ICON_MAP[category] || DEFAULT_STATION_CATEGORY_ICON;
}