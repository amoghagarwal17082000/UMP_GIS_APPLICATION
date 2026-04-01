import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { filter, finalize } from 'rxjs/operators';
import { NgZone } from '@angular/core';
import { timeout, catchError, of } from 'rxjs';

import { Auth } from '../../services/auth';
import { Api } from '../../api/api';

type Step = 'LOGIN' | 'OTP';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit, AfterViewInit, OnDestroy {
  loginStep: Step = 'LOGIN';
  showTrainAnimation = false;
  trainAnimationSrc = '/assets/images/Train.gif';
  trainAnimationReady = false;
  loginFadingOut = false;
  loaderFadingOut = false;

  // Step 1
  username = '';
  password = '';
  consent = false;

  // Captcha (separate from OTP)
  captchaId: string | null = null;
  captchaImage = '';
  captchaValue = '';

  // Step 2
  otp = '';

  // UI
  loading = false;
  error = '';
  infoMsg = '';
  showPassword = false;

  private captchaLoading = false;

  private errorTimer: any = null;
  private redirectTimer: any = null;
  private finalRedirectTimer: any = null;

  constructor(
    private auth: Auth,
    private api: Api,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const url = (e.urlAfterRedirects || e.url || '').toLowerCase();
        if (url.includes('/login')) {
          setTimeout(() => this.loadCaptcha('NavigationEnd'), 0);
        }
      });
  }

  ngOnInit(): void {
    this.preloadTrainAnimation();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.loadCaptcha('ngAfterViewInit'), 0);
  }

  // ✅ auto-clear after 2 seconds
private showError(message: string) {
  // show error inside Angular zone so UI definitely updates
  this.zone.run(() => {
    this.error = message;
    this.cdr.detectChanges(); // ✅ show immediately
  });

  if (this.errorTimer) {
    clearTimeout(this.errorTimer);
    this.errorTimer = null;
  }

  this.zone.runOutsideAngular(() => {
    this.errorTimer = setTimeout(() => {
      this.zone.run(() => {
        this.error = '';
        this.cdr.detectChanges(); // ✅ hide after 2s
      });
    }, 2000);
  });
}





  loadCaptcha(from: string = 'manual') {
    if (this.loginStep !== 'LOGIN') return;
    if (this.captchaLoading) return;

    this.captchaLoading = true;
    console.log(`[CAPTCHA] loading (${from})...`);

    this.api.getNewCaptcha().subscribe({
      next: (res: any) => {
        const data = res?.data || res;

        this.captchaId = data?.captchaId || null;
        this.captchaImage = data?.image || '';
        this.captchaValue = '';

        this.cdr.detectChanges();
        this.captchaLoading = false;

        if (!this.captchaId || !this.captchaImage) {
          setTimeout(() => this.loadCaptcha('retry-missing-fields'), 400);
        }
      },
      error: (err: any) => {
        console.error('[CAPTCHA] load failed:', err);
        this.captchaLoading = false;
        setTimeout(() => this.loadCaptcha('retry-error'), 800);
      },
    });
  }

  refreshCaptcha() {
    this.loadCaptcha('refresh-button');
  }

  // =========================
  // STEP 1: captcha validate -> request OTP
  // =========================
otpSending = false;

