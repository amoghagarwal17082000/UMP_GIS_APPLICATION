import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { Api } from 'src/app/api/api';

import { Auth } from 'src/app/services/auth';
import { CurrentUserService } from 'src/app/services/current-user';
import { SidebarState } from 'src/app/services/sidebar-state';

@Component({
  selector: 'app-dashboard-topbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-topbar.html',
  styleUrl: './dashboard-topbar.css',
})
export class DashboardTopbar implements OnInit, OnDestroy {
  private readonly LAST_RATING_CACHE_KEY = 'last_rating_at';
  private readonly RATING_DUE_DAYS = 30;

  userName = 'User';
  profileImage = 'assets/images/user.png';
  showMenu = false;

  stars = [1, 2, 3, 4, 5];
  showModal = false;
  selectedRating = 0;
  message = '';
  user_id = '';

  collapsed$!: Observable<boolean>;
  private userSub?: Subscription;

  constructor(
    private auth: Auth,
    private router: Router,
    private sidebarState: SidebarState,
    private api: Api,
    private currentUser: CurrentUserService
  ) {
    this.collapsed$ = this.sidebarState.collapsed$;
  }

  ngOnInit(): void {
    this.userSub = this.currentUser.user$.subscribe((user) => {
      this.userName = user?.user_name || 'User';
      this.user_id = user?.user_id || '';
    });
    this.primeRatingCache();
  }

  toggleSidebar() {
    this.sidebarState.toggle();
  }

  toggleMenu() {
    this.showMenu = !this.showMenu;
  }

  onImageError(event: Event) {
    (event.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=' + this.userName;
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  openModal() {
    this.showModal = true;
  }

  ngOnDestroy(): void {
    this.showModal = false;
    this.userSub?.unsubscribe();
  }

  closeModal() {
    this.selectedRating = 0;
    this.message = '';
    this.showModal = false;
  }

  setRating(rating: number) {
    this.selectedRating = rating;
  }

  checkRatingBeforeLogout() {
    if (!this.user_id) {
      this.logout();
      return;
    }

    const cachedLastRatingAt = this.getCachedLastRatingAt();
    if (cachedLastRatingAt && !this.isRatingDue(cachedLastRatingAt)) {
      this.logout();
      return;
    }

    if (this.ratingData?.created_at && !this.isRatingDue(this.ratingData.created_at)) {
      this.setCachedLastRatingAt(this.ratingData.created_at);
      this.logout();
      return;
    }

    this.openModal();
  }

  addRating() {
    if (!this.user_id) {
      console.error('Missing authenticated user for rating submit');
      return;
    }

    const data = {
      rating: this.selectedRating,
      comment: this.message,
    };

    this.api.rating(data).subscribe({
      next: (res: any) => {
        const createdAt = res?.data?.created_at || new Date().toISOString();
        this.setCachedLastRatingAt(createdAt);
        this.closeModal();
        this.logout();
      },
      error: (err) => {
        console.error('Error adding rating', err);
      },
    });
  }

  ratingData: any;

  private primeRatingCache() {
    if (!this.user_id) return;

    this.api.getRating({}).subscribe({
      next: (res: any) => {
        this.ratingData = res?.data || null;
        if (this.ratingData?.created_at) {
          this.setCachedLastRatingAt(this.ratingData.created_at);
        }
      },
      error: () => {},
    });
  }

  private getCachedLastRatingAt(): string {
    return (localStorage.getItem(this.LAST_RATING_CACHE_KEY) || '').trim();
  }

  private setCachedLastRatingAt(value: string) {
    if (!value) return;
    localStorage.setItem(this.LAST_RATING_CACHE_KEY, value);
  }

  private isRatingDue(lastRatedAt: string): boolean {
    const parsed = new Date(lastRatedAt);
    if (Number.isNaN(parsed.getTime())) return true;

    const now = new Date();
    const diffInDays = (now.getTime() - parsed.getTime()) / (1000 * 3600 * 24);
    return diffInDays > this.RATING_DUE_DAYS;
  }
}
