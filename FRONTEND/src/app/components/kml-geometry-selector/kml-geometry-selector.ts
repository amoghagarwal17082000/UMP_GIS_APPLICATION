import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FileUploadService } from '../../services/file-upload.service';

@Component({
  selector: 'app-kml-geometry-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kml-geometry-selector.html',
  styleUrls: ['./kml-geometry-selector.css'],
})
export class KmlGeometrySelectorComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer?: ElementRef<HTMLDivElement>;

  uploadId = '';
  layerName = 'track_table';
  tempTable = '';
  kmlFeatures: any[] = [];
  selectedFeatureIds: number[] = [];
  loading = false;
  error = '';

  map?: L.Map;
  featureLayer?: L.GeoJSON;
  casingLayer?: L.GeoJSON;
  layerMap = new Map<number, L.Layer>();
  lineRenderer?: L.Renderer;
  
  searchText = '';
  filteredFeatures: any[] = [];

  totalFeatures = 0;
  selectedCount = 0;
  appendMessage = '';
  mergeGeometry = false;
  mergeWarning = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private fileUploadService: FileUploadService,
    private router: Router,
    private route: ActivatedRoute,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.uploadId = params['uploadId'] || '';
      this.layerName = params['layerName'] || 'track_table';
      this.tempTable = params['tempTable'] || '';

      if (this.uploadId) {
        this.loadFeatures();
      }
    });
  }

  private async loadFeatures(): Promise<void> {
    this.loading = true;
    this.error = '';

    try {
      const response = await this.fileUploadService.getKmlTempFeatures(this.uploadId, this.layerName);
      this.kmlFeatures = Array.isArray(response.features) ? response.features : [];
      this.tempTable = response.tempTable || this.tempTable;
      this.totalFeatures = this.kmlFeatures.length;
      this.filteredFeatures = [...this.kmlFeatures];
      this.selectedFeatureIds = [];
      this.selectedCount = 0;
      this.cdr.markForCheck();

      setTimeout(() => this.initializeMap(), 0);
    } catch (err: any) {
      this.error = err?.message || 'Failed to load KML features.';
      this.cdr.markForCheck();
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private initializeMap(): void {
    if (!this.mapContainer?.nativeElement) return;

    this.destroyMap();

    this.map = L.map(this.mapContainer.nativeElement, {
      zoomControl: false,
      preferCanvas: false,
      scrollWheelZoom: true,
    }).setView([22.5, 79], 8.5);

    this.map.createPane('kmlLines');
    const linePane = this.map.getPane('kmlLines');
    if (linePane) {
      linePane.style.zIndex = '650';
    }
    this.lineRenderer = L.svg({ pane: 'kmlLines', padding: 0.5 });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    const collection = {
      type: 'FeatureCollection',
      features: this.kmlFeatures,
    } as any;

    this.casingLayer = L.geoJSON(collection, {
      renderer: this.lineRenderer,
      style: () => this.getCasingStyle(),
      pane: 'kmlLines',
      interactive: false,
    } as L.GeoJSONOptions).addTo(this.map);

    this.featureLayer = L.geoJSON(collection, {
      renderer: this.lineRenderer,
      style: (feature) => this.getFeatureStyle(feature),
      pane: 'kmlLines',
      onEachFeature: (feature, layer) => {
        const id = this.getFeatureId(feature);
        if (id !== null) {
          this.layerMap.set(id, layer);
        }
        layer.on('click', () => this.ngZone.run(() => this.toggleFeatureSelection(feature)));
        const label = this.getFeatureLabel(feature);
        if (label) {
          layer.bindTooltip(label, { sticky: true, direction: 'top' });
        }
      },
    } as L.GeoJSONOptions).addTo(this.map);

    this.fitMapToLines();
    setTimeout(() => {
      this.map?.invalidateSize();
      this.fitMapToLines();
      this.casingLayer?.bringToFront();
      this.featureLayer?.bringToFront();
    }, 50);
  }

  private destroyMap(): void {
    if (this.casingLayer) {
      this.casingLayer.remove();
      this.casingLayer = undefined;
    }
    if (this.featureLayer) {
      this.featureLayer.remove();
      this.featureLayer = undefined;
    }
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
    this.layerMap.clear();
  }

  toggleFeatureSelection(feature: any): void {
    const id = this.getFeatureId(feature);
    if (id === null) return;

    const index = this.selectedFeatureIds.indexOf(id);
    if (index > -1) {
      this.selectedFeatureIds.splice(index, 1);
    } else {
      this.selectedFeatureIds.push(id);
    }

    this.updateFeatureStyles();
    this.selectedCount = this.selectedFeatureIds.length;
    this.appendMessage = '';
    this.cdr.markForCheck();
  }

  selectAllFeatures(): void {
    this.selectedFeatureIds = this.getFeatureIds(this.filteredFeatures);
    this.updateFeatureStyles();
    this.selectedCount = this.selectedFeatureIds.length;
    this.cdr.markForCheck();
  }

  clearSelection(): void {
    this.selectedFeatureIds = [];
    this.updateFeatureStyles();
    this.selectedCount = 0;
    this.cdr.markForCheck();
  }

  private updateFeatureStyles(): void {
    this.layerMap.forEach((layer, id) => {
      (layer as L.Path).setStyle(this.getFeatureStyle({ id }));
    });
    this.casingLayer?.bringToFront();
    this.featureLayer?.bringToFront();
  }

  private getFeatureStyle(feature: any): L.PathOptions {
    const id = this.getFeatureId(feature);
    if (id === null) {
      return this.getUnselectedStyle();
    }
    const selected = this.selectedFeatureIds.includes(id);
    return selected ? this.getSelectedStyle() : this.getUnselectedStyle();
  }

  private getSelectedStyle(): L.PathOptions {
    return {
      color: '#ef4444',
      weight: 9,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    };
  }

  private getUnselectedStyle(): L.PathOptions {
    return {
      color: '#0066ff',
      weight: 6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    };
  }

  private getCasingStyle(): L.PathOptions {
    return {
      color: '#111827',
      weight: 12,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    };
  }

  filterFeatures(): void {
    const searchTerm = this.searchText.toLowerCase().trim();
    if (!searchTerm) {
      this.filteredFeatures = [...this.kmlFeatures];
    } else {
      this.filteredFeatures = this.kmlFeatures.filter((f) => {
        const id = String(f.id).toLowerCase();
        const name = String(f.properties?.name || '').toLowerCase();
        return id.includes(searchTerm) || name.includes(searchTerm);
      });
    }
  }

  zoomToFeature(feature: any, event?: Event): void {
    event?.stopPropagation();
    const id = this.getFeatureId(feature);
    if (id === null) return;
    const layer = this.layerMap.get(id);
    if (!layer || !this.map) return;

    const bounds = (layer as L.Polyline).getBounds?.();
    if (bounds?.isValid()) {
      this.map.fitBounds(bounds.pad(0.35), { maxZoom: 17 });
    }
  }

  zoomToAllLines(): void {
    this.fitMapToLines();
  }

  zoomIn(): void {
    this.map?.zoomIn();
  }

  zoomOut(): void {
    this.map?.zoomOut();
  }

  fitMapToAllLines(): void {
    this.fitMapToLines();
  }

  async appendSelectedGeometries(): Promise<void> {
  if (this.selectedFeatureIds.length === 0) {
    this.error = 'Please select at least one geometry.';
    return;
  }

  this.loading = true;
  this.error = '';
  this.mergeWarning = '';

  try {
    const result = await this.fileUploadService.appendSelectedKmlLines(
      this.uploadId,
      this.layerName,
      this.selectedFeatureIds,
      this.mergeGeometry && this.selectedFeatureIds.length >= 2,
    );

    // Show gap warning if merge was requested but lines didn't fully connect
    if (this.mergeGeometry && result?.hasGaps) {
      this.mergeWarning =
        `Saved as ${result.segmentCount} segments — some selected lines have gaps and could not be fully merged.`;
    }

    this.appendMessage = this.mergeGeometry && this.selectedFeatureIds.length >= 2
      ? `${this.selectedFeatureIds.length} lines merged into 1 geometry and appended into ${result?.targetSchema}.${result?.targetTable}.`
      : `${result?.insertedCount || this.selectedFeatureIds.length} geometries appended into ${result?.targetSchema}.${result?.targetTable}.`;

    this.loading = false;
    this.cdr.markForCheck();

    setTimeout(() => {
      this.router.navigate(['/dashboard/file-upload'], {
        queryParams: { kmlAppend: 'success' },
      });
    }, 1500);
  } catch (err: any) {
    this.error = err?.message || 'Failed to append selected geometries.';
    this.loading = false;
    this.cdr.markForCheck();
  }
}


  goBack(): void {
    this.router.navigate(['/dashboard/file-upload']);
  }

  ngOnDestroy(): void {
    this.destroyMap();
    this.destroy$.next();
    this.destroy$.complete();
  }

  getFeatureLabel(feature: any): string {
    const props = feature?.properties || {};
    return String(props.name || props.Name || props.id || `Line ${feature?.id || ''}`);
  }

  getFeatureId(feature: any): number | null {
    if (feature?.id === null || feature?.id === undefined || feature?.id === '') {
      return null;
    }
    const id = Number(feature?.id);
    return Number.isFinite(id) ? id : null;
  }

  isFeatureSelected(feature: any): boolean {
    const id = this.getFeatureId(feature);
    return id !== null && this.selectedFeatureIds.includes(id);
  }

  private getFeatureIds(features: any[]): number[] {
    return features
      .map((feature) => this.getFeatureId(feature))
      .filter((id): id is number => id !== null);
  }

  private fitMapToLines(): void {
    if (!this.map || !this.featureLayer) return;

    const bounds = this.featureLayer.getBounds();
    if (bounds.isValid()) {
      this.map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
    }
  }
}
