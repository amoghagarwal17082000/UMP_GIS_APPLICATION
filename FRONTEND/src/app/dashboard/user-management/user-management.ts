import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from 'src/app/services/api';

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
  searchText: string = '';
  activeRoleFilter: string = 'Total';

  pageSize = 12;
  currentPage = 1;

  makers: any[] = [];
checkers: any[] = [];

selectedMaker: any = null;
selectedChecker: any = null;

showAssignCheckerModal = false;

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
      next: (res) => {

        this.users = res || [];
        this.filteredUsers = [...this.users];

        this.calculateStats();

        this.cdr.detectChanges();

      },
      error: (err) => {
        console.error('Failed to load users', err);
      }
    });

  }

  searchUsers(): void {

    const term = this.searchText.toLowerCase().trim();

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

    this.activeRoleFilter = role;

    if (role === 'Total') {
      this.filteredUsers = [...this.users];
    } else {
      this.filteredUsers = this.users.filter(user => user.user_type === role);
    }

    this.currentPage = 1;

  }

  trackById(index: number, item: any) {
    return item.objectid;
  }

  get paginatedUsers() {

    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;

    return this.filteredUsers.slice(start, end);

  }

  get totalPages() {
    return Math.ceil(this.filteredUsers.length / this.pageSize);
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

    next: (res) => {

      this.makers = res.makers || [];
      this.checkers = res.checkers || [];

      this.cdr.detectChanges(); // ✅ force UI refresh

    },

    error: (err) => {
      console.error('Failed to load maker/checker list', err);
    }

  });

}

closeAssignCheckerModal() {
  this.showAssignCheckerModal = false;
}

assignChecker() {

  if (!this.selectedMaker || !this.selectedChecker) {
    alert("Please select Maker and Checker");
    return;
  }

  const payload = {
    maker_id: this.selectedMaker,
    checker_id: this.selectedChecker
  };

  this.api.assignChecker(payload).subscribe({

    next: (res) => {

      console.log("Checker assigned successfully", res);

      alert("Checker assigned successfully");

      this.closeAssignCheckerModal();

    },

    error: (err) => {
      console.error("Failed to assign checker", err);
      alert("Failed to assign checker");
    }

  });

}

}