/** A smooth, media-time-driven pulse: rest at both boundaries, no delayed spring clock. */
export function karaokeMotion(progress: number, letter = false) {
  const p = Math.max(0, Math.min(1, progress));
  const glow = Number.isFinite(p) ? Math.sin(Math.PI * p) ** 2 : 0;
  return { s: 1 + (letter ? .06 : .025) * glow, y: -(letter ? .018 : .012) * glow, g: glow };
}
