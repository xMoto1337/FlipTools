export const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  // Tauri v2 uses __TAURI_INTERNALS__, v1 used __TAURI__
  return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    || !!(window as unknown as Record<string, unknown>).__TAURI__;
};
