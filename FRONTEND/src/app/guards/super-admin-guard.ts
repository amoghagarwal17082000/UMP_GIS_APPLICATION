import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { CurrentUserService } from '../services/current-user';

export const superAdminGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const currentUser = inject(CurrentUserService);

  const user = await currentUser.loadMe(true);

  if (user?.user_type === 'Super Admin') {
    return true;
  }

  return router.createUrlTree(['/dashboard']);
};
