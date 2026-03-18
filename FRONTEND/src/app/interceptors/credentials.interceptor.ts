import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import {
  clearAccessToken,
  clearCurrentUserSnapshot,
  getAccessToken,
} from '../services/current-user.store';

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
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
        clearAccessToken();
        clearCurrentUserSnapshot();
        if (typeof window !== 'undefined' && !window.location.hash.includes('/login')) {
          window.location.hash = '#/login';
        }
      }
      return throwError(() => error);
    })
  );
};
