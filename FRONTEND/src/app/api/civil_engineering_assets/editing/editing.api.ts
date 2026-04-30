import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_URL, getDivision } from '../../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class CivilEngineeringAssetsEditingApi {
  constructor(private http: HttpClient) {}

  getLayerTable(layer: string, page: number, pageSize: number, search: string) {
    const params: any = {
      page,
      pageSize,
      division: getDivision(),
    };
    if (search) params.q = search;

    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/table`, { params });
  }

  getLayerDraftTable(layer: string, page: number, pageSize: number, search: string, status: string) {
    const params: any = {
      page,
      pageSize,
      division: getDivision(),
    };
    if (search) params.q = search;
    if (status) params.status = status;

    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/draft-table`, { params });
  }

  updateLayer(layer: string, id: number, payload: any) {
    return this.http.put(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/${id}`, payload, {
      params: { division: getDivision() },
    });
  }

  sendLayerEdit(layer: string, id: number, payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/${id}/send`, payload, {
      params: { division: getDivision() },
    });
  }

  requestLayerDeletion(layer: string, id: number) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/${id}/request-deletion`, null, {
      params: { division: getDivision() },
    });
  }

  requestLayerDraftDeletion(layer: string, id: number) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/draft/${id}/request-deletion`, null, {
      params: { division: getDivision() },
    });
  }

  resendLayerDraft(layer: string, id: number, payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/draft/${id}/resend`, payload, {
      params: { division: getDivision() },
    });
  }

  sendNewLayerEdit(layer: string, payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/send-new`, payload, {
      params: { division: getDivision() },
    });
  }

  deleteLayer(layer: string, id: number) {
    return this.http.delete(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/${id}`, {
      params: { division: getDivision() },
    });
  }

  createLayer(layer: string, payload: any) {
    return this.http.post(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}`, payload, {
      params: { division: getDivision() },
    });
  }

  getLayerById(layer: string, id: number) {
    const params = new HttpParams().set('division', getDivision());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/${id}`, { params });
  }

  getLayerDraftById(layer: string, id: number) {
    const params = new HttpParams().set('division', getDivision());
    return this.http.get<any>(`${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/draft/${id}`, { params });
  }

  updateLayerDraftStatus(layer: string, id: number, status: string) {
    return this.http.post<any>(
      `${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/draft/${id}/status`,
      { status },
      {
        params: { division: getDivision() },
      }
    );
  }
  uploadLayerAttachments(layer: string, id: number, files: File[]) {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file, file.name));

    return this.http.post<any>(
      `${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/${id}/attachments`,
      formData,
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

  validateAssetId(layer: string, assetId: string, objectId?: number | null): Observable<any> {
    return this.http.post<any>(
      `${BASE_URL}/api/civil_engineering_assets/edit/${encodeURIComponent(layer)}/asset-id/validate`,
      {
        asset_id: String(assetId || '').trim(),
        objectid: Number.isFinite(Number(objectId)) ? Number(objectId) : null,
      },
      {
        params: { division: getDivision() },
      }
    );
  }

  getStationTable(page: number, pageSize: number, search: string) {
    return this.getLayerTable('station', page, pageSize, search);
  }

  getBridgeStartTable(page: number, pageSize: number, search: string) {
    return this.getLayerTable('bridge_start', page, pageSize, search);
  }

  getBridgeEndTable(page: number, pageSize: number, search: string) {
    return this.getLayerTable('bridge_end', page, pageSize, search);
  }

  getBridgeMinorTable(page: number, pageSize: number, search: string) {
    return this.getLayerTable('bridge_minor', page, pageSize, search);
  }

  getStationDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.getLayerDraftTable('station', page, pageSize, search, status);
  }

  getBridgeStartDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.getLayerDraftTable('bridge_start', page, pageSize, search, status);
  }

  getBridgeEndDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.getLayerDraftTable('bridge_end', page, pageSize, search, status);
  }

  getBridgeMinorDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.getLayerDraftTable('bridge_minor', page, pageSize, search, status);
  }

  updateStation(id: number, payload: any) {
    return this.updateLayer('station', id, payload);
  }

  sendStationEdit(id: number, payload: any) {
    return this.sendLayerEdit('station', id, payload);
  }

  requestStationDeletion(id: number) {
    return this.requestLayerDeletion('station', id);
  }

  requestStationDraftDeletion(id: number) {
    return this.requestLayerDraftDeletion('station', id);
  }

  resendStationDraft(id: number, payload: any) {
    return this.resendLayerDraft('station', id, payload);
  }

  sendNewStationEdit(payload: any) {
    return this.sendNewLayerEdit('station', payload);
  }

  deleteStation(id: number) {
    return this.deleteLayer('station', id);
  }

  createStation(payload: any) {
    return this.createLayer('station', payload);
  }

  getStationById(id: number) {
    return this.getLayerById('station', id);
  }

  getStationDraftById(id: number) {
    return this.getLayerDraftById('station', id);
  }

  updateStationDraftStatus(id: number, status: string) {
    return this.updateLayerDraftStatus('station', id, status);
  }
}
