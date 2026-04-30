import { Component, OnInit, ChangeDetectorRef, NgZone, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FileUploadService, UploadedFile } from '../../services/file-upload.service';
import { Api } from '../../api/api';
import { CurrentUserService } from '../../services/current-user';
import { EDIT_LAYER_OPTIONS } from '../../components/edit-panel/edit-layer-config';
import { buildDynamicEditLayerOptions, toEditLayerKey } from '../../components/edit-panel/edit-layer-options';

type ModalView = 'layer-select' | 'shapefile';

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './file-upload.html',
  styleUrls: ['./file-upload.css'],
})
export class FileUploadComponent implements OnInit {
  @ViewChild('shapefileInput') shapefileInput?: ElementRef<HTMLInputElement>;

  isModalOpen = false;
  currentView: ModalView = 'layer-select';

  selectedLayer = '';
layerOptions: Array<{ value: string; label: string }> = [...EDIT_LAYER_OPTIONS];
filteredLayerOptions: Array<{ value: string; label: string }> = [...EDIT_LAYER_OPTIONS];

  shapeFiles: File[] = [];
  shapefileDragOver = false;

  isUploading = false;
  uploadProgress = 0;
  uploadSuccess = false;
  uploadError = '';
  uploadedFilesList: UploadedFile[] = [];

  fileDescription = '';
  fileCategory = '';

  readonly SHAPEFILE_EXTENSIONS = ['.shp', '.shx', '.dbf', '.prj', '.cpg', '.qpj', '.sbn', '.sbx'];
  readonly REQUIRED_SHAPEFILE_EXTENSIONS = ['.shp', '.shx', '.dbf'];

  constructor(
    private api: Api,
    private currentUser: CurrentUserService,
    private fileUploadService: FileUploadService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
  ) {}

  ngOnInit(): void {
    this.loadLayerOptions();
    this.loadUploadedFiles();
  }

  get selectedLayerLabel(): string {
    const selected = String(this.selectedLayer || '').trim();
    if (!selected) return '';
    const found = this.layerOptions.find((item) => item.value === selected);
    return found ? found.label : selected;
  }

  openModal(): void {
    this.isModalOpen = true;
    this.currentView = 'layer-select';
    this.resetUploadState();
    this.filteredLayerOptions = [...this.layerOptions];
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.resetUploadState();
  }

  selectLayer(): void {
    if (this.selectedLayer) {
      this.currentView = 'shapefile';
    }
  }

  goBackToLayers(): void {
    this.currentView = 'layer-select';
    this.selectedLayer = '';
    this.filteredLayerOptions = [...this.layerOptions];
  }

  goBackToUpload(): void {
    this.currentView = 'shapefile';
    this.resetFileState();
  }

  filterLayers(event: Event): void {
    const searchTerm = String((event.target as HTMLInputElement)?.value || '').toLowerCase();
    if (!searchTerm) {
      this.filteredLayerOptions = [...this.layerOptions];
      return;
    }

    this.filteredLayerOptions = this.layerOptions.filter((layer) =>
      layer.label.toLowerCase().includes(searchTerm),
    );
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.shapefileDragOver = true;
  }

