import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from 'src/app/api/api';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.html',
  styleUrl: './user-management.css',
})
export class UserManagementComponent implements OnInit {
  toastMessage = '';
  toastType: 'success' | 'error' | 'warning' = 'success';
  showToast = false;
  private toastTimeoutId: ReturnType<typeof setTimeout> | null = null;

  users: any[] = [];
  filteredUsers: any[] = [];

  assignedCheckerUsers: any[] = [];
  filteredAssignedCheckerUsers: any[] = [];

  searchText: string = '';
  activeRoleFilter: string = 'Total';
  activeTab: 'user-list' | 'assigned-layers' | 'assigned-checker' = 'user-list';

  pageSize = 12;
  currentPage = 1;

  makers: any[] = [];
  checkers: any[] = [];

  selectedMaker: any = null;
  selectedChecker: any = null;

  showAssignCheckerModal = false;

  showAssignLayerModal = false;
  layerMakers: any[] = [];
  availableLayers: any[] = [];
  selectedLayerMaker: any = null;
  selectedLayerDepartmentId: string = '';
  selectedLayerIds: any[] = [];
  selectedLayerObjects: any[] = [];

  showDeleteConfirmModal = false;
  selectedAssignedCheckerUser: any = null;

  showUserInfoModal = false;
  selectedUserInfo: any = null;

  showChangeCheckerModal = false;
  selectedCheckerAssignmentUser: any = null;
  updatedCheckerId: any = null;

  showEditUserModal = false;
  showEditConfirmModal = false;
  showPassword = false;

  assignedLayerUsers: any[] = [];
  filteredAssignedLayerUsers: any[] = [];

  showAssignedLayerDeleteConfirmModal = false;
  selectedAssignedLayerUser: any = null;
  isAssignLayerEditMode = false;

  noAssignableLayers = false;

  editUserForm: any = {
    objectid: null,
    user_name: '',
    user_id: '',
    password: '',
    zone: '',
    division: '',
    department_id: '',
  };

  passwordError = '';
  editUserError = '';

  stats = [
    { label: 'Total', value: 0 },
    { label: 'Admin', value: 0 },
    { label: 'Maker', value: 0 },
    { label: 'Checker', value: 0 },
    { label: 'Approver', value: 0 },
    { label: 'User', value: 0 },
  ];

  constructor(
    private api: Api,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  showNotification(message: string, type: 'success' | 'error' | 'warning' = 'success') {
    this.toastMessage = message;
    this.toastType = type;
    this.showToast = true;

    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
    }

    this.toastTimeoutId = setTimeout(() => {
      this.showToast = false;
      this.cdr.detectChanges();
    }, 1900);

    this.cdr.detectChanges();
  }

  closeToast() {
    this.showToast = false;

    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }

