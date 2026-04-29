import { Injectable } from '@angular/core';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import {
  BASE_URL,
  emptyFeatureCollection,
  hasDivision,
  isPortalAdminUser,
  withAllIndia,
  withDivision,
} from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CivilEngineeringAssetsViewingApi {
  constructor(private http: HttpClient) {}

  private hasViewScope(): boolean {
    return hasDivision() || isPortalAdminUser();
  }

  private viewParams(params: Record<string, any>) {
    return isPortalAdminUser() ? withAllIndia(params) : withDivision(params);
  }

  getLandBoundary(bbox: string) {
    if (!this.hasViewScope()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/landBoundary`, {
      params: this.viewParams({ bbox }),
    });
  }

  getLandOffset(bbox: string) {
    if (!this.hasViewScope()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/landOffset`, {
      params: this.viewParams({ bbox }),
    });
  }

  getLandPlanOnTrack(z: number) {
    if (!this.hasViewScope()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/landPlanOnTrack`, {
      params: this.viewParams({ z }),
    });
  }

  getBridgeStart(bbox: string) {
    if (!this.hasViewScope()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/bridge_start`, {
      params: this.viewParams({ bbox }),
    });
  }

  getBridgeEnd(bbox: string) {
    if (!this.hasViewScope()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/bridge_end`, {
      params: this.viewParams({ bbox }),
    });
  }

  getBridgeMinor(bbox: string) {
    if (!this.hasViewScope()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/bridge_minor`, {
      params: this.viewParams({ bbox }),
    });
  }
}
