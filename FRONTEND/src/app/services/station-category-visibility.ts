import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import {
  STATION_CATEGORY_GROUPS,
  STATION_CATEGORY_ORDER,
  type StationCategory,
  type StationCategoryGroup,
} from '../departments/civil_engineering_assets/viewing/station-category-config';

export type StationCategoryVisibilityState = Record<StationCategory, boolean>;

function buildDefaultVisibilityState(): StationCategoryVisibilityState {
  return STATION_CATEGORY_ORDER.reduce((acc, category) => {
    acc[category] = true;
    return acc;
  }, {} as StationCategoryVisibilityState);
}

@Injectable({ providedIn: 'root' })
export class StationCategoryVisibilityService {
  private readonly stateSubject = new BehaviorSubject<StationCategoryVisibilityState>(
    buildDefaultVisibilityState(),
  );

  readonly state$ = this.stateSubject.asObservable();

  getSnapshot(): StationCategoryVisibilityState {
    return this.stateSubject.getValue();
  }

  isCategoryVisible(category: StationCategory): boolean {
    return !!this.getSnapshot()[category];
  }

  setCategoryVisible(category: StationCategory, visible: boolean): void {
    const current = this.getSnapshot();
    if (current[category] === visible) return;

    this.stateSubject.next({
      ...current,
      [category]: visible,
    });
  }

  toggleCategory(category: StationCategory): void {
    this.setCategoryVisible(category, !this.isCategoryVisible(category));
  }

  setGroupVisible(group: StationCategoryGroup, visible: boolean): void {
    const categories =
      STATION_CATEGORY_GROUPS.find((item) => item.group === group)?.categories || [];

    if (!categories.length) return;

    const current = this.getSnapshot();
    const next: StationCategoryVisibilityState = { ...current };

    categories.forEach((category) => {
      next[category] = visible;
    });

    this.stateSubject.next(next);
  }

  isGroupFullyVisible(group: StationCategoryGroup): boolean {
    const categories =
      STATION_CATEGORY_GROUPS.find((item) => item.group === group)?.categories || [];

    if (!categories.length) return false;

    return categories.every((category) => this.isCategoryVisible(category));
  }

  isGroupPartiallyVisible(group: StationCategoryGroup): boolean {
    const categories =
      STATION_CATEGORY_GROUPS.find((item) => item.group === group)?.categories || [];

    if (!categories.length) return false;

    const visibleCount = categories.filter((category) => this.isCategoryVisible(category)).length;
    return visibleCount > 0 && visibleCount < categories.length;
  }

  isAnyCategoryVisible(): boolean {
    return STATION_CATEGORY_ORDER.some((category) => this.isCategoryVisible(category));
  }

  areAllCategoriesVisible(): boolean {
    return STATION_CATEGORY_ORDER.every((category) => this.isCategoryVisible(category));
  }

  setAllVisible(visible: boolean): void {
    const next = STATION_CATEGORY_ORDER.reduce((acc, category) => {
      acc[category] = visible;
      return acc;
    }, {} as StationCategoryVisibilityState);

    this.stateSubject.next(next);
  }

  reset(): void {
    this.stateSubject.next(buildDefaultVisibilityState());
  }
}
