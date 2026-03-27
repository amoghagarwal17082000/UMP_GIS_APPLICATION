import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_URL, getDivision } from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CivilEngineeringAssetsEditingApi {
  constructor(private http: HttpClient) {}

  getStationTable(page: number, pageSize: number, search: string) {
    const params: any = {
      page,
      pageSize,
      division: getDivision(),
    };
    if (search) params.q = search;

    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/station/table`, { params });
  }

  getStationDraftTable(page: number, pageSize: number, search: string, status: string) {
    const params: any = {
      page,
      pageSize,
      division: getDivision(),
    };
    if (search) params.q = search;
    if (status) params.status = status;

    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/station/draft-table`, { params });
  }

  updateStation(id: number, payload: any) {
    return this.http.put(`${BASE_URL}/api/civil_engineering_assets/edit/station/${id}`, payload, {
      params: { division: getDivision() },
    });
  }

  sendStationEdit(id: number, payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/station/${id}/send`, payload, {
      params: { division: getDivision() },
    });
  }

  requestStationDeletion(id: number) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/station/${id}/request-deletion`, null, {
      params: { division: getDivision() },
    });
  }

  requestStationDraftDeletion(id: number) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/station/draft/${id}/request-deletion`, null, {
      params: { division: getDivision() },
    });
  }

  resendStationDraft(id: number, payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/station/draft/${id}/resend`, payload, {
      params: { division: getDivision() },
    });
  }

  sendNewStationEdit(payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/station/send-new`, payload, {
      params: { division: getDivision() },
    });
  }

  deleteStation(id: number) {
    return this.http.delete(`${BASE_URL}/api/civil_engineering_assets/edit/station/${id}`, {
      params: { division: getDivision() },
    });
  }

  createStation(payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/station`, payload, {
      params: { division: getDivision() },
    });
  }

  getStationById(id: number) {
    const params = new HttpParams().set('division', getDivision());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/station/${id}`, { params });
  }

  getStationDraftById(id: number) {
    const params = new HttpParams().set('division', getDivision());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/station/draft/${id}`, { params });
  }

  updateStationDraftStatus(id: number, status: string) {
    return this.http.post<any>(
      `${BASE_URL}/api/civil_engineering_assets/edit/station/draft/${id}/status`,
      { status },
      {
        params: { division: getDivision() },
      }
    );
  }

  getStationByCode(code: string): Observable<any> {
    const c = String(code || '').trim().toUpperCase();
    return this.http.get<any>(`${BASE_URL}/api/station_codes/${encodeURIComponent(c)}`);
  }

  validateStationCode(code: string): Observable<any> {
    const station_code = String(code || '').trim().toUpperCase();
    return this.http.post<any>(`${BASE_URL}/api/civil_engineering_assets/edit/station/validate`, {
      station_code,
    });
  }
}
