import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest } from '@angular/common/http';
import { Observable, Subject, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { getDivision } from '../api/shared/api-utils';

export interface UploadedFile {
  id: string;
  original_name: string;
  upload_type: 'shapefile' | 'kml' | 'record_attachment';
  layer_name?: string;
  file_count?: number;
  created_at: string;
}

export interface FileUploadResponse {
  message: string;
  uploadId: string;
  layerName: string;
  featureCount: number;
   tempTable?: string;
  insertedObjectIds?: number[];
  firstObjectId?: number | null;
}

export interface ShapefileUploadedEvent {
  layerName: string;
  uploadId?: string;
  featureCount?: number;
}

@Injectable({
  providedIn: 'root'
})
export class FileUploadService {

  private readonly UPLOAD_URL = `${environment.apiUrl}/upload`;
  private readonly shapefileUploadedSubject = new Subject<ShapefileUploadedEvent>();
  readonly shapefileUploaded$ = this.shapefileUploadedSubject.asObservable();

  constructor(private http: HttpClient) {}

  // Updated to accept 5 parameters (files, description, category, layerName, onProgress)
  uploadShapefiles(
    files: File[],
    description: string,
    category: string,
    layerName: string,  // Added this parameter
    onProgress: (pct: number) => void
  ): Promise<FileUploadResponse> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file, file.name));
    if (description) formData.append('description', description);
    if (category) formData.append('category', category);
    if (layerName) formData.append('layerName', layerName);  // Add layerName to form data
    const division = String(getDivision() || '').trim();
    if (division) formData.append('division', division);

    return this.uploadWithProgress<FileUploadResponse>(
      `${this.UPLOAD_URL}/shapefile`,
      formData,
      onProgress
    ).then((response) => {
      this.shapefileUploadedSubject.next({
        layerName: response?.layerName || layerName,
        uploadId: response?.uploadId,
        featureCount: response?.featureCount,
      });
      return response;
    });
  }

  uploadKmlFile(
    file: File,
    description: string,
    category: string,
    layerName: string,
    onProgress: (pct: number) => void
  ): Promise<FileUploadResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (description) formData.append('description', description);
    if (category) formData.append('category', category);
    if (layerName) formData.append('layerName', layerName);

    return this.uploadWithProgress<FileUploadResponse>(
      `${this.UPLOAD_URL}/kml`,
      formData,
      onProgress
    );
  }

  uploadCsvGeometry(
    file: File,
    layerName: string,
    onProgress: (pct: number) => void
  ): Promise<FileUploadResponse & { success: boolean }> {
    const formData = new FormData();
    formData.append('csvFile', file, file.name);
    formData.append('layerName', layerName);
    const division = String(getDivision() || '').trim();
    if (division) formData.append('division', division);

    return this.uploadWithProgress<FileUploadResponse & { success: boolean }>(
      `${this.UPLOAD_URL}/upload-csv-geometry`,
      formData,
      onProgress
    );
  }

  private uploadWithProgress<T>(
    url: string,
    formData: FormData,
    onProgress: (pct: number) => void
  ): Promise<T> {
    const req = new HttpRequest('POST', url, formData, {
      reportProgress: true
    });

    return new Promise((resolve, reject) => {
      this.http.request(req).pipe(
        catchError(err => throwError(() => new Error(err?.error?.message || err?.error?.error || 'Upload failed')))
      ).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            onProgress(Math.round(100 * event.loaded / event.total));
          } else if (event.type === HttpEventType.Response) {
            resolve(event.body as T);
          }
        },
        error: (err) => reject(err)
      });
    });
  }

  getUploadedFiles(): Observable<UploadedFile[]> {
    return this.http.get<UploadedFile[]>(`${this.UPLOAD_URL}/layers`).pipe(
      catchError(err => throwError(() => new Error(err?.error?.message || 'Failed to fetch files')))
    );
  }

  getKmlTempFeatures(uploadId: string, layerName: string): Promise<any> {
    return this.http
      .get<any>(`${this.UPLOAD_URL}/kml/temp/${uploadId}/features`, {
        params: { layerName },
      })
      .pipe(
        catchError(err => throwError(() => new Error(err?.error?.message || 'Failed to fetch KML temp features')))
      )
      .toPromise();
  }

  appendSelectedKmlLines(
    uploadId: string,
    layerName: string,
    selectedIds: number[],
    mergeGeometry: boolean = false
  ): Promise<any> {
    return this.http
      .post<any>(`${this.UPLOAD_URL}/kml/temp/${uploadId}/append`, { selectedIds, mergeGeometry }, {
        params: { layerName },
      })
      .pipe(
        catchError(err => throwError(() => new Error(err?.error?.message || 'Failed to append selected KML lines')))
      )
      .toPromise();
  }
}

