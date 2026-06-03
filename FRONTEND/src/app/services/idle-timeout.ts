import { Injectable, NgZone, OnDestroy } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class IdleTimeoutService implements OnDestroy {
  private readonly timeoutMs = 4 * 60 * 60 * 1000;
  private readonly events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly boundReset = () => this.resetTimer();

  constructor(private zone: NgZone) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.zone.runOutsideAngular(() => {
      this.events.forEach((eventName) => window.addEventListener(eventName, this.boundReset, true));
    });

    this.resetTimer();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.zone.runOutsideAngular(() => {
      this.events.forEach((eventName) => window.removeEventListener(eventName, this.boundReset, true));
    });

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private resetTimer(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onIdleTimeout(), this.timeoutMs);
  }

  private onIdleTimeout(): void {
    this.stop();
  }
}

