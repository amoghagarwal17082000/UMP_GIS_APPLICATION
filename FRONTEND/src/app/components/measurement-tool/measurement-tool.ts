import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import { MapRegistry } from '../../services/map-registry';

type MeasureMode = 'distance' | 'area' | 'point' | null;
type DistanceUnit = 'm' | 'km';
type AreaUnit = 'acre' | 'ha' | 'sqkm' | 'sqm';
type CoordinateUnit = 'degree' | 'dms';

@Component({
  selector: 'app-measurement-tool',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './measurement-tool.html',
  styleUrls: ['./measurement-tool.css'],
})
export class MeasurementToolComponent implements OnDestroy {
  mode: MeasureMode = null;
  distanceUnit: DistanceUnit = 'm';
  areaUnit: AreaUnit = 'sqm';
  coordinateUnit: CoordinateUnit = 'degree';
  points: L.LatLng[] = [];
  result = '';
  isOpen = false;

  private layer?: L.LayerGroup;
  private mapClickHandler?: (event: L.LeafletMouseEvent) => void;
  private mapDoubleClickHandler?: (event: L.LeafletMouseEvent) => void;
  private mapMouseMoveHandler?: (event: L.LeafletMouseEvent) => void;
  private containerMouseMoveHandler?: (event: MouseEvent) => void;
  private previewPoint?: L.LatLng;
  private doubleClickZoomWasEnabled = false;

