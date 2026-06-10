import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AppAlertType = 'success' | 'danger' | 'warning' | 'info';

export interface AppAlert {
  id: number;
  type: AppAlertType;
  message: string;
  modal?: boolean;
  closing?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AppAlertService {
  private nextId = 1;
  private dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly alertsSubject = new BehaviorSubject<AppAlert[]>([]);
  readonly alerts$ = this.alertsSubject.asObservable();

  show(message: string, type: AppAlertType = 'info', timeoutMs = 0, modal = false): void {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) return;

    if (!modal) {
      this.clearNonModalAlerts();
    }

    const alert: AppAlert = {
      id: this.nextId++,
      type,
      message: cleanMessage,
      modal,
    };
    this.alertsSubject.next([...this.alertsSubject.value, alert]);

    const effectiveTimeoutMs = timeoutMs || (!modal ? 3200 : 0);
    if (effectiveTimeoutMs > 0) {
      const timer = setTimeout(() => this.dismiss(alert.id), effectiveTimeoutMs);
      this.dismissTimers.set(alert.id, timer);
    }
  }

  success(message: string, timeoutMs?: number, modal = false): void {
    this.show(message, 'success', timeoutMs, modal);
  }

  error(message: string, timeoutMs?: number, modal = false): void {
    this.show(message, 'danger', timeoutMs, modal);
  }

  warning(message: string, timeoutMs?: number, modal = false): void {
    this.show(message, 'warning', timeoutMs, modal);
  }

  info(message: string, timeoutMs?: number, modal = false): void {
    this.show(message, 'info', timeoutMs, modal);
  }

  private clearNonModalAlerts(): void {
    const alerts = this.alertsSubject.value;
    const nonModalIds = alerts.filter((alert) => !alert.modal).map((alert) => alert.id);

    nonModalIds.forEach((id) => {
      const timer = this.dismissTimers.get(id);
      if (timer) clearTimeout(timer);
      this.dismissTimers.delete(id);
    });

    if (nonModalIds.length) {
      this.alertsSubject.next(alerts.filter((alert) => alert.modal));
    }
  }

  dismiss(id: number): void {
    const timer = this.dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.dismissTimers.delete(id);
    }

    const alerts = this.alertsSubject.value;
    const target = alerts.find((alert) => alert.id === id);
    if (!target || target.closing) return;

    this.alertsSubject.next(
      alerts.map((alert) => alert.id === id ? { ...alert, closing: true } : alert),
    );

    setTimeout(() => {
      this.alertsSubject.next(this.alertsSubject.value.filter((alert) => alert.id !== id));
    }, 190);
  }
}
