import { Injectable } from '@angular/core';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, emptyFeatureCollection, getDivision, hasDivision, withDivision } from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CommonViewingApi {
  constructor(private http: HttpClient) {}

  getStations(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/station`, {
      params: withDivision({ bbox }),
    });
  }

  getTracks(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/railwayTrack`, {
      params: withDivision({ bbox }),
    });
  }

  getKmPosts(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/kmPost`, {
      params: withDivision({ bbox }),
    });
  }

  getIndiaBoundary(bbox: string) {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/common/view/layers/indiaBoundary`, {
      params: withDivision({ bbox }),
    });
  }

  getDivisionBuffer() {
    if (!hasDivision()) return of(emptyFeatureCollection());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/view/layers/divisionBuffer`, {
      params: withDivision({}),
    });
  }

  getDivisionBufferKey(z: number) {
    return `division=${getDivision()}|z=${z}`;
  }
}
