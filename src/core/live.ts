// Which lines the karaoke preview shows as active and which it keeps painting.
// A line becomes active `look` s before it starts (so CSS transitions land on time) and stays active until shortly
// after its last word; it keeps being painted a bit longer so the last word finishes its fill instead of freezing.
// Overlapping lines (duets, background vocals) are all active at once. `idx` = the newest active line (scroll target).
export function liveLines(R: { a: number; b: number }[], T: number, look = 0.3) {
  let act = -1;
  const live: number[] = [], active: number[] = [];
  for (let i = 0; i < R.length; i++) {
    if (T + look < R[i].a) break;
    act = i;
    if (T <= R[i].b + 0.6) live.push(i);
    if (T <= R[i].b + 0.15) active.push(i);
  }
  return { act, live, active, idx: active.length ? active[active.length - 1] : -1 };
}