    this.cdr.detectChanges();
  }

  loadUsers(): void {
    this.api.getUsers().subscribe({
      next: (res) => {
        this.users = res || [];
        this.filteredUsers = [...this.users];
        this.calculateStats();
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('Failed to load users', err);
      },
    });
  }

  loadAssignedCheckerUsers(): void {
    this.api.getAssignedCheckerUsers().subscribe({
      next: (res) => {
        this.assignedCheckerUsers = res || [];
        this.filteredAssignedCheckerUsers = [...this.assignedCheckerUsers];
        this.currentPage = 1;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load assigned checker users', err);
      },
    });
  }

  setActiveTab(tab: 'user-list' | 'assigned-layers' | 'assigned-checker') {
    this.activeTab = tab;
    this.searchText = '';
    this.currentPage = 1;

    if (tab === 'user-list') {
      this.filteredUsers = [...this.users];
    }

    if (tab === 'assigned-layers') {
      this.loadAssignedLayerUsers();
    }

    if (tab === 'assigned-checker') {
      this.loadAssignedCheckerUsers();
    }
  }

  searchUsers(): void {
    const term = this.searchText.toLowerCase().trim();

    if (this.activeTab === 'assigned-layers') {
      if (!term) {
        this.filteredAssignedLayerUsers = [...this.assignedLayerUsers];
      } else {
        this.filteredAssignedLayerUsers = this.assignedLayerUsers.filter(
          (user) =>
            user.user_name?.toLowerCase().includes(term) ||
            user.user_type?.toLowerCase().includes(term) ||
            user.unit_type?.toLowerCase().includes(term) ||
            user.zone?.toLowerCase().includes(term) ||
            user.division?.toLowerCase().includes(term) ||
            user.department_id?.toLowerCase().includes(term) ||
            user.assigned_layer_names?.toLowerCase().includes(term),
        );
      }

      this.currentPage = 1;
      return;
    }

    if (this.activeTab === 'assigned-checker') {
      if (!term) {
        this.filteredAssignedCheckerUsers = [...this.assignedCheckerUsers];
      } else {
        this.filteredAssignedCheckerUsers = this.assignedCheckerUsers.filter(
          (user) =>
            user.user_name?.toLowerCase().includes(term) ||
            user.user_type?.toLowerCase().includes(term) ||
            user.unit_type?.toLowerCase().includes(term) ||
            user.zone?.toLowerCase().includes(term) ||
            user.division?.toLowerCase().includes(term) ||
            user.department_id?.toLowerCase().includes(term) ||
            user.assigned_checker_name?.toLowerCase().includes(term),
        );
      }

      this.currentPage = 1;
      return;
    }

    if (!term) {
      this.filteredUsers = [...this.users];
    } else {
      this.filteredUsers = this.users.filter(
        (user) =>
          user.user_name?.toLowerCase().includes(term) ||
          user.user_type?.toLowerCase().includes(term) ||
          user.zone?.toLowerCase().includes(term) ||
          user.division?.toLowerCase().includes(term) ||
          user.designation?.toLowerCase().includes(term) ||
          user.hrmsid?.toLowerCase().includes(term) ||
          user.user_id?.toLowerCase().includes(term),
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
      User: 0,
    };

    this.users.forEach((user) => {
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
      { label: 'User', value: counts.User },
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
        (user) => user.user_type?.toLowerCase() === role.toLowerCase(),
      );
    }

    this.cdr.detectChanges();
  }

  trackById(index: number, item: any) {
    return item.objectid;
  }

  get currentDataLength(): number {
    if (this.activeTab === 'assigned-layers') {
      return this.filteredAssignedLayerUsers.length;
    }

    return this.activeTab === 'assigned-checker'
      ? this.filteredAssignedCheckerUsers.length
      : this.filteredUsers.length;
  }

  get paginatedUsers() {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;

    let source = this.filteredUsers;

    if (this.activeTab === 'assigned-layers') {
      source = this.filteredAssignedLayerUsers;
    }

    if (this.activeTab === 'assigned-checker') {
      source = this.filteredAssignedCheckerUsers;
    }

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
      next: (res) => {
        this.makers = res.makers || [];
        this.checkers = res.checkers || [];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load maker/checker list', err);
      },
    });
  }

  closeAssignCheckerModal() {
    this.showAssignCheckerModal = false;
    this.cdr.detectChanges();
  }

  assignChecker() {
    if (this.selectedMaker == null || this.selectedChecker == null) {
      this.showNotification('Please select Maker and Checker', 'warning');
      return;
    }

    const payload = {
      maker_id: this.selectedMaker,
      checker_id: this.selectedChecker,
    };

    this.api.assignChecker(payload).subscribe({
      next: (res) => {
        console.log('Checker assigned successfully', res);

        this.showAssignCheckerModal = false;
        this.selectedMaker = null;
        this.selectedChecker = null;
        this.cdr.detectChanges();

        if (this.activeTab === 'assigned-checker') {
          this.loadAssignedCheckerUsers();
        }

        this.showNotification('Checker assigned successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to assign checker', err);
        this.showNotification('Failed to assign checker', 'error');
      },
    });
  }

  openAssignLayerModal(user?: any) {
    this.showAssignLayerModal = true;
    this.selectedLayerMaker = null;
    this.selectedLayerDepartmentId = '';
    this.selectedLayerIds = [];
    this.selectedLayerObjects = [];
    this.availableLayers = [];
    this.noAssignableLayers = false;
    this.isAssignLayerEditMode = !!user;

    this.api.getMakerLayerList().subscribe({
      next: (res) => {
        this.layerMakers = res.makers || [];

        if (user) {
          this.selectedLayerMaker = user.objectid;
          this.onLayerMakerChange();
        }

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load maker list for layer assignment', err);
      },
    });
  }

  loadSelectedMakerAssignedLayers() {
    const selectedMakerObj = this.layerMakers.find(
      (maker) => String(maker.objectid) === String(this.selectedLayerMaker),
    );

    const existingAssignedIds = String(selectedMakerObj?.assigned_layers || '')
      .split(',')
      .map((id: string) => id.trim())
      .filter((id: string) => id);

    this.selectedLayerIds = [...existingAssignedIds];

    this.selectedLayerObjects = this.availableLayers.filter((layer) =>
      existingAssignedIds.includes(String(layer.layer_id)),
    );
  }

  closeAssignLayerModal() {
    this.showAssignLayerModal = false;
    this.selectedLayerMaker = null;
    this.selectedLayerDepartmentId = '';
    this.selectedLayerIds = [];
    this.selectedLayerObjects = [];
    this.availableLayers = [];
    this.noAssignableLayers = false;
    this.isAssignLayerEditMode = false;
    this.cdr.detectChanges();
  }

  formatLayerName(name: string): string {
    return String(name || '')
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  formatAssignedLayerNames(layerNames: string): string {
    return String(layerNames || '')
      .split(',')
      .map((name) => this.formatLayerName(name.trim()))
      .filter(Boolean)
      .join(', ');
  }

  onLayerMakerChange() {
    this.selectedLayerIds = [];
    this.selectedLayerObjects = [];
    this.availableLayers = [];
    this.noAssignableLayers = false;

    const selectedMakerObj = this.layerMakers.find(
      (maker) => String(maker.objectid) === String(this.selectedLayerMaker),
    );

    this.selectedLayerDepartmentId = selectedMakerObj?.department_id || '';

    if (!this.selectedLayerDepartmentId) {
      this.noAssignableLayers = true;
      return;
    }

    this.api.getDepartmentLayers(this.selectedLayerDepartmentId).subscribe({
      next: (res) => {
        this.availableLayers = (res || []).filter(
          (layer: any) =>
            layer.layer_id !== null &&
            layer.layer_id !== undefined &&
            String(layer.layer_id).trim() !== '',
        );

        this.noAssignableLayers = this.availableLayers.length === 0;

        this.loadSelectedMakerAssignedLayers();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load department layers', err);
        this.noAssignableLayers = true;
      },
    });
  }

  onLayerSelectionChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedIds = Array.from(select.selectedOptions).map((option) => String(option.value));

    if (!selectedIds.length) {
      return;
    }

    const existingIds = this.selectedLayerIds.map((id) => String(id));
    const mergedIds = [...new Set([...existingIds, ...selectedIds])];

    this.selectedLayerIds = mergedIds;

    this.selectedLayerObjects = this.availableLayers.filter((layer) =>
      mergedIds.includes(String(layer.layer_id)),
    );

    Array.from(select.options).forEach((option) => {
      option.selected = false;
    });

    this.cdr.detectChanges();
  }

  removeSelectedLayer(layerId: any) {
    this.selectedLayerIds = this.selectedLayerIds.filter((id) => String(id) !== String(layerId));

    this.selectedLayerObjects = this.selectedLayerObjects.filter(
      (layer) => String(layer.layer_id) !== String(layerId),
    );

    this.cdr.detectChanges();
  }

  isLayerSelected(layerId: any): boolean {
    return this.selectedLayerIds.some((id) => String(id) === String(layerId));
  }

  assignLayersToMaker() {
    if (!this.selectedLayerMaker) {
      this.showNotification('Please select Maker', 'warning');
      return;
    }

    if (this.noAssignableLayers) {
      this.showNotification('No assignable layers are configured for this department', 'warning');
      return;
    }

    if (!this.selectedLayerIds || this.selectedLayerIds.length === 0) {
      this.showNotification('Please select at least one layer', 'warning');
      return;
    }

    const payload = {
      maker_id: this.selectedLayerMaker,
      layer_ids: this.selectedLayerIds,
    };

    this.api.assignLayers(payload).subscribe({
      next: (res) => {
        console.log('Layers assigned successfully', res);
        this.closeAssignLayerModal();

        this.loadUsers();
        this.loadAssignedLayerUsers();

        this.showNotification('Layers assigned successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to assign layers', err);
        this.showNotification('Failed to assign layers', 'error');
      },
    });
  }

  openChangeCheckerModal(user: any) {
    this.selectedCheckerAssignmentUser = user;
    this.updatedCheckerId = null;
    this.showChangeCheckerModal = true;

    this.api.getMakerCheckerList().subscribe({
      next: (res) => {
        this.checkers = res.checkers || [];

        const matchedChecker = this.checkers.find(
          (checker: any) => checker.user_name === user.assigned_checker_name,
        );

        this.updatedCheckerId = matchedChecker ? matchedChecker.objectid : null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load checker list', err);
      },
    });
  }

  closeChangeCheckerModal() {
    this.showChangeCheckerModal = false;
    this.selectedCheckerAssignmentUser = null;
    this.updatedCheckerId = null;
    this.cdr.detectChanges();
  }

  updateAssignedChecker() {
    if (!this.selectedCheckerAssignmentUser || !this.updatedCheckerId) {
      this.showNotification('Please select a checker', 'warning');
      return;
    }

    const payload = {
      maker_id: this.selectedCheckerAssignmentUser.objectid,
      checker_id: this.updatedCheckerId,
    };

    this.api.assignChecker(payload).subscribe({
      next: (res) => {
        console.log('Checker updated successfully', res);
        this.closeChangeCheckerModal();
        this.loadAssignedCheckerUsers();
        this.showNotification('Checker updated successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to update checker', err);
        this.showNotification('Failed to update checker', 'error');
      },
    });
  }

  unassignChecker() {
    if (!this.selectedAssignedCheckerUser) {
      return;
    }

    const payload = {
      maker_id: this.selectedAssignedCheckerUser.objectid,
    };

    this.api.unassignChecker(payload).subscribe({
      next: (res) => {
        console.log('Checker unassigned successfully', res);
        this.closeDeleteConfirmModal();
        this.loadAssignedCheckerUsers();
        this.showNotification('Checker unassigned successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to unassign checker', err);
        this.showNotification('Failed to unassign checker', 'error');
      },
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

  openEditUserModal(user: any) {
    this.editUserForm = {
      objectid: user.objectid,
      user_name: user.user_name || '',
      user_id: user.user_id || '',
      password: '',
      zone: user.zone || '',
      division: user.division || '',
      department_id: user.department_id || '',
    };

    this.passwordError = '';
    this.editUserError = '';
    this.showPassword = false;
    this.showEditUserModal = true;
    this.cdr.detectChanges();
  }

  closeEditUserModal() {
    this.showEditUserModal = false;
    this.passwordError = '';
    this.editUserError = '';
    this.showPassword = false;
    this.cdr.detectChanges();
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  openEditConfirmModal() {
    this.editUserError = '';
    this.passwordError = '';

    if (!this.editUserForm.user_name?.trim()) {
      this.editUserError = 'User Name is required';
      return;
    }

    if (!this.editUserForm.user_id?.trim()) {
      this.editUserError = 'User ID is required';
      return;
    }

    this.showEditConfirmModal = true;
    this.cdr.detectChanges();
  }

  closeEditConfirmModal() {
    this.showEditConfirmModal = false;
    this.cdr.detectChanges();
  }

  updateUserDetails() {
    const payload = {
      objectid: this.editUserForm.objectid,
      user_name: this.editUserForm.user_name.trim(),
      password: this.editUserForm.password,
    };

    this.showEditConfirmModal = false;
    this.showEditUserModal = false;
    this.cdr.detectChanges();

    this.api.updateUserDetails(payload).subscribe({
      next: (res) => {
        this.loadUsers();
        if (this.activeTab === 'assigned-checker') {
          this.loadAssignedCheckerUsers();
        }

        this.showNotification('User updated successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to update user', err);
        this.showEditUserModal = true;
        this.editUserError = 'Failed to update user';
        this.showNotification('Failed to update user', 'error');
        this.cdr.detectChanges();
      },
    });
  }

  loadAssignedLayerUsers(): void {
    this.api.getAssignedLayerUsers().subscribe({
      next: (res) => {
        this.assignedLayerUsers = res || [];
        this.filteredAssignedLayerUsers = [...this.assignedLayerUsers];
        this.currentPage = 1;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load assigned layer users', err);
      },
    });
  }

  updateAssignedLayersForMaker() {
    if (!this.selectedLayerMaker) {
      this.showNotification('Please select Maker', 'warning');
      return;
    }

    if (this.noAssignableLayers) {
      this.showNotification('No assignable layers are configured for this department', 'warning');
      return;
    }

    const payload = {
      maker_id: this.selectedLayerMaker,
      layer_ids: this.selectedLayerIds,
    };

    this.api.updateAssignedLayers(payload).subscribe({
      next: (res) => {
        console.log('Assigned layers updated successfully', res);
        this.closeAssignLayerModal();
        this.loadAssignedLayerUsers();
        this.loadUsers();
        this.showNotification('Assigned layers updated successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to update assigned layers', err);
        this.showNotification('Failed to update assigned layers', 'error');
      },
    });
  }

  openAssignedLayerDeleteConfirmModal(user: any) {
    this.selectedAssignedLayerUser = user;
    this.showAssignedLayerDeleteConfirmModal = true;
    this.cdr.detectChanges();
  }

  closeAssignedLayerDeleteConfirmModal() {
    this.showAssignedLayerDeleteConfirmModal = false;
    this.selectedAssignedLayerUser = null;
    this.cdr.detectChanges();
  }

  removeAllAssignedLayers() {
    if (!this.selectedAssignedLayerUser) {
      return;
    }

    const payload = {
      maker_id: this.selectedAssignedLayerUser.objectid,
    };

    this.api.clearAssignedLayers(payload).subscribe({
      next: (res) => {
        console.log('Assigned layers removed successfully', res);
        this.closeAssignedLayerDeleteConfirmModal();
        this.loadAssignedLayerUsers();
        this.loadUsers();
        this.showNotification('Assigned layers removed successfully', 'success');
      },
      error: (err) => {
        console.error('Failed to remove assigned layers', err);
        this.showNotification('Failed to remove assigned layers', 'error');
      },
    });
  }
}
