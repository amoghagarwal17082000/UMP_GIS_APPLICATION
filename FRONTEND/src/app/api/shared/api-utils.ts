import { environment } from '../../../environments/environment';
import { HttpParams } from '@angular/common/http';
import { getCurrentUserSnapshot } from '../../services/current-user.store';


function normalizeApiBase(url: string): string {
  const raw = String(url || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  return raw.endsWith('/api') ? raw.slice(0, -4) : raw;
}

export const BASE_URL = normalizeApiBase((environment as any).apiUrl || '');


export function getDivision(): string {
  return (getCurrentUserSnapshot()?.division || '').trim();
}

export function withDivision(params: Record<string, any>): HttpParams {
  let httpParams = new HttpParams().set('division', getDivision());
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    httpParams = httpParams.set(k, String(v));
  });
  return httpParams;
}
