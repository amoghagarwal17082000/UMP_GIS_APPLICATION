import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, getDivision } from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CommonDashboardApi {
  constructor(private http: HttpClient) {}

  private getDashboardCount(asset: string, type: string) {
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/dashboard/${asset}/count`, {
      params: { division: getDivision(), type },
    });
  }

  getStationCount(type: string) {
    return this.getDashboardCount('station', type);
  }
  getBridgeStartCount(type: string) {
    return this.getDashboardCount('bridgeStart', type);
  }
  getBridgeStopCount(type: string) {
    return this.getDashboardCount('bridgeEnd', type);
  }
  getBridgeMinorCount(type: string) {
    return this.getDashboardCount('bridgeMinor', type);
  }
  getLevelXingCount(type: string) {
    return this.getDashboardCount('levelXing', type);
  }
  getRoadOverBridgeCount(type: string) {
    return this.getDashboardCount('roadOverBridge', type);
  }
  getRubLhsCount(type: string) {
    return this.getDashboardCount('rubLhs', type);
  }
  getRorCount(type: string) {
    return this.getDashboardCount('ror', type);
  }
  getKmPostCount(type: string) {
    return this.getDashboardCount('kmPost', type);
  }
  getLandPlanCount(type: string) {
    return this.getDashboardCount('landPlan', type);
  }
}
