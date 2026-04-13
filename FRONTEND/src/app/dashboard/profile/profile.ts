import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom, timeout } from 'rxjs';
import { Api } from 'src/app/api/api';
import { CurrentUserService } from 'src/app/services/current-user';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class ProfileComponent implements OnInit {
  profileForm!: FormGroup;
  user_id = '';
  unit_name = '';
  submitted = false;
  passwordError = '';
  passwordSuccess = '';
  passwordMessage = '';
  passwordMessageType: 'success' | 'error' | '' = '';
  passwordValidated = false;
  validatingPassword = false;
  private validationWatchdog: ReturnType<typeof setTimeout> | null = null;
  private validationMessageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private fb: FormBuilder,
    private currentUser: CurrentUserService,
    private api: Api,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const user = this.currentUser.getSnapshot();

    this.user_id = user?.user_id || '';
    this.unit_name = user?.unit_type || '';

    this.profileForm = this.fb.group({
      password: [''],
      user_name: [{ value: user?.user_name || '', disabled: true }, Validators.required],
      email: [user?.email || '', [Validators.required, Validators.email]],
      mobile: [user?.mobile || '', [Validators.required, Validators.pattern('^[0-9]{10}$')]],
      hrmsid: [user?.hrmsid || '', Validators.required],
      designation: [user?.designation || '', Validators.required],
      department: [{ value: user?.department || '', disabled: true }, Validators.required],
      zone: [{ value: user?.railway || '', disabled: true }, Validators.required],
      division: [{ value: user?.division || '', disabled: true }, Validators.required],
    });

    this.profileForm.get('password')?.valueChanges.subscribe(() => {
      const passwordControl = this.profileForm.get('password');
      this.clearValidationMessageTimer();
      this.passwordError = '';
      this.passwordSuccess = '';
      this.passwordMessage = '';
      this.passwordMessageType = '';
      this.passwordValidated = false;
      if (passwordControl?.hasError('incorrectPassword')) {
        passwordControl.setErrors(null);
      }
    });

    ['email', 'mobile', 'hrmsid', 'designation'].forEach((controlName) => {
      this.profileForm.get(controlName)?.valueChanges.subscribe(() => {
        this.resetPasswordValidationState();
      });
    });
  }

  async validatePassword() {
    this.clearValidationMessageTimer();
    this.passwordError = '';
    this.passwordSuccess = '';
    this.passwordMessage = '';
    this.passwordMessageType = '';
    const passwordControl = this.profileForm.get('password');
    passwordControl?.setErrors(null);
    const password = String(this.profileForm.get('password')?.value || '').trim();

    if (!password) {
      this.submitted = true;
      this.passwordValidated = false;
      this.passwordError = 'Password is required';
      this.passwordMessage = 'Password is required';
      this.passwordMessageType = 'error';
      passwordControl?.setErrors({ required: true });
      this.scheduleValidationMessageClear();
      return;
    }

    this.validatingPassword = true;
    this.clearValidationWatchdog();
    this.validationWatchdog = setTimeout(() => {
      this.validatingPassword = false;
      this.passwordValidated = false;
      this.passwordError = 'Password validation timed out. Please try again.';
      this.cdr.detectChanges();
    }, 12000);

    try {
      const res: any = await firstValueFrom(
        this.api.validateProfilePassword({
          user_id: this.user_id,
          password,
        }).pipe(timeout(10000))
      );

      this.passwordValidated = !!res?.status;
      this.passwordSuccess = res?.message || 'Password validated';
      this.passwordMessage = this.passwordSuccess;
      this.passwordMessageType = 'success';
      this.scheduleValidationMessageClear();
    } catch (err: any) {
      this.passwordValidated = false;
      this.passwordError =
        err?.name === 'TimeoutError'
          ? 'Password validation timed out. Please try again.'
          : err?.error?.message || 'Unable to validate password';
      this.passwordMessage = this.passwordError;
      this.passwordMessageType = 'error';
      if (err?.status === 401) {
        passwordControl?.setErrors({ incorrectPassword: true });
        passwordControl?.markAsTouched();
      }
      this.scheduleValidationMessageClear();
    } finally {
      this.validatingPassword = false;
      this.clearValidationWatchdog();
      this.cdr.detectChanges();
    }
  }

  private clearValidationWatchdog() {
    if (this.validationWatchdog) {
      clearTimeout(this.validationWatchdog);
      this.validationWatchdog = null;
    }
  }

  private resetPasswordValidationState() {
    this.clearValidationMessageTimer();
    this.passwordError = '';
    this.passwordSuccess = '';
    this.passwordMessage = '';
    this.passwordMessageType = '';
    this.passwordValidated = false;
    const passwordControl = this.profileForm?.get('password');
    if (passwordControl && String(passwordControl.value || '').length > 0) {
      passwordControl.setValue('', { emitEvent: false });
    }
    if (passwordControl?.hasError('incorrectPassword')) {
      passwordControl.setErrors(null);
    }
    passwordControl?.markAsUntouched();
    passwordControl?.markAsPristine();
  }

  private scheduleValidationMessageClear() {
    this.clearValidationMessageTimer();
    this.validationMessageTimer = setTimeout(() => {
      this.passwordError = '';
      this.passwordSuccess = '';
      this.passwordMessage = '';
      this.passwordMessageType = '';
      const passwordControl = this.profileForm?.get('password');
      if (passwordControl?.hasError('incorrectPassword')) {
        passwordControl.setErrors(null);
      }
      this.cdr.detectChanges();
    }, 2000);
  }

  private clearValidationMessageTimer() {
    if (this.validationMessageTimer) {
      clearTimeout(this.validationMessageTimer);
      this.validationMessageTimer = null;
    }
  }

  updateProfile() {
    this.submitted = true;
    this.passwordError = '';
    const passwordControl = this.profileForm.get('password');
    passwordControl?.setErrors(null);

    if (this.profileForm.invalid || !this.passwordValidated) {
      if (!this.passwordValidated) {
        this.passwordError = 'Please validate password first';
        alert('Please validate password first');
      }
      return;
    }

    const formValue = this.profileForm.getRawValue();

    const data = {
      user_id: this.user_id,
      password: String(formValue.password || '').trim(),
      user_name: formValue.user_name,
      email: formValue.email,
      contact_no: formValue.mobile,
      hrmsid: formValue.hrmsid,
      designation: formValue.designation,
      zone: formValue.zone,
      division: formValue.division,
    };

    this.api.updateProfile(data).subscribe({
      next: (res: any) => {
        if (res.status) {
          alert('Profile updated successfully ');
          this.submitted = false;
          this.profileForm.patchValue({ password: '' });
          this.passwordValidated = false;
          this.passwordSuccess = '';
        } else {
          this.passwordError = res?.message || 'Profile update failed';
          passwordControl?.setErrors({ incorrectPassword: true });
          this.passwordValidated = false;
        }
      },
      error: (err) => {
        this.passwordError = err?.error?.message || 'Something went wrong';
        if (err?.status === 401) {
          passwordControl?.setErrors({ incorrectPassword: true });
          passwordControl?.markAsTouched();
          this.passwordValidated = false;
        }
      },
    });
  }
}
