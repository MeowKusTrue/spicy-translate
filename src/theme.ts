// Themes: auto (follows the OS), dark (pure black), light (pure white). Tokens live in styles.css.
import { ls } from './state.ts';
import { drawWave, readTheme } from './waveform/wave.ts';
export type Theme = 'auto' | 'dark' | 'light';
export const theme = () => (ls.get('theme', 'auto') as Theme);
export function setTheme(t: Theme) { document.documentElement.dataset.theme = t; ls.set('theme', t); readTheme(); drawWave(); }
export function initTheme() {
  setTheme(theme());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { readTheme(); drawWave(); });
}
