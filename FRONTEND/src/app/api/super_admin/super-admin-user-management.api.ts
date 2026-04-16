import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL } from '../shared/api-utils';

@Injectable({ providedIn: 'root' })
export class SuperAdminUserManagementApi {
  constructor(private http: HttpClient) {}

  getAllUsers() {
    return this.http.get<any>(`${BASE_URL}/api/super-admin/users`);
  }
}
