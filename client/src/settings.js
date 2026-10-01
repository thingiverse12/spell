/** Spell - persistent client settings (localStorage). */

const KEY = 'spell.settings.v1';

const DEFAULTS = {
  renderDistance: 160,
  fov: 78,
  sensitivity: 1.6,
  shadows: true,
  invertY: false,
  sound: true,
  lang: 'sv',
  simpleGraphics: false,
  playerName: '',
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch { /* first run / private mode */ }
  // pick a sensible default for weak devices
  if (!localStorage.getItem(KEY)) {
    const cores = navigator.hardwareConcurrency || 4;
    if (cores <= 4) { settings.renderDistance = 110; settings.shadows = false; }
  }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function playerId() {
  const idKey = 'spell.playerId';
  let id = localStorage.getItem(idKey);
  if (!id) {
    id = `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(idKey, id);
  }
  return id;
}
