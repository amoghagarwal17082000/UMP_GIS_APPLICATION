import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { CurrentUserService } from '../services/current-user';

export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const currentUser = inject(CurrentUserService);

  const user = await currentUser.loadMe(true);
  const ok = !!user?.user_id && !!user?.division && !!user?.user_type;

  if (ok) return true;

  const cleanReturnUrl = (state?.url || '').split('?')[0] || '/';

  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: cleanReturnUrl },
  });
};
