import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Api } from 'src/app/api/api';

@Component({
  selector: 'app-super-admin-user-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './super-admin-user-management.html',
  styleUrl: './super-admin-user-management.css',
})
export class SuperAdminUserManagementComponent implements OnInit {
  users: any[] = [];
  loading = false;
  error = '';

  constructor(private api: Api) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading = true;
    this.error = '';

    this.api.getSuperAdminUsers().subscribe({
      next: (res) => {
        this.users = res || [];
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load super admin users', err);
        this.error = 'Failed to load users';
        this.loading = false;
      },
    });
  }
}
