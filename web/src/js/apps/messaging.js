// packages/apps/Mms - conversations stored locally; "Lollipop Bot" (5550) replies.
import { h, icon, letterTile, fmtTime } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { db } from '../core/db.js';
import { prefs } from '../core/prefs.js';
import { nm } from '../core/notifications.js';
import { toolbar, listItem, PageStack, fab, toast, emptyState } from '../core/ui.js';
import { getContacts, contactPicker } from './contacts.js';
import { BUILD_PROPS } from '@gen';
import { evaluate, doubleToString } from './calculator.js';

function botReply(text) {
  const t = text.toLowerCase();
  if (/time/.test(t)) return `It's ${fmtTime(new Date(), prefs.get('time_24'))}.`;
  if (/date|day/.test(t)) return `Today is ${new Date().toDateString()}.`;
  if (/version|android/.test(t)) return `I'm running Android ${BUILD_PROPS['ro.build.version.release']} (${BUILD_PROPS['ro.build.id']}), API level ${BUILD_PROPS['ro.build.version.sdk']}.`;
  if (/hello|hi\b|hey/.test(t)) return 'Hi there! Ask me the time, the date, or which Android version this is.';
  if (/joke/.test(t)) return 'Why did the Android go to therapy? Too many unresolved intents.';
  const math = t.match(/[0-9.]+(\s*[-+*/^]\s*[0-9.]+)+/);
  if (math) { try { return 'That equals ' + doubleToString(evaluate(math[0])) + '.'; } catch {} }
  return 'Sweet as a Lollipop. 🍭 (Try asking for the time, date, version or a joke.)';
}

class Messaging extends App {
  onCreate(root, intent) {
    this.stack = new PageStack(root);
    this.convList = h('div.conv-list');
    const main = h('div', null, toolbar({ title: 'Messaging', actions: [{ icon: 'search', label: 'Search', onClick: () => toast('Search messages') }] }), h('div.page-content', this.convList), fab('add', () => this.compose()));
    main.onShow = () => this.renderList();
    this.stack.push(main, false);
    this.renderList();
    if (intent.to) this.openThread(intent.to, intent.name);
  }
  onNewIntent(intent) { if (intent.to) { while (this.stack.pop()); this.openThread(intent.to, intent.name); } }
  onBack() { return this.stack.pop(); }
  async renderList() {
    const msgs = await db.all('messages');
    const byAddr = {};
    msgs.forEach(m => { if (!byAddr[m.addr] || byAddr[m.addr].date < m.date) byAddr[m.addr] = m; });
    const contacts = await getContacts();
    this.convList.innerHTML = '';
    const convs = Object.values(byAddr).sort((a, b) => b.date - a.date);
    if (!convs.length) this.convList.append(emptyState('message', 'Start a conversation with the + button. Text "Lollipop Bot" (5550) for a reply.'));
    for (const m of convs) {
      const c = contacts.find(c => c.phone === m.addr);
      const name = c ? c.name : m.addr;
      this.convList.append(listItem({ avatar: letterTile(name), title: name, summary: (m.out ? 'You: ' : '') + m.text, onClick: () => this.openThread(m.addr, name), widget: h('div.li-time', fmtTime(new Date(m.date), prefs.get('time_24'))) }));
    }
  }
  compose() {
    contactPicker(c => this.openThread(c.phone, c.name));
  }
  async openThread(addr, name) {
    const list = h('div.msg-list');
    const input = h('textarea.msg-input', { rows: 1, placeholder: 'Type message' });
    const render = async () => {
      const msgs = (await db.all('messages')).filter(m => m.addr === addr).sort((a, b) => a.date - b.date);
      list.innerHTML = '';
      msgs.forEach(m => list.append(h('div.msg' + (m.out ? '.out' : '.in'), !m.out ? letterTile(name, 32) : null, h('div.bubble', h('div', m.text), h('div.msg-time', fmtTime(new Date(m.date), prefs.get('time_24')) + (m.out ? ' ✓' : ''))))));
      list.scrollTop = list.scrollHeight;
    };
    const send = async () => {
      const text = input.value.trim(); if (!text) return;
      input.value = '';
      await db.put('messages', { addr, text, out: true, date: Date.now() });
      render();
      const isBot = addr === '5550' || /bot/i.test(name || '');
      if (isBot) setTimeout(async () => {
        const reply = botReply(text);
        await db.put('messages', { addr, text: reply, out: false, date: Date.now() });
        if (sys.current === this.task && this.thread === addr) render();
        else nm.notify({ appId: 'messaging', smallIcon: 'mdi:message', color: '#0f9d58', title: name, text: reply, headsUp: true, intent: { to: addr, name } });
      }, 1500);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const page = h('div.thread', null, toolbar({ title: name || addr, sub: name && name !== addr ? addr : null, back: () => this.stack.pop(), actions: [{ icon: 'phone', label: 'Call', onClick: () => sys.launch('phone', { call: addr, name }) }] }),
      list, h('div.msg-compose', input, h('button.send-btn.rip.rip-u', { onclick: send }, icon('send'))));
    this.thread = addr;
    page.onHide = () => { this.thread = null; };
    this.stack.push(page);
    render();
    setTimeout(() => input.focus(), 250);
  }
}
registerApp({ id: 'messaging', label: 'Messaging', icon: 'messaging', color: '#0f9d58', colorDark: '#0b8043', accent: '#0f9d58', pkg: 'com.android.mms', stores: ['messages'] }, Messaging);
