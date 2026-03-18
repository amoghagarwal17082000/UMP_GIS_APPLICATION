import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from 'src/app/services/api';
import { CurrentUserService } from 'src/app/services/current-user';


@Component({
  selector: 'app-feedback',
  imports: [FormsModule, CommonModule],
  templateUrl: './feedback.html',
  styleUrl: './feedback.css',
})

export class Feedback implements OnInit {

  feedbackForm: any = {
    name: '',
    email: '',
    mobile: '',
    user_type: '',
    message: '',
  };

  lastFeedback: any = null;

  user_id: any = Number;
  message: any = '';
  user_name: any = '';
  user_type: any = '';
  mobile: any = '';
  email: any = '';

  constructor(
    private api: Api,
    private cd: ChangeDetectorRef,
    private currentUser: CurrentUserService
  ) {}

  ngOnInit(): void {
    const user = this.currentUser.getSnapshot();
    this.user_id = user?.user_id || '';
    this.user_name = user?.user_name || '';
    this.user_type = user?.user_type || '';
    this.mobile = user?.mobile || '';
    this.email = user?.email || '';
  }

  submitFeedback() {
    const data = {
      message: this.message,
    };

    this.api.addFeedBack(data).subscribe((res: any) => {
      if (res.status) {
        this.lastFeedback = res.data;
      } else {
        alert('feedback not added');
      }
      this.message = '';
      this.cd.detectChanges();
    });
  }

}
