// Settings.System / Settings.Secure equivalent, persisted in localStorage.
const KEY = 'android5web.settings';
const DEFAULTS = {
  wallpaper: 'wallpaper/lollipop.jpg',
  brightness: 1,
  time_24: false,
  screen_off_timeout: 120000,
  font_scale: 1,
  touch_sounds: true,
  lock_sounds: true,
  dial_tones: true,
  vol_ring: 0.7, vol_media: 0.7, vol_alarm: 0.8, vol_notification: 0.7,
  ringer_mode: 'normal', // normal | vibrate | silent
  ringtone: 'Titania', notification_sound: 'Tethys', alarm_sound: 'Osmium',
  wifi: true, bluetooth: false, airplane: false, location: true, rotation_lock: false,
  hotspot: false, cast: false, invert: false, data: true,
  lock_type: 'swipe', lock_pin: '', lock_pattern: '',
  tts_lang: 'en-US', tts_rate: 100, tts_pitch: 100,
  talkback: false, large_text: false,
  dev_enabled: false, show_bounds: false, show_touches: false, anim_scale: 1,
  keyboard: 'auto',
  egg_mode: 0,
  unknown_sources: false,
  user_name: 'Owner',
};
let state = { ...DEFAULTS };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const listeners = new Map();

export const prefs = {
  get: k => state[k],
  set(k, v) {
    if (state[k] === v) return;
    state[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    (listeners.get(k) || []).forEach(f => f(v));
    (listeners.get('*') || []).forEach(f => f(k, v));
  },
  on(k, f) { if (!listeners.has(k)) listeners.set(k, []); listeners.get(k).push(f); return f; },
  off(k, f) { const l = listeners.get(k); if (l) l.splice(l.indexOf(f) >>> 0, 1); },
  reset() { try { localStorage.removeItem(KEY); } catch {} state = { ...DEFAULTS }; },
};
