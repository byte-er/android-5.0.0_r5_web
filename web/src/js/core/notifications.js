// NotificationManagerService
import { playNotificationSound } from './sound.js';
const items = new Map();
const listeners = [];
let seq = 1;
export const nm = {
  notify(n) {
    const id = n.id || 'n' + (seq++);
    const prev = items.get(id);
    const rec = { when: Date.now(), ...prev, ...n, id };
    items.set(id, rec);
    if (!prev && !n.silent && !n.ongoing) playNotificationSound();
    listeners.forEach(f => f('post', rec, !prev));
    return id;
  },
  cancel(id) { if (items.delete(id)) listeners.forEach(f => f('cancel', { id })); },
  cancelAll() { for (const [id, n] of items) if (!n.ongoing) items.delete(id); listeners.forEach(f => f('clear')); },
  list() { return [...items.values()].sort((a, b) => (b.ongoing - a.ongoing) || (b.priority || 0) - (a.priority || 0) || b.when - a.when); },
  get(id) { return items.get(id); },
  on(f) { listeners.push(f); },
};
