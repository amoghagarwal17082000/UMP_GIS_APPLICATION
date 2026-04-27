import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { getAccessToken } from '../services/current-user.store';
import { CurrentUserService } from '../services/current-user';

const LAST_AUTH_FAILURE_KEY = 'ump_last_auth_failure';

function isSessionAuthFailure(error: any): boolean {
  const message = String(
    error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      ''
  ).toLowerCase();

  return (
    message.includes('missing bearer token') ||
    message.includes('invalid or expired token') ||
    message.includes('token payload invalid') ||
    message.includes('session not found') ||
    message.includes('session expired') ||
    message.includes('please login again') ||
    message.includes('session replaced') ||
    message.includes('not authenticated')
  );
}

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const currentUser = inject(CurrentUserService);
  const token = getAccessToken();
  const isAuthRequest = req.url.includes('/api/auth/');
  const request = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : req;

  return next(request).pipe(
    catchError((error) => {
      if (error?.status === 401 && !isAuthRequest && token && isSessionAuthFailure(error)) {
        const reason = String(
          error?.error?.message ||
            error?.error?.error ||
            error?.message ||
            'Unauthorized'
        ).trim();

        if (typeof window !== 'undefined') {
          const details = {
            at: new Date().toISOString(),
            url: req.url,
            status: error?.status || 401,
            reason,
          };
          sessionStorage.setItem(LAST_AUTH_FAILURE_KEY, JSON.stringify(details));
          console.warn('[AUTH] Forced logout after API auth failure:', details);
        }

        currentUser.clear();
        if (typeof window !== 'undefined' && !window.location.hash.includes('/login')) {
          window.location.hash = '#/login';
        }
      }
      return throwError(() => error);
    })
  );
};
