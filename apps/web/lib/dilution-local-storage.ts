export const DILUTION_STORAGE_KEYS = {
  qdActual: 'wt.dilution.qd_actual',
  apiDil: 'wt.dilution.api_dil',
  wcOverride: 'wt.dilution.wc_override',
  wcOverrideEnabled: 'wt.dilution.wc_override_enabled',
  calcMode: 'wt.dilution.calc_mode',
} as const;

function hasLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredString(key: string, fallback = ''): string {
  if (!hasLocalStorage()) {
    return fallback;
  }

  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function setStoredString(key: string, value: string) {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

export function getStoredBoolean(key: string, fallback = false): boolean {
  const raw = getStoredString(key, fallback ? '1' : '0').toLowerCase();
  if (raw === '1' || raw === 'true') {
    return true;
  }
  if (raw === '0' || raw === 'false') {
    return false;
  }
  return fallback;
}

export function setStoredBoolean(key: string, value: boolean) {
  setStoredString(key, value ? '1' : '0');
}
