import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface UploadedFile {
  id: string;
  original_name: string;
  upload_type: 'shapefile' | 'record_attachment';
  layer_name?: string;
  file_count?: number;
  created_at: string;
}

export interface ShapefileUploadResponse {
  message: string;
  uploadId: string;
  layerName: string;
  featureCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class FileUploadService {

  private readonly UPLOAD_URL = `${environment.apiUrl}/upload`;

  constructor(private http: HttpClient) {}

  // Updated to accept 5 parameters (files, description, category, layerName, onProgress)
  uploadShapefiles(
    files: File[],
    description: string,
    category: string,
    layerName: string,  // Added this parameter
    onProgress: (pct: number) => void
  ): Promise<ShapefileUploadResponse> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file, file.name));
    if (description) formData.append('description', description);
    if (category) formData.append('category', category);
    if (layerName) formData.append('layerName', layerName);  // Add layerName to form data

    return this.uploadWithProgress<ShapefileUploadResponse>(
      `${this.UPLOAD_URL}/shapefile`,
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
        catchError(err => throwError(() => new Error(err?.error?.message || 'Upload failed')))
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
}
