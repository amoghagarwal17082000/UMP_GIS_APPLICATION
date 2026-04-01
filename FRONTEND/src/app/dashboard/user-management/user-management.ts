import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from 'src/app/api/api';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.html',
  styleUrl: './user-management.css'
})
export class UserManagementComponent implements OnInit {
  users: any[] = [];
  filteredUsers: any[] = [];

  assignedCheckerUsers: any[] = [];
  filteredAssignedCheckerUsers: any[] = [];

  searchText = '';
  activeRoleFilter = 'Total';
  activeTab: 'user-list' | 'assigned-layers' | 'assigned-checker' = 'user-list';

  pageSize = 12;
  currentPage = 1;

  makers: any[] = [];
  checkers: any[] = [];

  selectedMaker: any = null;
  selectedChecker: any = null;

  showAssignCheckerModal = false;
  showDeleteConfirmModal = false;
  selectedAssignedCheckerUser: any = null;

  showUserInfoModal = false;
  selectedUserInfo: any = null;

  stats = [
    { label: 'Total', value: 0 },
    { label: 'Admin', value: 0 },
    { label: 'Maker', value: 0 },
    { label: 'Checker', value: 0 },
    { label: 'Approver', value: 0 },
    { label: 'User', value: 0 }
  ];

  constructor(private api: Api, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.api.getUsers().subscribe({
      next: (res: any) => {
        this.users = res || [];
        this.filteredUsers = [...this.users];
        this.calculateStats();
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('Failed to load users', err);
      }
    });
  }

  loadAssignedCheckerUsers(): void {
    this.api.getAssignedCheckerUsers().subscribe({
      next: (res: any) => {
        this.assignedCheckerUsers = res || [];
        this.filteredAssignedCheckerUsers = [...this.assignedCheckerUsers];
        this.currentPage = 1;
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('Failed to load assigned checker users', err);
      }
    });
  }

  setActiveTab(tab: 'user-list' | 'assigned-layers' | 'assigned-checker') {
    this.activeTab = tab;
    this.searchText = '';
    this.currentPage = 1;

    if (tab === 'user-list') {
      this.filteredUsers = [...this.users];
    }

    if (tab === 'assigned-checker') {
      this.loadAssignedCheckerUsers();
    }
  }

  searchUsers(): void {
    const term = this.searchText.toLowerCase().trim();

    if (this.activeTab === 'assigned-checker') {
      if (!term) {
        this.filteredAssignedCheckerUsers = [...this.assignedCheckerUsers];
      } else {
        this.filteredAssignedCheckerUsers = this.assignedCheckerUsers.filter(user =>
          user.user_name?.toLowerCase().includes(term) ||
          user.user_type?.toLowerCase().includes(term) ||
          user.unit_type?.toLowerCase().includes(term) ||
          user.zone?.toLowerCase().includes(term) ||
          user.division?.toLowerCase().includes(term) ||
          user.department_id?.toLowerCase().includes(term) ||
          user.assigned_checker_name?.toLowerCase().includes(term)
        );
      }

      this.currentPage = 1;
      return;
    }

    if (!term) {
      this.filteredUsers = [...this.users];
    } else {
      this.filteredUsers = this.users.filter(user =>
        user.user_name?.toLowerCase().includes(term) ||
        user.user_type?.toLowerCase().includes(term) ||
        user.zone?.toLowerCase().includes(term) ||
        user.division?.toLowerCase().includes(term) ||
        user.designation?.toLowerCase().includes(term) ||
        user.hrmsid?.toLowerCase().includes(term)
      );
    }

    this.currentPage = 1;
  }

