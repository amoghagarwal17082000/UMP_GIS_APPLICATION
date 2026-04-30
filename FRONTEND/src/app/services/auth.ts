import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { AuthApi } from '../api/auth/auth.api';
import { BASE_URL } from '../api/shared/api-utils';
import { CurrentUserService } from './current-user';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly LAST_RATING_CACHE_KEY = 'last_rating_at';

  constructor(
    private authApi: AuthApi,
    private http: HttpClient,
    private currentUser: CurrentUserService,
  ) {}

  requestOtp(username: string, password: string): Observable<any> {
    return this.authApi.requestOtp(username, password).pipe(
      tap((res: any) => {
        if (res?.success && res?.accessToken) {
          this.currentUser.setAuth(res.user || null, res.accessToken || null);
        }
        console.log('REQUEST OTP RESPONSE FROM SERVER:', res);
      }),
    );
  }

  verifyOtp(user_id: string, otp: string) {
    return this.authApi.verifyOtp(user_id, otp).pipe(
      tap((res: any) => {
        if (res?.success) {
          this.currentUser.setAuth(res.user || null, res.accessToken || null);
        }
      }),
    );
  }

  resendOtp(username: string): Observable<any> {
    return this.authApi.resendOtp(username).pipe(
      tap((res: any) => {
        console.log('RESEND OTP RESPONSE FROM SERVER:', res);
      }),
    );
  }

  logout(): void {
    this.http.post<any>(`${BASE_URL}/api/auth/logout`, {}).subscribe({
      error: () => {},
    });
    this.currentUser.clear();
    localStorage.removeItem(this.LAST_RATING_CACHE_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.currentUser.getSnapshot()?.user_id && !!this.currentUser.getAccessToken();
  }

  getUserType(): string {
    return this.currentUser.getSnapshot()?.user_type || '';
  }

  isAdmin(): boolean {
    return this.getUserType() === 'Admin';
  }

  isSuperAdmin(): boolean {
    return this.getUserType() === 'Super Admin';
  }

  hasUserManagementAccess(): boolean {
    const userType = this.getUserType();
    return userType === 'Admin' || userType === 'Super Admin';
  }
}