  onDragLeave(): void {
    this.shapefileDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.shapefileDragOver = false;
    this.addShapefiles(Array.from(event.dataTransfer?.files || []));
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.addShapefiles(Array.from(input.files));
    }
  }

  removeFile(file: File): void {
    const index = this.shapeFiles.indexOf(file);
    if (index > -1) {
      this.shapeFiles.splice(index, 1);
    }
  }

  uploadShapefile(): void {
    this.uploadShapefiles();
  }

  private addShapefiles(files: File[]): void {
    const valid = files.filter((file) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return this.SHAPEFILE_EXTENSIONS.includes(ext);
    });

    const invalid = files.length - valid.length;
    this.uploadError = invalid > 0 ? `${invalid} file(s) skipped. Only shapefile parts are allowed.` : '';
    this.shapeFiles = [...this.shapeFiles, ...valid];
  }

  async uploadShapefiles(): Promise<void> {
    if (!this.shapeFiles.length || !this.selectedLayer) return;

    const validationError = this.getMissingShapefilePartsError();
    if (validationError) {
      this.uploadError = validationError;
      return;
    }

    this.isUploading = true;
    this.uploadProgress = 0;
    this.uploadError = '';
    const targetLayerName = this.getSelectedLayerTableName();

    try {
      await this.fileUploadService.uploadShapefiles(
        this.shapeFiles,
        this.fileDescription,
        this.fileCategory,
        targetLayerName,
        (progress) => {
          this.ngZone.run(() => {
            this.uploadProgress = progress;
            this.cdr.markForCheck();
          });
        },
      );

      this.uploadSuccess = true;
      this.loadUploadedFiles();
      this.resetAfterSuccessfulUpload();
    } catch (err: any) {
      this.uploadError = err?.message || 'Upload failed. Please try again.';
    } finally {
      this.isUploading = false;
      this.cdr.markForCheck();
    }
  }

  private loadUploadedFiles(): void {
    this.fileUploadService.getUploadedFiles().subscribe({
      next: (files) => {
        this.uploadedFilesList = files;
      },
      error: () => {},
    });
  }

  private resetUploadState(): void {
    this.selectedLayer = '';
    this.resetFileState();
    this.filteredLayerOptions = [...this.layerOptions];
  }

  private resetFileState(): void {
    this.shapeFiles = [];
    this.uploadProgress = 0;
    this.uploadSuccess = false;
    this.uploadError = '';
    this.fileDescription = '';
    this.fileCategory = '';
    this.isUploading = false;
    this.shapefileDragOver = false;
    this.clearNativeFileInput();
  }

  private resetAfterSuccessfulUpload(): void {
    this.shapeFiles = [];
    this.fileDescription = '';
    this.fileCategory = '';
    this.uploadProgress = 0;
    this.shapefileDragOver = false;
    this.clearNativeFileInput();

    setTimeout(() => {
      this.currentView = 'layer-select';
      this.selectedLayer = '';
      this.uploadSuccess = false;
      this.uploadError = '';
      this.filteredLayerOptions = [...this.layerOptions];
      this.cdr.markForCheck();
    }, 1200);
  }

  private clearNativeFileInput(): void {
    if (this.shapefileInput?.nativeElement) {
      this.shapefileInput.nativeElement.value = '';
    }
  }

  private getMissingShapefilePartsError(): string | null {
    const grouped = this.shapeFiles.reduce((acc, file) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (this.REQUIRED_SHAPEFILE_EXTENSIONS.includes(ext)) {
        const base = file.name.slice(0, file.name.lastIndexOf(ext)).trim().toLowerCase();
        if (!acc[base]) acc[base] = new Set<string>();
        acc[base].add(ext);
      }
      return acc;
    }, {} as Record<string, Set<string>>);

    const validBundle = Object.values(grouped).some((exts) =>
      this.REQUIRED_SHAPEFILE_EXTENSIONS.every((ext) => exts.has(ext)),
    );

    if (!validBundle) {
      const missing = this.REQUIRED_SHAPEFILE_EXTENSIONS.filter(
        (ext) => !this.shapeFiles.some((file) => file.name.toLowerCase().endsWith(ext)),
      );
      return `Shapefile upload requires .shp, .shx and .dbf files. Missing: ${missing.join(', ') || 'required file parts'}.`;
    }

    return null;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  getLayerLabel(layerValue: string): string {
    const layer = this.layerOptions.find((option) => option.value === layerValue);
    return layer ? layer.label : layerValue;
  }

  getSelectedLayerTableName(): string {
    const selected = String(this.selectedLayer || '').trim();
    if (!selected) return '';

    const option = this.layerOptions.find((item) => item.value === selected);
    const resolved = toEditLayerKey({
      layer_id: option?.value || selected,
      layar_name: option?.label || selected,
    });

    return resolved || selected.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  private loadLayerOptions(): void {
    if (this.isMaker()) {
      this.loadAssignedMakerLayers();
      return;
    }

    this.setLayerOptions(EDIT_LAYER_OPTIONS);
  }

  private setLayerOptions(options: Array<{ value: string; label: string }>): void {
    this.layerOptions = [...options];
    this.filteredLayerOptions = [...options];

    if (this.selectedLayer && !this.layerOptions.some((option) => option.value === this.selectedLayer)) {
      this.selectedLayer = '';
    }

    this.cdr.markForCheck();
  }

  private isMaker(): boolean {
    return String(this.currentUser.getSnapshot()?.user_type || '').trim().toLowerCase() === 'maker';
  }

  private loadAssignedMakerLayers(): void {
    const currentUserId = String(this.currentUser.getSnapshot()?.user_id || '').trim();
    if (!currentUserId) {
      this.setLayerOptions([]);
      return;
    }

    this.api.getMakerLayerList(currentUserId).subscribe({
      next: (res: any) => {
        const makers = Array.isArray(res?.makers) ? res.makers : [];
        const maker = makers.find(
          (item: any) => String(item?.user_id || '').trim().toLowerCase() === currentUserId.toLowerCase(),
        );

        if (!maker?.department_id) {
          this.setLayerOptions([]);
          return;
        }

        const assignedIds = String(maker?.assigned_layers || '')
          .split(',')
          .map((value) => String(value || '').trim())
          .filter(Boolean);

        this.api.getDepartmentLayers(String(maker.department_id).trim()).subscribe({
          next: (layers: any) => {
            type LayerOption = { value: string; label: string; supported: boolean };

        const nextOptions = buildDynamicEditLayerOptions(layers, assignedIds)
          .filter((option: LayerOption) => option.supported)
          .map((option: LayerOption) => ({
            value: option.value,
            label: option.label,
          }));
            this.setLayerOptions(nextOptions);
          },
          error: () => this.setLayerOptions([]),
        });
      },
      error: () => this.setLayerOptions([]),
    });
  }
}
