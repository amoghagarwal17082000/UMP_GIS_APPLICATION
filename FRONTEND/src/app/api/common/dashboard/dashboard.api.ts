import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, getDivision } from '../../shared/api-utils';

export interface DashboardCountFilters {
  allIndia?: boolean;
  zone?: string;
  division?: string;
}

@Injectable({ providedIn: 'root' })
export class CommonDashboardApi {
  constructor(private http: HttpClient) {}

  private getDashboardCount(
  asset: string,
  type: string,
  filters: DashboardCountFilters = {}
) {
  const params: any = { type };

  if (filters.allIndia) {
    params.allIndia = 'true';
  }

  if (filters.zone) {
    params.zone = filters.zone;
  }

  if (filters.division) {
    params.division = filters.division;
  }

  if (!filters.allIndia && !filters.division) {
    params.division = getDivision();
  }

  return this.http.get<any>(
    `${BASE_URL}/api/civil_engineering_assets/view/dashboard/${asset}/count`,
    { params }
  );
}

getStationCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('station', type, filters);
}

getBridgeStartCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('bridgeStart', type, filters);
}

getBridgeStopCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('bridgeEnd', type, filters);
}

getBridgeMinorCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('bridgeMinor', type, filters);
}

getLevelXingCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('levelXing', type, filters);
}

getRoadOverBridgeCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('roadOverBridge', type, filters);
}

getRubLhsCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('rubLhs', type, filters);
}

getRorCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('ror', type, filters);
}

getKmPostCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('kmPost', type, filters);
}

getLandPlanCount(type: string, filters: DashboardCountFilters = {}) {
  return this.getDashboardCount('landPlan', type, filters);
}
  getZoneDivisionFilters() {
  return this.http.get<any>(
    `${BASE_URL}/api/civil_engineering_assets/view/dashboard/filters/zone-division`
  );
}
}
