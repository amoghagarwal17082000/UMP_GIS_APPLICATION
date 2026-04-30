import { Routes } from '@angular/router';
import { Login } from './components/login/login';
import { DashboardLayout } from './layouts/dashboard-layout/dashboard-layout';
import { authGuard } from './guards/auth-guard';
import { DashboardHome } from './dashboard/dashboard-home/dashboard-home';
import { GisDashboardComponent } from './dashboard/gis-dashboard/gis-dashboard';
import { UserManagementComponent } from './dashboard/user-management/divisional-admin/division-admin';
import { adminGuard } from './guards/admin-guard';
import { Feedback } from './dashboard/feedback/feedback';

import { superAdminGuard } from './guards/super-admin-guard';
import { SuperAdminUserManagementComponent } from './dashboard/user-management/super-admin/super-admin-user-management';
import { FileUploadComponent } from './dashboard/file-upload/file-upload';

import { ProfileComponent } from './dashboard/profile/profile';


export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  {
    path: 'dashboard',
    component: DashboardLayout,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        component: DashboardHome,
        data: { title: 'Dashboard' },
      },
      {
        path: 'railway-assets',
        component: GisDashboardComponent,
        data: { title: 'Railway Asset Editing' },
      },
      {
        path: 'user-management',
        component: UserManagementComponent,
        canActivate: [adminGuard],
        data: { title: 'User Management' },
      },
      {
        path: 'super-admin/user-management',
        component: SuperAdminUserManagementComponent,
        canActivate: [superAdminGuard],
        data: { title: 'User Management' },
      },

      {
        path: 'feedback',
        component: Feedback,
        data: { title: 'Feedback' },
      },
      {
        path: 'profile',
        component: ProfileComponent,
        data: { title: 'Profile' },
      },
      {
        path: 'file-upload',
        component: FileUploadComponent,
        data: { title: 'File Upload' },
      },
      {
        path: 'add-shapefile',
        redirectTo: 'file-upload',
      }
    ],
  },
  { path: '**', redirectTo: 'login' },
];
