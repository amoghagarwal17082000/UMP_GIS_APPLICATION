import { Injectable } from '@angular/core';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import {
  BASE_URL,
  emptyFeatureCollection,
  getDivision,
  hasDivision,
  isPortalAdminUser,
  withAllIndia,
  withDivision,
} from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CommonViewingApi {
  constructor(private http: HttpClient) {}

  getStations(bbox: string, limit?: number, categories: string[] = []) {
    const allIndia = isPortalAdminUser();
    if (!hasDivision() && !allIndia) return of(emptyFeatureCollection());
    const params: Record<string, string | number> = { bbox };
    if (typeof limit === 'number' && Number.isFinite(limit)) params['limit'] = limit;
    if (categories.length) params['categories'] = categories.join(',');

    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/station`, {
      params: allIndia ? withAllIndia(params) : withDivision(params),
    });
  }

  searchStations(q: string, limit = 10) {
  const allIndia = isPortalAdminUser();
  if (!hasDivision() && !allIndia) return of(emptyFeatureCollection());

  return this.http.get<any>(`${BASE_URL}/api/common/view/layers/station/search`, {
    params: allIndia
      ? withAllIndia({ q, limit })
      : withDivision({ q, limit }),
  });
}

  getTracks(bbox: string, z?: number) {
    const allIndia = isPortalAdminUser();
    if (!hasDivision() && !allIndia) return of(emptyFeatureCollection());
    const params = z == null ? { bbox } : { bbox, z };
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/railwayTrack`, {
      params: allIndia ? withAllIndia(params) : withDivision(params),
    });
  }

  getKmPosts(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/kmPost`, {
      params: withDivision({ bbox }),
    });
  }

  getIndiaBoundary(bbox: string) {
    const allIndia = isPortalAdminUser();
    if (!hasDivision() && !allIndia) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/indiaBoundary`, {
      params: allIndia ? withAllIndia({ bbox }) : withDivision({ bbox }),
    });
  }

  getDivisionBuffer() {
    const allIndia = isPortalAdminUser();
    if (allIndia || !hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/division-buffer/current`, {
      params: withDivision({}),
    });
  }

  getDivisionBufferKey(z: number) {
    return isPortalAdminUser() ? `portalAdmin=no-buffer|z=${z}` : `division=${getDivision()}|z=${z}`;
  }

  getDepartmentLayerCatalog(departmentRef: string) {
    if (!departmentRef?.trim()) {
      return of({ success: true, data: [] });
    }

    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/department/${encodeURIComponent(departmentRef)}/layers`, {
      params: withDivision({}),
    });
  }

  getDepartmentLayerData(departmentRef: string, layerKey: string, bbox: string, limit?: number) {
    const allIndia = isPortalAdminUser();
    if ((!hasDivision() && !allIndia) || !departmentRef?.trim() || !layerKey?.trim()) {
      return of(emptyFeatureCollection());
    }

    return this.http.get<any>(
      `${BASE_URL}/api/common/view/layers/department/${encodeURIComponent(departmentRef)}/layers/${encodeURIComponent(layerKey)}`,
      { params: allIndia ? withAllIndia(limit ? { bbox, limit } : { bbox }) : withDivision(limit ? { bbox, limit } : { bbox }) }
    );
  }
}

