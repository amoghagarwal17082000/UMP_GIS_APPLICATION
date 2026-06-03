import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BASE_URL } from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CommonLocationApi {
  constructor(private http: HttpClient) {}

  getStates() {
    return this.http.get<any>(`${BASE_URL}/api/common/location/states`);
  }

  getDistricts(filters: { state?: string; state_lgd?: number | string } = {}) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params = params.set(key, String(value));
    });
    return this.http.get<any>(`${BASE_URL}/api/common/location/districts`, { params });
  }

  getParliamentaryConstituencies(filters: { state?: string; q?: string; search?: string } = {}) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params = params.set(key, String(value));
    });
    return this.http.get<any>(`${BASE_URL}/api/common/location/parliamentary-constituencies`, { params });
  }

  getRailways() {
    return this.http.get<any>(`${BASE_URL}/api/common/location/railways`);
  }
}
