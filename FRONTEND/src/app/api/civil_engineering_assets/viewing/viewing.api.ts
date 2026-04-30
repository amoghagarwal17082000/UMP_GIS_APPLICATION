import { Injectable } from '@angular/core';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, emptyFeatureCollection, hasDivision, withDivision } from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CivilEngineeringAssetsViewingApi {
  constructor(private http: HttpClient) {}

  getLandBoundary(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/landBoundary`, {
      params: withDivision({ bbox }),
    });
  }

  getLandOffset(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/landOffset`, {
      params: withDivision({ bbox }),
    });
  }

  getLandPlanOnTrack(z: number) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/landPlanOnTrack`, {
      params: withDivision({ z }),
    });
  }

  getBridgeStart(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/bridge_start`, {
      params: withDivision({ bbox }),
    });
  }

  getBridgeEnd(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/bridge_end`, {
      params: withDivision({ bbox }),
    });
  }

  getBridgeMinor(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/bridge_minor`, {
      params: withDivision({ bbox }),
    });
  }
}