  constructor(
    private mapRegistry: MapRegistry,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {}

  ngOnDestroy(): void {
    this.detachMapEvents();
    this.clearLayers();
  }

  setMode(mode: Exclude<MeasureMode, null>): void {
    this.isOpen = true;
    if (this.mode === mode) {
      this.stop();
      return;
    }

    this.clearMeasurement();
    this.mode = mode;
    this.ensureLayer();
    this.attachMapClick();
  }

  stop(): void {
    this.mode = null;
    this.previewPoint = undefined;
    this.detachMapEvents();
  }

  close(): void {
    this.stop();
    this.clearMeasurement();
    this.isOpen = false;
  }

  togglePanel(event?: Event): void {
    event?.stopPropagation();
    if (this.isOpen) {
      this.close();
      return;
    }
    this.isOpen = true;
  }

  resetMeasurement(): void {
    this.stop();
    this.clearMeasurement();
  }

  setDistanceUnit(unit: DistanceUnit): void {
    this.distanceUnit = unit;
    if (this.mode === 'distance') this.renderMeasurement();
  }

  setAreaUnit(unit: AreaUnit): void {
    this.areaUnit = unit;
    if (this.mode === 'area') this.renderMeasurement();
  }

  setCoordinateUnit(unit: CoordinateUnit): void {
    this.coordinateUnit = unit;
    if (this.mode === 'point') this.renderMeasurement();
  }

  get distanceUnitLabel(): string {
    return this.distanceUnit === 'km' ? 'Kilometers' : 'Meters';
  }

  get areaUnitLabel(): string {
    switch (this.areaUnit) {
      case 'acre':
        return 'Acres';
      case 'ha':
        return 'Hectares';
      case 'sqkm':
        return 'Sq Km';
      default:
        return 'Sq M';
    }
  }

  get coordinateUnitLabel(): string {
    return this.coordinateUnit === 'dms' ? 'DMS' : 'Degrees';
  }

  clearMeasurement(): void {
    this.points = [];
    this.previewPoint = undefined;
    this.result = '';
    this.clearLayers();
    if (this.mode) this.ensureLayer();
  }

  private attachMapClick(): void {
    if (!this.mapRegistry.hasMap() || this.mapClickHandler) return;
    const map = this.mapRegistry.getMap();
    this.doubleClickZoomWasEnabled = map.doubleClickZoom.enabled();
    map.doubleClickZoom.disable();
    this.mapClickHandler = (event: L.LeafletMouseEvent) => this.zone.run(() => this.addPoint(event));
    this.mapDoubleClickHandler = (event: L.LeafletMouseEvent) => this.zone.run(() => this.finishMeasurement(event));
    this.mapMouseMoveHandler = (event: L.LeafletMouseEvent) => this.zone.run(() => this.previewTo(event.latlng));
    this.containerMouseMoveHandler = (event: MouseEvent) => this.zone.run(() => this.previewFromContainerEvent(event));
    map.on('click', this.mapClickHandler);
    map.on('dblclick', this.mapDoubleClickHandler);
    map.on('mousemove', this.mapMouseMoveHandler);
    map.getContainer().addEventListener('mousemove', this.containerMouseMoveHandler, { passive: true });
  }

  private detachMapEvents(): void {
    if (!this.mapRegistry.hasMap()) return;
    const map = this.mapRegistry.getMap();
    if (this.mapClickHandler) {
      map.off('click', this.mapClickHandler);
      this.mapClickHandler = undefined;
    }
    if (this.mapDoubleClickHandler) {
      map.off('dblclick', this.mapDoubleClickHandler);
      this.mapDoubleClickHandler = undefined;
    }
    if (this.mapMouseMoveHandler) {
      map.off('mousemove', this.mapMouseMoveHandler);
      this.mapMouseMoveHandler = undefined;
    }
    if (this.containerMouseMoveHandler) {
      map.getContainer().removeEventListener('mousemove', this.containerMouseMoveHandler);
      this.containerMouseMoveHandler = undefined;
    }
    if (this.doubleClickZoomWasEnabled) {
      map.doubleClickZoom.enable();
    }
    this.doubleClickZoomWasEnabled = false;
  }

  private ensureLayer(): void {
    if (this.layer || !this.mapRegistry.hasMap()) return;
    this.layer = L.layerGroup().addTo(this.mapRegistry.getMap());
  }

  private clearLayers(): void {
    if (!this.layer) return;
    this.layer.clearLayers();
    if (this.mapRegistry.hasMap()) {
      this.mapRegistry.getMap().removeLayer(this.layer);
    }
    this.layer = undefined;
  }

  private addPoint(event: L.LeafletMouseEvent): void {
    if (!this.mode) return;
    L.DomEvent.stop(event.originalEvent);
    if (this.mode === 'point') {
      this.previewPoint = undefined;
      this.points = [event.latlng];
      this.renderMeasurement();
      this.cdr.detectChanges();
      return;
    }
    if ((event.originalEvent as MouseEvent).detail >= 2) {
      this.finishMeasurement(event);
      return;
    }
    this.previewPoint = undefined;
    this.addFixedPoint(event.latlng);
    this.renderMeasurement();
    this.cdr.detectChanges();
  }

private finishMeasurement(event: L.LeafletMouseEvent): void {
  if (!this.mode) return;

  L.DomEvent.stop(event.originalEvent);

  this.previewPoint = undefined;

  if (this.mode !== 'point') {
    this.addFixedPoint(event.latlng);
  }

  this.renderMeasurement();

  this.mode = null;
  this.detachMapEvents();

  this.cdr.detectChanges();
}

private drawVertexMarkers(points: L.LatLng[]): void {
  if (!this.layer) return;

  points.forEach((point) => {
    L.marker(point, {
      icon: L.divIcon({
        className: 'measure-point-marker',
        html: this.measurePointPinHtml(),
        iconSize: [24, 30],
        iconAnchor: [12, 28],
      }),
      keyboard: false,
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(this.layer!);
  });
}

 private renderMeasurement(): void {
  if (!this.layer) return;

  this.layer.clearLayers();

  const displayPoints = this.getDisplayPoints();

  if (this.mode === 'distance') {
    this.renderDistance(displayPoints);
  } else if (this.mode === 'point') {
    this.renderPoint(displayPoints);
  } else if (this.mode === 'area') {
    this.renderArea(displayPoints);
  }

  // only clicked/fixed vertices will show marker
  this.drawVertexMarkers(this.points);

  this.cdr.detectChanges();
}

  private previewTo(point: L.LatLng): void {
    if (!this.mode || (this.points.length === 0 && this.mode !== 'point')) return;
    this.previewPoint = point;
    this.renderMeasurement();
    this.cdr.detectChanges();
  }

  private previewFromContainerEvent(event: MouseEvent): void {
    if (!this.mapRegistry.hasMap() || !this.mode) return;
    const map = this.mapRegistry.getMap();
    const containerPoint = map.mouseEventToContainerPoint(event);
    this.previewTo(map.containerPointToLatLng(containerPoint));
  }

  private addFixedPoint(point: L.LatLng): void {
    const lastPoint = this.points[this.points.length - 1];
    if (lastPoint && lastPoint.distanceTo(point) < 0.01) return;
    this.points = [...this.points, point];
  }

  private measurePointPinHtml(): string {
    return `
      <div style="
        position: relative;
        width: 19px;
        height: 19px;
        border: 2px solid #ffffff;
        border-radius: 50% 50% 50% 0;
        background: #2fa36b;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.32);
        transform: rotate(-45deg);
        transform-origin: center;
      ">
        <span style="
          position: absolute;
          left: 5px;
          top: 5px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #ffffff;
        "></span>
      </div>
    `;
  }

  private getDisplayPoints(): L.LatLng[] {
    return this.previewPoint ? [...this.points, this.previewPoint] : this.points;
  }

  private renderDistance(displayPoints: L.LatLng[]): void {
    if (!this.layer) return;
    if (displayPoints.length > 1) {
      L.polyline(displayPoints, {
        color: '#0086ff',
        weight: 4,
        interactive: false,
      }).addTo(this.layer);
    }

    const meters = displayPoints.reduce((total, point, index) => {
      if (index === 0) return total;
      return total + displayPoints[index - 1].distanceTo(point);
    }, 0);
    this.result = this.formatDistance(meters);
  }

  private renderArea(displayPoints: L.LatLng[]): void {
    if (!this.layer) return;
    if (displayPoints.length > 1) {
      L.polyline([...displayPoints, ...(displayPoints.length > 2 ? [displayPoints[0]] : [])], {
        color: '#0086ff',
        weight: 4,
        interactive: false,
      }).addTo(this.layer);
    }
    if (displayPoints.length > 2) {
      L.polygon(displayPoints, {
        color: '#0086ff',
        weight: 2,
        fillColor: '#93c5fd',
        fillOpacity: 0.24,
        interactive: false,
      }).addTo(this.layer);
    }
    this.result = displayPoints.length > 2 ? this.formatArea(this.computeArea(displayPoints)) : '';
  }

  private renderPoint(displayPoints: L.LatLng[]): void {
    const point = displayPoints[displayPoints.length - 1];
    this.result = point ? this.formatCoordinate(point) : '';
  }

  private computeArea(points: L.LatLng[]): number {
    const radius = 6378137;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      area += this.toRadians(p2.lng - p1.lng) * (2 + Math.sin(this.toRadians(p1.lat)) + Math.sin(this.toRadians(p2.lat)));
    }
    return Math.abs((area * radius * radius) / 2);
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private formatDistance(meters: number): string {
    if (!meters) return '';
    return this.distanceUnit === 'km'
      ? `${this.formatNumber(meters / 1000)} Kilometers`
      : `${this.formatNumber(meters)} Meters`;
  }

  private formatArea(squareMeters: number): string {
    switch (this.areaUnit) {
      case 'acre':
        return `${this.formatNumber(squareMeters / 4046.8564224)} Acres`;
      case 'ha':
        return `${this.formatNumber(squareMeters / 10000)} Hectares`;
      case 'sqkm':
        return `${this.formatNumber(squareMeters / 1000000)} Sq Km`;
      default:
        return `${this.formatNumber(squareMeters)} Sq M`;
    }
  }

  private formatCoordinate(point: L.LatLng): string {
    if (this.coordinateUnit === 'dms') {
      return `${this.toDms(point.lat, 'lat')}, ${this.toDms(point.lng, 'lng')}`;
    }
    return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  }

  private toDms(value: number, axis: 'lat' | 'lng'): string {
    const direction = axis === 'lat'
      ? value >= 0 ? 'N' : 'S'
      : value >= 0 ? 'E' : 'W';
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minutesFloat = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = (minutesFloat - minutes) * 60;
    return `${degrees}° ${minutes}' ${seconds.toFixed(2)}" ${direction}`;
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }
}
