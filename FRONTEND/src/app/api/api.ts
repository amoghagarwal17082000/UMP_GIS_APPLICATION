import { Injectable } from '@angular/core';
import { AuthApi } from './auth/auth.api';
import { CommonDashboardApi, DashboardCountFilters } from './common/dashboard/dashboard.api';
import { CommonLocationApi } from './common/location/location.api';
import { CommonViewingApi } from './common/viewing/common-viewing.api';
import { CivilEngineeringAssetsViewingApi } from './civil_engineering_assets/viewing/viewing.api';
import { CivilEngineeringAssetsEditingApi } from './civil_engineering_assets/editing/editing.api';
import { FeedbackApi } from './feedback/feedback.api';
import { ProfileApi } from './profile/profile.api';
import { RatingApi } from './rating/rating.api';
import { UserManagementApi } from './user_management/user-management.api';
import { SuperAdminUserManagementApi } from './super_admin/super-admin-user-management.api';


@Injectable({ providedIn: 'root' })
export class Api {
  constructor(
    private authApi: AuthApi,
    private commonLocationApi: CommonLocationApi,
    private commonViewingApi: CommonViewingApi,
    private commonDashboardApi: CommonDashboardApi,
    private ceaViewingApi: CivilEngineeringAssetsViewingApi,
    private ceaEditingApi: CivilEngineeringAssetsEditingApi,
    private feedbackApi: FeedbackApi,
    private profileApi: ProfileApi,
    private ratingApi: RatingApi,
    private userManagementApi: UserManagementApi,
    private superAdminUserManagementApi: SuperAdminUserManagementApi,
  ) {}

getStations(bbox: string, limit?: number, categories?: string[]) {
  return this.commonViewingApi.getStations(bbox, limit, categories);
}

searchStations(q: string, limit = 10) {
  return this.commonViewingApi.searchStations(q, limit);
}


  getTracks(bbox: string, z?: number) {
  return this.commonViewingApi.getTracks(bbox, z);
}
  getkmposts(bbox: string) {
    return this.commonViewingApi.getKmPosts(bbox);
  }
  getIndiaBoundary(bbox: string) {
    return this.commonViewingApi.getIndiaBoundary(bbox);
  }

  getStates() {
    return this.commonLocationApi.getStates();
  }

  getDistricts(filters: { state?: string; state_lgd?: number | string } = {}) {
    return this.commonLocationApi.getDistricts(filters);
  }

