import { HttpParams } from '@angular/common/http';
import { getCurrentUserSnapshot } from '../../services/current-user.store';

export const BASE_URL = '';

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
