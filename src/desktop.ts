// Inside the desktop app (Tauri, window without system frame): our own title bar with window buttons, no page scroll,
// no browser context menu. In a normal browser none of this applies.
import { S, emit } from './state.ts';

type Win = { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; isMaximized(): Promise<boolean>; onResized(cb: () => void): Promise<() => void> };
const T = (window as unknown as { __TAURI__?: { window?: { getCurrentWindow(): Win }; webview?: { getCurrentWebview(): { setZoom(z: number): Promise<void> } } } }).__TAURI__;
export const isApp = !!T?.window;
const win = () => T?.window?.getCurrentWindow();
export const winMin = () => win()?.minimize();
export const winMax = () => win()?.toggleMaximize();
export const winClose = () => win()?.close();

export function initDesktop() {
  if (!isApp) return;
  document.documentElement.classList.add('app');
  // the WebView's own menu (Back / Reload / Inspect) makes no sense in an app; text fields keep copy / paste
  document.addEventListener('contextmenu', e => { if (!(e.target as Element).closest?.('input,textarea')) e.preventDefault(); });
  applyAppZoom();
  const w = win()!, upd = () => w.isMaximized().then(m => { if (m !== S.maxed) { S.maxed = m; emit(); } });
  upd(); w.onResized(upd);
}

/** interface scale in the app (Ctrl+= / Ctrl+- / Ctrl+0): webview zoom, remembered */
let zoom = (() => { try { return +(localStorage.getItem('appZoom') || 1) || 1; } catch { return 1; } })();
export function appZoom(step: number | 0) {
  zoom = step === 0 ? 1 : Math.min(1.6, Math.max(0.7, Math.round((zoom + step) * 10) / 10));
  try { localStorage.setItem('appZoom', String(zoom)); } catch {}
  T?.webview?.getCurrentWebview().setZoom(zoom).catch(() => {});
  return zoom;
}
export const applyAppZoom = () => { if (isApp && zoom !== 1) T?.webview?.getCurrentWebview().setZoom(zoom).catch(() => {}); };
