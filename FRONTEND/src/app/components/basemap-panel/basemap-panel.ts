import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { UiState } from '../../services/ui-state';
import { MapRegistry } from '../../services/map-registry';
import * as L from 'leaflet';

type BasemapType = 'Open Street Map' | 'satellite' | 'Google Satellite' | 'Esri Topographic' | 'Bhuvan India';

@Component({
  selector: 'app-basemap-panel',
  imports: [CommonModule],
  templateUrl: './basemap-panel.html',
  styleUrl: './basemap-panel.css',
})
export class BasemapPanel {
  constructor(public ui: UiState, private mapRegistry: MapRegistry) {}

  get selectedBasemap(): BasemapType {
    return this.ui.selectedBasemap;
  }

  set selectedBasemap(v: BasemapType) {
    this.ui.selectedBasemap = v;
  }

  close() {
    this.ui.activePanel = null;
  }

  onBasemapChange(type: BasemapType) {
    this.selectedBasemap = type;
    this.setBasemap(type);
  }

  setBasemap(type: BasemapType) {
    if (!this.mapRegistry.hasMap()) return;
    const map = this.mapRegistry.getMap();

    map.eachLayer((layer: any) => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });

    if (type === 'Open Street Map') {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxNativeZoom: 17,
        maxZoom: 22,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      return;
    }

    if (type === 'satellite') {
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxNativeZoom: 18, maxZoom: 22, attribution: 'Tiles © Esri' }
      ).addTo(map);
      return;
    }

    if (type === 'Google Satellite') {
      L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: 'Tiles © Google',
      }).addTo(map);
      return;
    }

    if (type === 'Esri Topographic') {
      L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { maxNativeZoom: 17, maxZoom: 22, attribution: 'Tiles © Esri' }
      ).addTo(map);
      return;
    }

    if (type === 'Bhuvan India') {
      const BHUVAN_WMS_URL = 'https://bhuvan-vec1.nrsc.gov.in/bhuvan/gwc/service/wms/?';
      const opts: L.WMSOptions = {
        layers: 'india3',
        transparent: true,
        format: 'image/png',
        maxNativeZoom: 17,
        maxZoom: 22,
        attribution: '<a href="https://bhuvan.nrsc.gov.in/" target="_blank">Bhuvan Maps:</a> ISRO',
      };
      L.tileLayer.wms(BHUVAN_WMS_URL, opts).addTo(map);
    }
  }
}
