import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BASE_URL } from '../shared/api-utils';
  
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  constructor(private http: HttpClient) {}

  validatePassword(obj: any): Observable<any> {
    return this.http.post<any>(`${BASE_URL}/api/update/profile/validate-password`, obj);
  }

  updateProfile(obj: any): Observable<any> {
    return this.http.post<any>(`${BASE_URL}/api/update/profile`, obj);
  }
}
