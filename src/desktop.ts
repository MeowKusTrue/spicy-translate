// Inside the desktop app (Tauri, window without system frame): our own title bar with window buttons, no page scroll,
// no browser context menu. In a normal browser none of this applies.
import { S, emit } from './state.ts';

type Win = { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; isMaximized(): Promise<boolean>; onResized(cb: () => void): Promise<() => void> };
const T = (window as unknown as { __TAURI__?: { window?: { getCurrentWindow(): Win } } }).__TAURI__;
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
  const w = win()!, upd = () => w.isMaximized().then(m => { if (m !== S.maxed) { S.maxed = m; emit(); } });
  upd(); w.onResized(upd);
}
