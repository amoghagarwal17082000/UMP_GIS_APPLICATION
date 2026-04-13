import { Component, OnDestroy, OnInit, Output, EventEmitter, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, map, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { SearchResult, Station, StationService } from '../../services/station.service';

@Component({
  selector: 'app-station-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './station-search.component.html',
  styleUrl: './station-search.component.css'
})
export class StationSearchComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @Output() stationSelected = new EventEmitter<Station>();
  @Output() searchCleared = new EventEmitter<void>();

  searchControl = new FormControl('');
  searchResults: SearchResult[] = [];
  showResults = false;
  isLoading = false;
  selectedIndex = -1;
  private destroy$ = new Subject<void>();

  constructor(private stationService: StationService) {}

  ngOnInit(): void {
    this.setupSearch();
    void this.stationService.ensureLoaded();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupSearch(): void {
    this.searchControl.valueChanges
      .pipe(
        debounceTime(150),
        map((query) => String(query || '').trim()),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe((query) => {
        if (query.length === 0) {
          this.searchResults = [];
          this.showResults = false;
          this.selectedIndex = -1;
          this.searchCleared.emit();
          return;
        }

        this.isLoading = true;
        this.showResults = true;
        this.searchResults = this.stationService.searchStations(query, 10);
        this.selectedIndex = this.searchResults.length > 0 ? 0 : -1;
        this.isLoading = false;
      });
  }

  selectStation(result: SearchResult): void {
    this.stationSelected.emit(result.station);
    this.searchControl.setValue(this.stationService.getDisplayValue(result.station), { emitEvent: false });
    this.searchResults = [];
    this.showResults = false;
    this.selectedIndex = -1;
  }

  onKeyPress(event: KeyboardEvent): void {
    if (!this.showResults || this.searchResults.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.searchResults.length - 1);
        this.scrollToSelected();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
        this.scrollToSelected();
        break;
      case 'Enter':
        event.preventDefault();
        if (this.selectedIndex >= 0 && this.searchResults[this.selectedIndex]) {
          this.selectStation(this.searchResults[this.selectedIndex]);
        } else if (this.searchResults.length > 0) {
          this.selectStation(this.searchResults[0]);
        }
        break;
      case 'Escape':
        this.showResults = false;
        break;
    }
  }

  clearSearch(): void {
    this.searchControl.setValue('');
    this.searchResults = [];
    this.showResults = false;
    this.selectedIndex = -1;
    this.searchInput?.nativeElement?.focus();
    this.searchCleared.emit();
  }

  closeResults(): void {
    setTimeout(() => {
      this.showResults = false;
    }, 200);
  }

  private scrollToSelected(): void {
    setTimeout(() => {
      const selected = document.querySelector('.station-result-item.selected');
      selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
  }
}

