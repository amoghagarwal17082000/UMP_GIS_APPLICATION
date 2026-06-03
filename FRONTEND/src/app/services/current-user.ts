import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { BASE_URL } from '../api/shared/api-utils';
import {
  clearAccessToken,
  clearCurrentUserSnapshot,
  CurrentUser,
  getCurrentUserSnapshot,
  setAccessToken,
  setCurrentUserSnapshot,
} from './current-user.store';

@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private readonly userSubject = new BehaviorSubject<CurrentUser | null>(getCurrentUserSnapshot());
  readonly user$ = this.userSubject.asObservable();

  private loadPromise: Promise<CurrentUser | null> | null = null;

  constructor(private http: HttpClient) {}

  private normalizeDivision(value: any): string {
    const raw = String(value || '').trim();
    const normalized = raw.toLowerCase();
    if (
      normalized === 'centre for railway information systems' ||
      normalized === 'delhi' ||
      normalized === 'delhi division'
    ) {
      return 'DLI';
    }
    return raw;
  }

  getSnapshot(): CurrentUser | null {
    return this.userSubject.getValue();
  }

  getAccessToken(): string {
    return '';
  }

  setUser(user: CurrentUser | null): void {
    const normalized = this.normalizeUser(user as any);
    setCurrentUserSnapshot(normalized);
    this.userSubject.next(normalized);
  }

  setAuth(user: CurrentUser | null, token: string | null): void {
    setAccessToken(null);
    this.setUser(user);
  }

  clear(): void {
    clearAccessToken();
    clearCurrentUserSnapshot();
    this.userSubject.next(null);
  }

  async loadMe(force = false): Promise<CurrentUser | null> {
    if (!force) {
      const current = this.getSnapshot();
      if (current) return current;
      if (this.loadPromise) return this.loadPromise;
    }

    this.loadPromise = firstValueFrom(
      this.http.get<any>(`${BASE_URL}/api/auth/me`).pipe(
        map((res) => this.normalizeUser(res?.user)),
        catchError((error: any) => of(this.isExpiredSessionError(error) ? null : undefined as any))
      )
    ).then((user) => {
      if (user === undefined) {
        this.loadPromise = null;
        return this.getSnapshot();
      }

      if (!user) {
        this.clear();
      } else {
        this.setUser(user);
      }
      this.loadPromise = null;
      return user;
    });

    return this.loadPromise;
  }

  private isExpiredSessionError(error: any): boolean {
    if (error?.status !== 401) return false;

    const message = String(
      error?.error?.message ||
        error?.error?.error ||
        error?.message ||
        ''
    ).toLowerCase();

    return (
      message.includes('missing authentication token') ||
      message.includes('invalid or expired token') ||
      message.includes('token payload invalid') ||
      message.includes('session not found') ||
      message.includes('session expired') ||
      message.includes('session invalid') ||
      message.includes('not authenticated')
    );
  }

  private normalizeUser(user: any): CurrentUser | null {
    if (!user?.user_id) return null;

    return {
      user_id: String(user.user_id || '').trim(),
      user_name: String(user.user_name || '').trim(),
      railway: String(user.railway || '').trim(),
      division: this.normalizeDivision(user.division),
      actualDivision: String(user.actualDivision || user.actual_division || user.division || '').trim(),
      department: String(user.department || '').trim(),
      user_type: String(user.user_type || '').trim(),
      unit_type: String(user.unit_type || '').trim(),
      email: String(user.email || '').trim(),
      mobile: String(user.mobile || '').trim(),
      hrmsid: String(user.hrmsid || '').trim(),
      designation: String(user.designation || '').trim(),
    };
  }
}
