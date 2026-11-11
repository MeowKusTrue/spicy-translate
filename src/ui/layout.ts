import { emit, ls } from '../state.ts';
import { drawWave } from '../waveform/wave.ts';

export type WorkspaceLayout = 'studio' | 'classic';
export const workspaceLayout = (): WorkspaceLayout => ls.get('workspaceLayout', 'studio') === 'classic' ? 'classic' : 'studio';
export function initWorkspaceLayout() { document.documentElement.dataset.layout = workspaceLayout(); }
export function setWorkspaceLayout(layout: WorkspaceLayout) {
  ls.set('workspaceLayout', layout); initWorkspaceLayout(); emit();
  requestAnimationFrame(drawWave);
}