  calculateStats() {
    const counts: any = {
      Total: this.users.length,
      Admin: 0,
      Maker: 0,
      Checker: 0,
      Approver: 0,
      User: 0
    };

    this.users.forEach(user => {
      if (counts[user.user_type] !== undefined) {
        counts[user.user_type]++;
      }
    });

    this.stats = [
      { label: 'Total', value: counts.Total },
      { label: 'Admin', value: counts.Admin },
      { label: 'Maker', value: counts.Maker },
      { label: 'Checker', value: counts.Checker },
      { label: 'Approver', value: counts.Approver },
      { label: 'User', value: counts.User }
    ];
  }

  filterByRole(role: string) {
    this.activeTab = 'user-list';
    this.activeRoleFilter = role;
    this.searchText = '';
    this.currentPage = 1;

    if (role === 'Total') {
      this.filteredUsers = [...this.users];
    } else {
      this.filteredUsers = this.users.filter(
        user => user.user_type?.toLowerCase() === role.toLowerCase()
      );
    }

    this.cdr.detectChanges();
  }

  trackById(index: number, item: any) {
    return item.objectid;
  }

  get currentDataLength(): number {
    return this.activeTab === 'assigned-checker'
      ? this.filteredAssignedCheckerUsers.length
      : this.filteredUsers.length;
  }

  get paginatedUsers() {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;

    const source = this.activeTab === 'assigned-checker'
      ? this.filteredAssignedCheckerUsers
      : this.filteredUsers;

    return source.slice(start, end);
  }

  get totalPages() {
    return Math.ceil(this.currentDataLength / this.pageSize) || 1;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  openAssignCheckerModal() {
    this.showAssignCheckerModal = true;
    this.selectedMaker = null;
    this.selectedChecker = null;

    this.api.getMakerCheckerList().subscribe({
      next: (res: any) => {
        this.makers = res.makers || [];
        this.checkers = res.checkers || [];
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('Failed to load maker/checker list', err);
      }
    });
  }

  closeAssignCheckerModal() {
    this.showAssignCheckerModal = false;
    this.cdr.detectChanges();
  }

  assignChecker() {
    if (!this.selectedMaker || !this.selectedChecker) {
      alert('Please select Maker and Checker');
      return;
    }

    const payload = {
      maker_id: this.selectedMaker,
      checker_id: this.selectedChecker
    };

    this.api.assignChecker(payload).subscribe({
      next: (res: any) => {
        console.log('Checker assigned successfully', res);
        this.showAssignCheckerModal = false;
        this.selectedMaker = null;
        this.selectedChecker = null;
        this.cdr.detectChanges();

        if (this.activeTab === 'assigned-checker') {
          this.loadAssignedCheckerUsers();
        }

        alert('Checker assigned successfully');
      },
      error: (err: any) => {
        console.error('Failed to assign checker', err);
        alert('Failed to assign checker');
      }
    });
  }

  unassignChecker() {
    if (!this.selectedAssignedCheckerUser) {
      return;
    }

    const payload = {
      maker_id: this.selectedAssignedCheckerUser.objectid
    };

    this.api.unassignChecker(payload).subscribe({
      next: (res: any) => {
        console.log('Checker unassigned successfully', res);
        this.closeDeleteConfirmModal();
        this.loadAssignedCheckerUsers();
        alert('Checker unassigned successfully');
      },
      error: (err: any) => {
        console.error('Failed to unassign checker', err);
        alert('Failed to unassign checker');
      }
    });
  }

  openDeleteConfirmModal(user: any) {
    this.selectedAssignedCheckerUser = user;
    this.showDeleteConfirmModal = true;
    this.cdr.detectChanges();
  }

  closeDeleteConfirmModal() {
    this.showDeleteConfirmModal = false;
    this.selectedAssignedCheckerUser = null;
    this.cdr.detectChanges();
  }

  openUserInfoModal(user: any) {
    this.selectedUserInfo = user;
    this.showUserInfoModal = true;
    this.cdr.detectChanges();
  }

  closeUserInfoModal() {
    this.showUserInfoModal = false;
    this.selectedUserInfo = null;
    this.cdr.detectChanges();
  }
}
