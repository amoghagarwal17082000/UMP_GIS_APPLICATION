import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Api } from 'src/app/api/api';
import { CurrentUserService } from 'src/app/services/current-user';

type SuperAdminTab =
  | 'all'
  | 'super-admin'
  | 'zonal'
  | 'divisional'
  | 'board'
  | 'cris'
  | 'pu'
  | 'cti';

type SummaryCard = {
  label: string;
  unitType: string;
  counts: Array<{ role: string; value: number }>;
};

type TabConfig = {
  key: SuperAdminTab;
  label: string;
};

@Component({
  selector: 'app-super-admin-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './super-admin-user-management.html',
  styleUrl: './super-admin-user-management.css',
})
export class SuperAdminUserManagementComponent implements OnInit {
  users: any[] = [];
  loading = false;
  error = '';
  searchText = '';
  activeTab: SuperAdminTab = 'all';
  pageSize = 12;
  currentPage = 1;

  readonly tabs: TabConfig[] = [
    { key: 'all', label: 'User List' },
    { key: 'super-admin', label: 'Super Admin List' },
    { key: 'zonal', label: 'Zonal List' },
    { key: 'divisional', label: 'Divisional List' },
    { key: 'board', label: 'Board List' },
    { key: 'cris', label: 'CRIS List' },
    { key: 'pu', label: 'PU List' },
    { key: 'cti', label: 'CTI List' },
  ];

  constructor(
    private api: Api,
    private currentUser: CurrentUserService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  get currentUserName(): string {
    return this.currentUser.getSnapshot()?.user_name || 'Super Admin';
  }

  get currentUserRole(): string {
    return this.currentUser.getSnapshot()?.user_type || 'Super Admin';
  }

  get totalUsers(): number {
    return this.users.length;
  }

  get superAdminCount(): number {
    return this.users.filter((user) => this.normalizeText(user.user_type) === 'super admin').length;
  }

  get filteredUsers(): any[] {
    const term = this.normalizeText(this.searchText);

    return this.users.filter((user) => {
      if (!this.matchesTab(user)) return false;
      if (!term) return true;

      return [
        user.user_name,
        user.user_type,
        user.unit_type,
        user.unit_name,
        user.zone,
        user.division,
        user.department_id,
        user.hrmsid,
        user.designation,
        user.user_id,
      ].some((value) => this.normalizeText(value).includes(term));
    });
  }

  get paginatedUsers(): any[] {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredUsers.slice(start, end);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredUsers.length / this.pageSize) || 1;
  }

  get summaryCards(): SummaryCard[] {
    const unitTypes = ['Zonal', 'Divisional', 'Board', 'CRIS', 'PU', 'CTI'];

    return unitTypes
      .map((unitType) => this.buildSummaryCard(unitType))
      .filter((card) => card.counts.some((item) => item.value > 0));
  }

  trackByUser(index: number, user: any) {
    return user.objectid || user.user_id || index;
  }

  setActiveTab(tab: SuperAdminTab): void {
    this.activeTab = tab;
    this.currentPage = 1;
  }

  onSearchChange(): void {
    this.currentPage = 1;
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  loadUsers(): void {
    this.loading = true;
    this.error = '';
    this.cdr.detectChanges();

    this.api.getSuperAdminUsers().subscribe({
      next: (res) => {
        this.users = res || [];
        this.currentPage = 1;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load super admin users', err);
        this.error = 'Failed to load users';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  private matchesTab(user: any): boolean {
    const userType = this.normalizeText(user.user_type);
    const unitType = this.normalizeUnitType(user.unit_type);

    switch (this.activeTab) {
      case 'super-admin':
        return userType === 'super admin';
      case 'zonal':
        return unitType === 'zonal';
      case 'divisional':
        return unitType === 'divisional';
      case 'board':
        return unitType === 'board';
      case 'cris':
        return unitType === 'cris';
      case 'pu':
        return unitType === 'pu';
      case 'cti':
        return unitType === 'cti';
      default:
        return true;
    }
  }

  private buildSummaryCard(unitType: string): SummaryCard {
    const users = this.users.filter(
      (user) => this.normalizeUnitType(user.unit_type) === this.normalizeUnitType(unitType),
    );

    return {
      label: this.getSummaryLabel(unitType),
      unitType,
      counts: [
        { role: 'Admin', value: this.countRole(users, 'Admin') },
        { role: 'Users', value: this.countRole(users, 'User') },
        { role: 'Maker', value: this.countRole(users, 'Maker') },
        { role: 'Checker', value: this.countRole(users, 'Checker') },
        { role: 'Approver', value: this.countRole(users, 'Approver') },
      ].filter((item) => item.value > 0),
    };
  }

  private countRole(users: any[], role: string): number {
    return users.filter((user) => this.normalizeText(user.user_type) === this.normalizeText(role))
      .length;
  }

  private getSummaryLabel(unitType: string): string {
    return unitType === 'PU' ? 'PUs' : unitType;
  }

  private normalizeText(value: any): string {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  private normalizeUnitType(value: any): string {
    const normalized = this.normalizeText(value);
    return normalized === 'pus' ? 'pu' : normalized;
  }
}
