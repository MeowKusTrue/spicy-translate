export interface AudioProgressState {
  stage: string; done: number; total: number; plan?: string[]; phase?: string;
  subDone?: number; subTotal?: number; bytes?: boolean;
}
const weights: Record<string, number> = { upload: 5, cache: 5, demucs: 30, karaoke: 15, transcribe: 25, locate: 25, backing: 25, align: 30 };
const fraction = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function audioStageFraction(state: AudioProgressState | null): number {
  if (!state) return 0;
  if (state.total > 0 && state.done >= state.total) return 1;
  if (state.subTotal && !state.bytes && state.total <= 1) return fraction((state.subDone || 0) / state.subTotal);
  return state.total > 0 ? fraction(state.done / state.total) : 0;
}

/** Weighted stage completion, not a promise of elapsed time or model-download completion. */
export function audioProgressPercent(state: AudioProgressState | null): number {
  if (!state) return 0;
  const plan = state.plan?.length ? state.plan : ['demucs', 'karaoke', 'align'];
  const all = plan.reduce((sum, step) => sum + (weights[step] || 10), 0);
  const actual = plan.indexOf(state.stage), current = actual >= 0 ? actual : plan.indexOf(state.phase || '');
  if (current < 0) return 0;
  const before = plan.slice(0, current).reduce((sum, step) => sum + (weights[step] || 10), 0);
  return Math.round((before + (actual >= 0 ? (weights[state.stage] || 10) * audioStageFraction(state) : 0)) / all * 100);
}
