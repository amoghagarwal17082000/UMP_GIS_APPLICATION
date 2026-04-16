import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BASE_URL, getDivision } from '../shared/api-utils';
import { getCurrentUserSnapshot } from '../../services/current-user.store';

@Injectable({ providedIn: 'root' })
export class UserManagementApi {
  constructor(private http: HttpClient) {}

  private getDivision(): string {
    return (getDivision() || getCurrentUserSnapshot()?.division || '').trim();
  }

  getUsers() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users`, { params });
  }

  getMakerCheckerList() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/maker-checker-list`, {
      params,
    });
  }

  assignChecker(data: any) {
    return this.http.post(`${BASE_URL}/api/user-management/view/users/assign-checker`, data);
  }

  getAssignedCheckerUsers() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/assigned-checkers`, {
      params,
    });
  }

  unassignChecker(data: any) {
    return this.http.post(`${BASE_URL}/api/user-management/view/users/unassign-checker`, data);
  }

  updateUserDetails(data: any) {
    return this.http.put(`${BASE_URL}/api/user-management/view/users/update-user`, data);
  }

  getMakerLayerList(currentUserId?: string) {
    let params = new HttpParams().set('division', this.getDivision());
    const normalizedUserId = String(currentUserId || '').trim();
    if (normalizedUserId) {
      params = params.set('current_user_id', normalizedUserId);
    }
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/maker-layer-list`, {
      params,
    });
  }

  getDepartmentLayers(departmentId: string) {
    const params = new HttpParams().set('department_id', departmentId);
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/department-layers`, {
      params,
    });
  }

  assignLayers(data: any) {
    return this.http.post(`${BASE_URL}/api/user-management/view/users/assign-layers`, data);
  }

  getAssignedLayerUsers() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/assigned-layers`, {
      params,
    });
  }

  updateAssignedLayers(data: any) {
    return this.http.post(
      `${BASE_URL}/api/user-management/view/users/update-assigned-layers`,
      data,
    );
  }

  clearAssignedLayers(data: any) {
    return this.http.post(`${BASE_URL}/api/user-management/view/users/clear-assigned-layers`, data);
  }
}
