import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppAlert, AppAlertService } from '../../services/app-alert.service';

@Component({
  selector: 'app-alert-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-alert-host.html',
  styleUrl: './app-alert-host.css',
})
export class AppAlertHostComponent implements OnDestroy {
  currentAlert: AppAlert | null = null;
  alertIconClass = 'bi-info-lg';
  alertTitle = 'Information';
  alertTypeClass = 'app-alert-info';
  alertMessage = '';
  alertId = 0;
  isModalAlert = false;
  isToastAlert = true;
  isClosingAlert = false;
  private alertSub: Subscription;

  constructor(public alerts: AppAlertService) {
    this.alertSub = this.alerts.alerts$.subscribe((items) => {
      const nextAlert = items[0] || null;
      this.currentAlert = nextAlert;
      this.alertIconClass = nextAlert ? this.getAlertIconClass(nextAlert) : 'bi-info-lg';
      this.alertTitle = nextAlert ? this.getAlertTitle(nextAlert) : 'Information';
      this.alertTypeClass = nextAlert ? `app-alert-${nextAlert.type}` : 'app-alert-info';
      this.alertMessage = nextAlert?.message || '';
      this.alertId = nextAlert?.id || 0;
      this.isModalAlert = !!nextAlert?.modal;
      this.isToastAlert = !!nextAlert && !nextAlert.modal;
      this.isClosingAlert = !!nextAlert?.closing;
    });
  }

  ngOnDestroy(): void {
    this.alertSub.unsubscribe();
  }

  getAlertIconClass(alert: AppAlert): string {
    if (alert.type === 'success') return 'bi-check-lg';
    if (alert.type === 'danger') return 'bi-x-lg';
    if (alert.type === 'warning') return 'bi-exclamation-lg';
    return 'bi-info-lg';
  }

  getAlertTitle(alert: AppAlert): string {
    if (alert.type === 'success') return 'Success';
    if (alert.type === 'danger') return 'Error';
    if (alert.type === 'warning') return 'Alert';
    return 'Information';
  }
}
