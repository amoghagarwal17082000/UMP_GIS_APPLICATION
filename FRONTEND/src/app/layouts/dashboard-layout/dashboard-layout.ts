import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Observable } from 'rxjs';
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

  constructor(
    private sidebarState: SidebarState,
    private idleTimeout: IdleTimeoutService
  ) {
    this.collapsed$ = this.sidebarState.collapsed$;
  }

  ngOnInit(): void {
    this.idleTimeout.start();
  }

  ngOnDestroy(): void {
    this.idleTimeout.stop();
  }
}
