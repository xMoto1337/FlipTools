export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && !!window.__TAURI__;
};
