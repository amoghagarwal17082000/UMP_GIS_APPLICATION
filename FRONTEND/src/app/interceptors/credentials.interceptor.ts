import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { getAccessToken } from '../services/current-user.store';
import { CurrentUserService } from '../services/current-user';

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
      if (error?.status === 401 && !isAuthRequest) {
        currentUser.clear();
        if (typeof window !== 'undefined' && !window.location.hash.includes('/login')) {
          window.location.hash = '#/login';
        }
      }
      return throwError(() => error);
    })
  );
};
