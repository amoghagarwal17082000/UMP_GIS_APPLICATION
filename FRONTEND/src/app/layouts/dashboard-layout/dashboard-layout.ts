import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SidebarState } from 'src/app/services/sidebar-state';
import { DashboardTopbar } from 'src/app/components/dashboard-topbar/dashboard-topbar';
import { Sidebar } from '../sidebar/sidebar';
import { DashboardPageHeader } from '../dashboard-page-header/dashboard-page-header';
import { IdleTimeoutService } from 'src/app/services/idle-timeout';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, DashboardTopbar, Sidebar, DashboardPageHeader],
  templateUrl: './dashboard-layout.html',
  styleUrl: './dashboard-layout.css',
})
export class DashboardLayout implements OnInit, OnDestroy {
  collapsed$: Observable<boolean>;
  isGisRoute = false;
  private routeSub?: Subscription;

  constructor(
    private sidebarState: SidebarState,
    private idleTimeout: IdleTimeoutService,
    private router: Router
  ) {
    this.collapsed$ = this.sidebarState.collapsed$;
  }

  ngOnInit(): void {
    this.idleTimeout.start();
    this.updateRouteFlags(this.router.url || '');
    this.routeSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.updateRouteFlags(event.urlAfterRedirects || event.url || '');
      });
  }

  ngOnDestroy(): void {
    this.idleTimeout.stop();
    this.routeSub?.unsubscribe();
    this.routeSub = undefined;
  }

  private updateRouteFlags(url: string): void {
    const normalized = (url || '').toLowerCase();
    this.isGisRoute = normalized.includes('/dashboard/railway-assets');
  }
}
