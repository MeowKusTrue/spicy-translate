let dismiss: (() => void) | null = null;
export function closeContextMenu() { dismiss?.(); }
/** Shared native-like menu: viewport bounds, keyboard navigation and one cleanup path. */
export function popMenu(e: { clientX: number; clientY: number }, title: string, build: (item: (label: string, f: () => void, off?: boolean, checked?: boolean) => void) => void) {
  closeContextMenu();
  const focus = document.activeElement as HTMLElement | null;
  const m = document.createElement('div'); m.id = 'lineMenu'; m.className = 'pop ctx'; m.setAttribute('role','menu'); m.setAttribute('aria-label',title);
  const h = document.createElement('small'); h.textContent = title; m.append(h);
  const close = () => { m.remove(); removeEventListener('pointerdown', outside, true); removeEventListener('keydown', key, true); removeEventListener('resize', close); if (dismiss === close) dismiss = null; };
  const outside = (ev: Event) => { if (!m.contains(ev.target as Node)) close(); };
  const key = (ev: KeyboardEvent) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && m.contains(document.activeElement)) {
      ev.preventDefault(); ev.stopImmediatePropagation(); (document.activeElement as HTMLButtonElement).click(); return;
    }
    if (!['Escape','ArrowUp','ArrowDown','Home','End','Tab'].includes(ev.key)) { if (m.contains(document.activeElement)) ev.stopImmediatePropagation(); return; }
    ev.stopImmediatePropagation();
    if (ev.key === 'Tab') { close(); return; }
    ev.preventDefault();
    if (ev.key === 'Escape') { close(); if (focus?.isConnected) focus.focus({preventScroll:true}); return; }
    const buttons = [...m.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[ev.key === 'Home' ? 0 : ev.key === 'End' ? buttons.length-1 : (at + (ev.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };
  build((label, f, off = false, checked) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sm'; b.textContent = label; b.disabled = off;
    b.setAttribute('role', checked == null ? 'menuitem' : 'menuitemradio'); b.setAttribute('aria-label',label);
    if (checked != null) b.setAttribute('aria-checked', String(checked));
    b.onclick = () => { close(); f(); }; m.append(b);
  });
  document.body.append(m);
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, e.clientX)) + 'px';
  m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, e.clientY)) + 'px';
  dismiss = close; addEventListener('pointerdown', outside, true); addEventListener('keydown', key, true); addEventListener('resize', close);
  m.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
}
