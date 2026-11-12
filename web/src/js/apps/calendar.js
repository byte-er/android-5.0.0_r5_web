// packages/apps/Calendar - month view + local events.
import { h, icon, MONTHS, DAYS, fmtTime } from '../core/dom.js';
import { App, registerApp } from '../core/system.js';
import { db } from '../core/db.js';
import { prefs } from '../core/prefs.js';
import { toolbar, listItem, fab, dialog, toast, emptyState } from '../core/ui.js';
import { timePicker } from './clock.js';

const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

class Calendar extends App {
  onCreate(root) {
    const now = new Date();
    this.month = new Date(now.getFullYear(), now.getMonth(), 1);
    this.sel = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this.tb = toolbar({ title: '', actions: [{ icon: 'chevronLeft', label: 'Previous month', onClick: () => this.shift(-1) }, { icon: 'event', label: 'Today', onClick: () => { const n = new Date(); this.month = new Date(n.getFullYear(), n.getMonth(), 1); this.sel = new Date(n.getFullYear(), n.getMonth(), n.getDate()); this.render(); } }, { icon: 'chevronRight', label: 'Next month', onClick: () => this.shift(1) }] });
    this.grid = h('div.cal-grid');
    this.events = h('div.cal-events');
    root.append(h('div.calendar', null, this.tb, h('div.cal-dow', null, DAYS.map(d => h('span', d[0]))), this.grid, h('div.page-content', this.events), fab('add', () => this.addEvent())));
    this.render();
  }
  shift(n) { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1); this.render(); }
  async render() {
    this.tb.setTitle(`${MONTHS[this.month.getMonth()]} ${this.month.getFullYear()}`);
    const evs = await db.all('events');
    const has = new Set(evs.map(e => dayKey(new Date(e.start))));
    this.grid.innerHTML = '';
    const first = new Date(this.month); first.setDate(1 - first.getDay());
    const today = dayKey(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(first); d.setDate(first.getDate() + i);
      const k = dayKey(d);
      this.grid.append(h('button.cal-day.rip' + (d.getMonth() !== this.month.getMonth() ? '.other' : '') + (k === today ? '.today' : '') + (k === dayKey(this.sel) ? '.sel' : ''),
        { onclick: () => { this.sel = d; if (d.getMonth() !== this.month.getMonth()) this.month = new Date(d.getFullYear(), d.getMonth(), 1); this.render(); } },
        String(d.getDate()), has.has(k) ? h('span.cal-dot') : null));
    }
    const list = evs.filter(e => dayKey(new Date(e.start)) === dayKey(this.sel)).sort((a, b) => a.start - b.start);
    this.events.innerHTML = '';
    this.events.append(h('div.subheader', this.sel.toDateString()));
    if (!list.length) this.events.append(emptyState('event', 'No events'));
    list.forEach(e => this.events.append(listItem({ icon: h('span.cal-color', { style: { background: e.color || '#4285f4' } }), title: e.title, summary: fmtTime(new Date(e.start), prefs.get('time_24')) + (prefs.get('time_24') ? '' : new Date(e.start).getHours() < 12 ? ' AM' : ' PM'),
      widget: h('button.tb-btn.rip.rip-u', { onclick: async ev => { ev.stopPropagation(); await db.del('events', e.id); this.render(); } }, icon('delete')) })));
  }
  addEvent() {
    const title = h('input.text-field', { placeholder: 'Event name' });
    let hh = 9, mm = 0;
    const timeBtn = h('button.btn.flat.rip', { onclick: () => timePicker({ hour: hh, minute: mm, onSet: (a, b) => { hh = a; mm = b; timeBtn.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; } }) }, '09:00');
    const colors = ['#4285f4', '#0f9d58', '#db4437', '#f4b400', '#ab47bc'];
    let color = colors[0];
    const sw = h('div.color-row', null, colors.map(c => h('button.color-dot' + (c === color ? '.on' : ''), { style: { background: c }, onclick: e => { color = c; sw.querySelectorAll('.color-dot').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
    dialog({ title: 'New event · ' + this.sel.toDateString(), view: h('div', title, h('div.row', 'Starts at ', timeBtn), sw), buttons: [{ label: 'Cancel' }, { label: 'Save', onClick: async () => {
      if (!title.value.trim()) { toast('Enter a name'); return false; }
      const d = new Date(this.sel); d.setHours(hh, mm, 0, 0);
      await db.put('events', { title: title.value.trim(), start: d.getTime(), color }); this.render();
    } }] });
    setTimeout(() => title.focus(), 200);
  }
}
registerApp({ id: 'calendar', label: 'Calendar', icon: 'calendar', color: '#4285f4', colorDark: '#3367d6', accent: '#4285f4', pkg: 'com.android.calendar', stores: ['events'] }, Calendar);
