import { onSongChange, toggle } from './app.ts';

declare const Spicetify: any;
const ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h8v1.5H6.75V13h-1.5V4.5H2zm9 4h3v1.2h-.9c-.2 1.3-.8 2.4-1.6 3.2.5.3 1 .5 1.6.6l-.4 1.2c-.8-.2-1.5-.5-2.1-.9-.6.4-1.3.7-2.1.9l-.4-1.2c.6-.1 1.1-.3 1.6-.6-.5-.5-.9-1.2-1.2-1.9l1.1-.4c.2.5.5 1 .9 1.4.5-.6.9-1.3 1-2.1H11z"/></svg>';

// extensions load before Spicetify is ready
(function wait() {
  if (!(window as any).Spicetify?.Player?.data || !Spicetify.Topbar || !Spicetify.LocalStorage) { setTimeout(wait, 300); return; }
  new Spicetify.Topbar.Button('Spicy Translate', ICON, () => toggle());
  if (Spicetify.Playbar?.Button) new Spicetify.Playbar.Button('Spicy Translate', ICON, () => toggle(), false, false, true);
  Spicetify.Player.addEventListener('songchange', onSongChange);
})();