  getParliamentaryConstituencies(filters: { state?: string; q?: string; search?: string } = {}) {
    return this.commonLocationApi.getParliamentaryConstituencies(filters);
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
  getDepartmentLayerData(departmentRef: string, layerKey: string, bbox: string, limit?: number) {
    return this.commonViewingApi.getDepartmentLayerData(departmentRef, layerKey, bbox, limit);
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
  getBridgeStart(bbox: string) {
    return this.ceaViewingApi.getBridgeStart(bbox);
  }
  getBridgeEnd(bbox: string) {
    return this.ceaViewingApi.getBridgeEnd(bbox);
  }
  getBridgeMinor(bbox: string) {
    return this.ceaViewingApi.getBridgeMinor(bbox);
  }

  getStationTable(page: number, pageSize: number, search: string) {
    return this.ceaEditingApi.getStationTable(page, pageSize, search);
  }
  getBridgeStartTable(page: number, pageSize: number, search: string) {
    return this.ceaEditingApi.getBridgeStartTable(page, pageSize, search);
  }
  getBridgeEndTable(page: number, pageSize: number, search: string) {
    return this.ceaEditingApi.getBridgeEndTable(page, pageSize, search);
  }
  getBridgeMinorTable(page: number, pageSize: number, search: string) {
    return this.ceaEditingApi.getBridgeMinorTable(page, pageSize, search);
  }
  getLayerTable(layer: string, page: number, pageSize: number, search: string) {
    return this.ceaEditingApi.getLayerTable(layer, page, pageSize, search);
  }
  getStationDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.ceaEditingApi.getStationDraftTable(page, pageSize, search, status);
  }
  getBridgeStartDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.ceaEditingApi.getBridgeStartDraftTable(page, pageSize, search, status);
  }
  getBridgeEndDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.ceaEditingApi.getBridgeEndDraftTable(page, pageSize, search, status);
  }
  getBridgeMinorDraftTable(page: number, pageSize: number, search: string, status: string) {
    return this.ceaEditingApi.getBridgeMinorDraftTable(page, pageSize, search, status);
  }
  getLayerDraftTable(layer: string, page: number, pageSize: number, search: string, status: string) {
    return this.ceaEditingApi.getLayerDraftTable(layer, page, pageSize, search, status);
  }
  updateStation(id: number, payload: any) {
    return this.ceaEditingApi.updateStation(id, payload);
  }
  updateLayer(layer: string, id: number, payload: any) {
    return this.ceaEditingApi.updateLayer(layer, id, payload);
  }
  sendStationEdit(id: number, payload: any) {
    return this.ceaEditingApi.sendStationEdit(id, payload);
  }
  sendLayerEdit(layer: string, id: number, payload: any) {
    return this.ceaEditingApi.sendLayerEdit(layer, id, payload);
  }
  requestStationDeletion(id: number) {
    return this.ceaEditingApi.requestStationDeletion(id);
  }
  requestLayerDeletion(layer: string, id: number) {
    return this.ceaEditingApi.requestLayerDeletion(layer, id);
  }
  requestStationDraftDeletion(id: number) {
    return this.ceaEditingApi.requestStationDraftDeletion(id);
  }
  requestLayerDraftDeletion(layer: string, id: number) {
    return this.ceaEditingApi.requestLayerDraftDeletion(layer, id);
  }
  resendStationDraft(id: number, payload: any) {
    return this.ceaEditingApi.resendStationDraft(id, payload);
  }
  resendLayerDraft(layer: string, id: number, payload: any) {
    return this.ceaEditingApi.resendLayerDraft(layer, id, payload);
  }
  deleteStation(id: number) {
    return this.ceaEditingApi.deleteStation(id);
  }
  deleteLayer(layer: string, id: number) {
    return this.ceaEditingApi.deleteLayer(layer, id);
  }
  createStation(payload: any) {
    return this.ceaEditingApi.createStation(payload);
  }
  createLayer(layer: string, payload: any) {
    return this.ceaEditingApi.createLayer(layer, payload);
  }
  sendNewStationEdit(payload: any) {
    return this.ceaEditingApi.sendNewStationEdit(payload);
  }
  sendNewLayerEdit(layer: string, payload: any) {
    return this.ceaEditingApi.sendNewLayerEdit(layer, payload);
  }
  getStationById(id: number) {
    return this.ceaEditingApi.getStationById(id);
  }
  getLayerById(layer: string, id: number) {
    return this.ceaEditingApi.getLayerById(layer, id);
  }
  getStationDraftById(id: number) {
    return this.ceaEditingApi.getStationDraftById(id);
  }
  getLayerDraftById(layer: string, id: number) {
    return this.ceaEditingApi.getLayerDraftById(layer, id);
  }
  updateStationDraftStatus(id: number, status: string) {
    return this.ceaEditingApi.updateStationDraftStatus(id, status);
  }
  updateLayerDraftStatus(layer: string, id: number, status: string) {
    return this.ceaEditingApi.updateLayerDraftStatus(layer, id, status);
  }
  getStationByCode(code: string) {
    return this.ceaEditingApi.getStationByCode(code);
  }
  validateStationCode(code: string) {
    return this.ceaEditingApi.validateStationCode(code);
  }
  validateAssetId(layer: string, assetId: string, objectId?: number | null) {
    return this.ceaEditingApi.validateAssetId(layer, assetId, objectId);
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

  getStationCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getStationCount(type, filters);
}

getBridgeStartCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getBridgeStartCount(type, filters);
}

getBridgeStopCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getBridgeStopCount(type, filters);
}

getBridgeMinorCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getBridgeMinorCount(type, filters);
}

getLevelXingCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getLevelXingCount(type, filters);
}

getRoadOverBridgeCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getRoadOverBridgeCount(type, filters);
}

getRubLhsCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getRubLhsCount(type, filters);
}

getRorCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getRorCount(type, filters);
}

getKmPostCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getKmPostCount(type, filters);
}

getLandPlanCount(type: string, filters: DashboardCountFilters = {}) {
  return this.commonDashboardApi.getLandPlanCount(type, filters);
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

  getMakerLayerList(currentUserId?: string) {
    return this.userManagementApi.getMakerLayerList(currentUserId);
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

  getSuperAdminUsers() {
    return this.superAdminUserManagementApi.getAllUsers();
  }

  getSuperAdminUserDetails(objectid: number | string) {
    return this.superAdminUserManagementApi.getUser(objectid);
  }

  createSuperAdminUser(data: any) {
    return this.superAdminUserManagementApi.createUser(data);
  }

  updateSuperAdminUser(objectid: number | string, data: any) {
    return this.superAdminUserManagementApi.updateUser(objectid, data);
  }

  deleteSuperAdminUser(objectid: number | string) {
    return this.superAdminUserManagementApi.deleteUser(objectid);
  }
  getZoneDivisionFilters() {
  return this.commonDashboardApi.getZoneDivisionFilters();
}
}