login() {
  if (!this.username || !this.password) {
    this.showError('Please enter User ID and Password');
    return;
  }
  if (!this.consent) {
    this.showError('Please accept Privacy Policy and Terms of Use');
    return;
  }
  if (!this.captchaId || !this.captchaImage) {
    this.showError('Captcha not loaded. Please refresh captcha.');
    this.loadCaptcha('captcha-not-loaded');
    return;
  }
  if (!this.captchaValue || this.captchaValue.trim().length < 4) {
    this.showError('Please enter captcha');
    return;
  }

  // ✅ Step A: Validate captcha first
  this.loading = true;
  this.infoMsg = 'Validating captcha…';

  console.time('captcha-validate');

this.api
  .validateCaptcha(this.captchaId, this.captchaValue.trim())
  .pipe(
    timeout(10000),
    catchError((err) => {
      console.error('[CAPTCHA] validate timeout/error', err);
      return of({ success: false, message: 'Captcha validation timeout. Please try again.' });
    }),
    finalize(() => console.timeEnd('captcha-validate'))
  )
  .subscribe({

      next: (capRes: any) => {
        if (!capRes?.success) {
          this.loading = false;
          this.showError(capRes?.message || 'Invalid captcha');
          this.loadCaptcha('captcha-invalid');
          return;
        }

        // ✅ IMPORTANT: Stop blocking UI immediately
        this.loading = false;

        // ✅ Step B: INSTANT switch to OTP screen inside Angular zone
        this.zone.run(() => {
          this.loginStep = 'OTP';
          this.otp = '';
          this.infoMsg = 'Connecting… Sending OTP to registered email.';
          this.cdr.detectChanges(); 
        });

        // ✅ Step C: Request OTP in background (separate flag)
        this.otpSending = true;

        this.auth.requestOtp(this.username, this.password).subscribe({
          next: (res: any) => {
            this.otpSending = false;

            if (res?.success) {
              this.zone.run(() => {
                this.loginStep = 'OTP';
                this.infoMsg = res?.message || 'OTP sent to registered email.';
                this.cdr.detectChanges();
              });
            } else {
              this.showError(res?.message || res?.error || 'Invalid user ID or password');
              this.zone.run(() => (this.loginStep = 'LOGIN'));
              setTimeout(() => this.loadCaptcha('back-to-login-after-requestOtp-fail'), 0);
            }
          },
          error: (err: any) => {
            this.otpSending = false;

            const backendMessage =
              err?.error?.message ||
              err?.error?.error ||
              err?.message ||
              'Invalid user ID or password';

            this.showError(backendMessage);

            this.zone.run(() => (this.loginStep = 'LOGIN'));
            setTimeout(() => this.loadCaptcha('wrong-password'), 0);
          },
        });
      },

      error: (err: any) => {
        this.loading = false;

        const backendMessage =
          err?.error?.message ||
          err?.error?.error ||
          'Captcha validation failed';

        this.showError(backendMessage);
        this.loadCaptcha('captcha-validate-error');
      },
    });
}


  // =========================
  // STEP 2: verify OTP -> redirect
  // =========================
verifyOtp() {
  if (!this.otp || this.otp.trim().length < 4) {
    this.showError('Please enter valid OTP');
    return;
  }
  if (this.loading) return;

  this.loading = true;
  this.error = '';

  this.auth.verifyOtp(this.username, this.otp.trim()).subscribe({
    next: (res: any) => {
      this.loading = false;

      if (res?.success) {
        this.startPostLoginAnimation();
      } else {
        this.showError(res?.message || 'Invalid OTP');
      }
    },
    error: (err: any) => {
      this.loading = false;

      const msg =
        err?.error?.message ||
        err?.error?.error ||
        (err?.status === 401 ? 'Invalid OTP' : 'Server error during OTP verification');

      this.showError(msg);
    }
  });
}



  backToLogin() {
    this.loginStep = 'LOGIN';
    this.otp = '';
    this.error = '';
    this.infoMsg = '';
    this.loading = false;

    setTimeout(() => this.loadCaptcha('backToLogin'), 0);
    if (this.errorTimer) { clearTimeout(this.errorTimer); this.errorTimer = null; }
   this.error = '';

  }

  resendOtp() {
    this.loading = true;
    this.error = '';
    this.infoMsg = '';

    this.auth.resendOtp(this.username).subscribe({
      next: (res: any) => {
        this.loading = false;

        if (res?.success) {
          this.infoMsg = res?.message || 'OTP resent.';
        } else {
          this.showError(res?.message || res?.error || 'Failed to resend OTP');
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.showError(err?.error?.message || 'Server error while resending OTP');
      },
    });
  }

  private preloadTrainAnimation() {
    const image = new Image();
    image.onload = () => {
      this.zone.run(() => {
        this.trainAnimationReady = true;
        this.cdr.markForCheck();
      });
    };
    image.onerror = () => {
      this.zone.run(() => {
        this.trainAnimationReady = false;
      });
    };
    image.src = this.trainAnimationSrc;
  }

  private startPostLoginAnimation() {
    this.loginFadingOut = true;
    this.showTrainAnimation = true;
    this.cdr.detectChanges();

    requestAnimationFrame(() => {
      this.redirectTimer = setTimeout(() => {
        this.loaderFadingOut = true;
        this.cdr.detectChanges();
      }, 1100);

      this.finalRedirectTimer = setTimeout(() => {
        this.router.navigateByUrl('/dashboard');
      }, 1450);
    });
  }

  onTrainAnimationError(_event: Event) {
    this.trainAnimationReady = false;
  }

  ngOnDestroy(): void {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
    if (this.redirectTimer) {
      clearTimeout(this.redirectTimer);
      this.redirectTimer = null;
    }
    if (this.finalRedirectTimer) {
      clearTimeout(this.finalRedirectTimer);
      this.finalRedirectTimer = null;
    }
  }
}
