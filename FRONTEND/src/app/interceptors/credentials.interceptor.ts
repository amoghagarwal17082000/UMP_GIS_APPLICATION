import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { getAccessToken } from '../services/current-user.store';
import { CurrentUserService } from '../services/current-user';

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
        currentUser.clear();
        if (typeof window !== 'undefined' && !window.location.hash.includes('/login')) {
          window.location.hash = '#/login';
        }
      }
      return throwError(() => error);
    })
  );
};
