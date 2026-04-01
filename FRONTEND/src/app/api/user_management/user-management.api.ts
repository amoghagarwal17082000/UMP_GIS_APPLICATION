import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BASE_URL } from '../shared/api-utils';
import { getCurrentUserSnapshot } from '../../services/current-user.store';

@Injectable({ providedIn: 'root' })
export class UserManagementApi {
  constructor(private http: HttpClient) {}

  private getDivision(): string {
    return (getCurrentUserSnapshot()?.division || localStorage.getItem('division') || '').trim();
  }

  getUsers() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users`, { params });
  }

  getMakerCheckerList() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/maker-checker-list`, { params });
  }

  assignChecker(data: any) {
    return this.http.post(`${BASE_URL}/api/user-management/view/users/assign-checker`, data);
  }

  getAssignedCheckerUsers() {
    const params = new HttpParams().set('division', this.getDivision());
    return this.http.get<any>(`${BASE_URL}/api/user-management/view/users/assigned-checkers`, { params });
  }

  unassignChecker(data: any) {
    return this.http.post(`${BASE_URL}/api/user-management/view/users/unassign-checker`, data);
  }
}
