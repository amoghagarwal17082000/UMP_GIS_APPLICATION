import { environment } from '../../../environments/environment';
import { HttpParams } from '@angular/common/http';
import { getCurrentUserSnapshot } from '../../services/current-user.store';


export const BASE_URL = normalizeApiBase((environment as any).apiUrl || '');

function normalizeApiBase(url: string): string {
  const raw = String(url || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  return raw.endsWith('/api') ? raw.slice(0, -4) : raw;
}

function normalizeDivision(value: string): string {
  const raw = String(value || '').trim();
  if (raw.toLowerCase() === 'centre for railway information systems') {
    return 'DLI';
  }
  return raw;
}


export function getDivision(): string {
  return normalizeDivision(getCurrentUserSnapshot()?.division || localStorage.getItem('asset_division') || '');
}

export function hasDivision(): boolean {
  return getDivision().length > 0;
}

export function isPortalAdminUser(): boolean {
  const user = getCurrentUserSnapshot();
  const userId = String(user?.user_id || '').trim().toLowerCase();
  const userType = String(user?.user_type || '').trim().toLowerCase();
  return userId === 'portaladmin' || userType === 'portaladmin' || userType === 'portal admin';
}

export function emptyFeatureCollection(): { type: 'FeatureCollection'; features: any[] } {
  return { type: 'FeatureCollection', features: [] };
}

export function withDivision(params: Record<string, any>): HttpParams {
  let httpParams = new HttpParams().set('division', getDivision());
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    httpParams = httpParams.set(k, String(v));
  });
  return httpParams;
}

export function withAllIndia(params: Record<string, any> = {}): HttpParams {
  let httpParams = new HttpParams().set('allIndia', 'true');
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    httpParams = httpParams.set(k, String(v));
  });
  return httpParams;
}
