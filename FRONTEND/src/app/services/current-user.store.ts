export type CurrentUser = {
  user_id: string;
  user_name: string;
  railway: string;
  division: string;
  department: string;
  user_type: string;
  unit_type: string;
  email?: string;
  mobile?: string;
};

let snapshot: CurrentUser | null = null;

export function setCurrentUserSnapshot(user: CurrentUser | null): void {
  snapshot = user;
}

export function getCurrentUserSnapshot(): CurrentUser | null {
  return snapshot;
}

export function clearCurrentUserSnapshot(): void {
  snapshot = null;
}
