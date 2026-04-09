export type CurrentUser = {
  user_id: string;
  user_name: string;
  railway: string;
  division: string;
  actualDivision?: string;
  department: string;
  user_type: string;
  unit_type: string;
  email?: string;
  mobile?: string;
};

const USER_KEY = 'ump_current_user';
const TOKEN_KEY = 'ump_access_token';
const DIVISION_KEY = 'division';
const ASSET_DIVISION_KEY = 'asset_division';

function readUserFromSession(): CurrentUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

let snapshot: CurrentUser | null = readUserFromSession();

export function setCurrentUserSnapshot(user: CurrentUser | null): void {
  snapshot = user;
  if (user) {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(DIVISION_KEY, String(user.actualDivision || user.division || '').trim());
    localStorage.setItem(ASSET_DIVISION_KEY, String(user.division || '').trim());
  } else {
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(DIVISION_KEY);
    localStorage.removeItem(ASSET_DIVISION_KEY);
  }
}

export function getCurrentUserSnapshot(): CurrentUser | null {
  return snapshot;
}

export function clearCurrentUserSnapshot(): void {
  snapshot = null;
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(DIVISION_KEY);
  localStorage.removeItem(ASSET_DIVISION_KEY);
}

export function setAccessToken(token: string | null): void {
  const normalized = String(token || '').trim();
  if (normalized) {
    sessionStorage.setItem(TOKEN_KEY, normalized);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function getAccessToken(): string {
  return (sessionStorage.getItem(TOKEN_KEY) || '').trim();
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}
