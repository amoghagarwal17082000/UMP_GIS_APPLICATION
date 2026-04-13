import { Injectable } from '@angular/core';
import { AuthApi } from './auth/auth.api';
import { CommonDashboardApi } from './common/dashboard/dashboard.api';
import { CommonViewingApi } from './common/viewing/common-viewing.api';
import { CivilEngineeringAssetsViewingApi } from './civil_engineering_assets/viewing/viewing.api';
import { CivilEngineeringAssetsEditingApi } from './civil_engineering_assets/editing/editing.api';
import { FeedbackApi } from './feedback/feedback.api';
import { ProfileApi } from './profile/profile.api';
import { RatingApi } from './rating/rating.api';
import { UserManagementApi } from './user_management/user-management.api';

@Injectable({ providedIn: 'root' })
export class Api {
  constructor(
    private authApi: AuthApi,
    private commonViewingApi: CommonViewingApi,
    private commonDashboardApi: CommonDashboardApi,
    private ceaViewingApi: CivilEngineeringAssetsViewingApi,
    private ceaEditingApi: CivilEngineeringAssetsEditingApi,
    private feedbackApi: FeedbackApi,
    private profileApi: ProfileApi,
    private ratingApi: RatingApi,
    private userManagementApi: UserManagementApi,
  ) {}

  getStations(bbox: string) {
    return this.commonViewingApi.getStations(bbox);
  }
  getTracks(bbox: string) {
    return this.commonViewingApi.getTracks(bbox);
  }
  getkmposts(bbox: string) {
    return this.commonViewingApi.getKmPosts(bbox);
  }
  getIndiaBoundary(bbox: string) {
    return this.commonViewingApi.getIndiaBoundary(bbox);
  }

  getDivisionBuffer() {
    return this.commonViewingApi.getDivisionBuffer();
  }
  getDivisionBufferKey(z: number) {
    return this.commonViewingApi.getDivisionBufferKey(z);
  }
  getDepartmentLayerCatalog(departmentRef: string) {
    return this.commonViewingApi.getDepartmentLayerCatalog(departmentRef);
  }
  getDepartmentLayerData(departmentRef: string, layerKey: string, bbox: string) {
    return this.commonViewingApi.getDepartmentLayerData(departmentRef, layerKey, bbox);
  }
  getlandboundary(bbox: string) {
    return this.ceaViewingApi.getLandBoundary(bbox);
  }
  getLandOffset(bbox: string) {
    return this.ceaViewingApi.getLandOffset(bbox);
  }
  getLandPlanOntrack(z: number) {
    return this.ceaViewingApi.getLandPlanOnTrack(z);
  }

  getStationTable(page: number, pageSize: number, search: string) {
    return this.ceaEditingApi.getStationTable(page, pageSize, search);
  }
  getStationDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.ceaEditingApi.getStationDraftTable(page, pageSize, search, status);
  }
  updateStation(id: number, payload: any) {
    return this.ceaEditingApi.updateStation(id, payload);
  }
  sendStationEdit(id: number, payload: any) {
    return this.ceaEditingApi.sendStationEdit(id, payload);
  }
  requestStationDeletion(id: number) {
    return this.ceaEditingApi.requestStationDeletion(id);
  }
  requestStationDraftDeletion(id: number) {
    return this.ceaEditingApi.requestStationDraftDeletion(id);
  }
  resendStationDraft(id: number, payload: any) {
    return this.ceaEditingApi.resendStationDraft(id, payload);
  }
  deleteStation(id: number) {
    return this.ceaEditingApi.deleteStation(id);
  }
  createStation(payload: any) {
    return this.ceaEditingApi.createStation(payload);
  }
  sendNewStationEdit(payload: any) {
    return this.ceaEditingApi.sendNewStationEdit(payload);
  }
  getStationById(id: number) {
    return this.ceaEditingApi.getStationById(id);
  }
  getStationDraftById(id: number) {
    return this.ceaEditingApi.getStationDraftById(id);
  }
  updateStationDraftStatus(id: number, status: string) {
    return this.ceaEditingApi.updateStationDraftStatus(id, status);
  }
  getStationByCode(code: string) {
    return this.ceaEditingApi.getStationByCode(code);
  }
  validateStationCode(code: string) {
    return this.ceaEditingApi.validateStationCode(code);
  }

  requestOtp(username: string, password: string) {
    return this.authApi.requestOtp(username, password);
  }
  verifyOtp(username: string, otp: string) {
    return this.authApi.verifyOtp(username, otp);
  }
  resendOtp(username: string) {
    return this.authApi.resendOtp(username);
  }
  getNewCaptcha() {
    return this.authApi.getNewCaptcha();
  }
  validateCaptcha(captchaId: string, captchaValue: string) {
    return this.authApi.validateCaptcha(captchaId, captchaValue);
  }
  login(username: string, password: string) {
    return this.authApi.login(username, password);
  }

  getStationCount(type: string) {
    return this.commonDashboardApi.getStationCount(type);
  }
  getBridgeStartCount(type: string) {
    return this.commonDashboardApi.getBridgeStartCount(type);
  }
  getBridgeStopCount(type: string) {
    return this.commonDashboardApi.getBridgeStopCount(type);
  }
  getBridgeMinorCount(type: string) {
    return this.commonDashboardApi.getBridgeMinorCount(type);
  }
  getLevelXingCount(type: string) {
    return this.commonDashboardApi.getLevelXingCount(type);
  }
  getRoadOverBridgeCount(type: string) {
    return this.commonDashboardApi.getRoadOverBridgeCount(type);
  }
  getRubLhsCount(type: string) {
    return this.commonDashboardApi.getRubLhsCount(type);
  }
  getRorCount(type: string) {
    return this.commonDashboardApi.getRorCount(type);
  }
  getKmPostCount(type: string) {
    return this.commonDashboardApi.getKmPostCount(type);
  }
  getLandPlanCount(type: string) {
    return this.commonDashboardApi.getLandPlanCount(type);
  }

  rating(obj: any) {
    return this.ratingApi.rating(obj);
  }
  getRating(obj: any) {
    return this.ratingApi.getRating(obj);
  }

  addFeedBack(obj: any) {
    return this.feedbackApi.addFeedBack(obj);
  }

  updateProfile(obj: any) {
    return this.profileApi.updateProfile(obj);
  }

  validateProfilePassword(obj: any) {
    return this.profileApi.validatePassword(obj);
  }

  getUsers() {
    return this.userManagementApi.getUsers();
  }

  getMakerCheckerList() {
    return this.userManagementApi.getMakerCheckerList();
  }

  assignChecker(data: any) {
    return this.userManagementApi.assignChecker(data);
  }

  getAssignedCheckerUsers() {
    return this.userManagementApi.getAssignedCheckerUsers();
  }

  unassignChecker(data: any) {
    return this.userManagementApi.unassignChecker(data);
  }

  updateUserDetails(data: any) {
    return this.userManagementApi.updateUserDetails(data);
  }

  getMakerLayerList() {
    return this.userManagementApi.getMakerLayerList();
  }

  getDepartmentLayers(departmentId: string) {
    return this.userManagementApi.getDepartmentLayers(departmentId);
  }

  assignLayers(data: any) {
    return this.userManagementApi.assignLayers(data);
  }

  getAssignedLayerUsers() {
    return this.userManagementApi.getAssignedLayerUsers();
  }

  updateAssignedLayers(data: any) {
    return this.userManagementApi.updateAssignedLayers(data);
  }

  clearAssignedLayers(data: any) {
    return this.userManagementApi.clearAssignedLayers(data);
  }
}

