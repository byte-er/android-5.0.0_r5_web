// packages/apps/Contacts (Lollipop): letter tiles, colored detail header, editor.
import { h, icon, letterTile, tileColor } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { db } from '../core/db.js';
import { toolbar, listItem, PageStack, fab, dialog, toast, tabs, emptyState } from '../core/ui.js';

const SEED = [
  { name: 'Ada Lovelace', phone: '+44 20 7946 0018', email: 'ada@example.com', starred: true },
  { name: 'Alan Turing', phone: '+44 161 496 0912', email: 'alan@example.com' },
  { name: 'Grace Hopper', phone: '+1 202 555 0147', email: 'grace@example.com', starred: true },
  { name: 'Linus Torvalds', phone: '+1 503 555 0199', email: 'linus@example.com' },
  { name: 'Lollipop Bot', phone: '5550', email: '', starred: false, bot: true },
];
let seeding = null;
function seed() {
  if (!seeding) seeding = (async () => {
    if (localStorage.getItem('android5web.contacts.seeded')) return;
    try { localStorage.setItem('android5web.contacts.seeded', '1'); } catch {}
    if ((await db.all('contacts')).length) return;
    for (const c of SEED) await db.put('contacts', { ...c });
  })();
  return seeding;
}
export async function getContacts() {
  await seed();
  return (await db.all('contacts')).sort((a, b) => a.name.localeCompare(b.name));
}
export function contactPicker(onPick) {
  getContacts().then(list => dialog({ title: 'Choose a contact', items: list.map(c => ({ label: `${c.name}  ${c.phone || ''}`, onClick: () => onPick(c) })), buttons: [{ label: 'Cancel' }] }));
}

class Contacts extends App {
  onCreate(root) {
    this.stack = new PageStack(root);
    this.list = h('div.contact-list');
    this.favs = h('div.contact-favs');
    this.filter = '';
    const search = h('input.tb-search', { placeholder: 'Search contacts', oninput: e => { this.filter = e.target.value.toLowerCase(); this.render(); } });
    const tb = tabs(['FAVORITES', 'ALL CONTACTS'], i => { this.tab = i; this.render(); });
    const main = h('div', null, h('div.contacts-head', toolbar({ title: 'Contacts', menu: [{ label: 'Import vCard (.vcf)…', onClick: () => this.importVcf() }, { label: 'Export to .vcf', onClick: () => this.exportVcf() }] }), tb),
      h('div.page-content', h('div.search-wrap', icon('search'), search), this.favs, this.list), fab('add', () => this.edit()));
    main.onShow = () => this.render();
    this.stack.push(main, false);
    this.tab = 1; tb.select(1, true);
    this.render();
  }
  onBack() { return this.stack.pop(); }
  async render() {
    const all = (await getContacts()).filter(c => !this.filter || c.name.toLowerCase().includes(this.filter) || (c.phone || '').includes(this.filter));
    this.list.innerHTML = ''; this.favs.innerHTML = '';
    const shown = this.tab === 0 ? all.filter(c => c.starred) : all;
    if (this.tab === 0) {
      shown.forEach(c => this.favs.append(h('div.fav-tile.rip', { onclick: () => this.detail(c), style: { background: tileColor(c.name) } }, h('div.fav-letter', c.name[0]), h('div.fav-name', c.name))));
      if (!shown.length) this.favs.append(emptyState('star', 'No favorites'));
      return;
    }
    let letter = '';
    for (const c of shown) {
      const L = c.name[0].toUpperCase();
      const row = listItem({ avatar: letterTile(c.name), title: c.name, onClick: () => this.detail(c), cls: 'contact-row' });
      if (L !== letter) { letter = L; row.prepend(h('div.section-letter', L)); } else row.prepend(h('div.section-letter'));
      this.list.append(row);
    }
    if (!shown.length) this.list.append(emptyState('person', 'No contacts'));
  }
  detail(c) {
    const color = tileColor(c.name);
    const page = h('div.contact-detail', null,
      h('div.cd-header', { style: { background: color } },
        toolbar({ title: '', back: () => this.stack.pop(), cls: 'transparent', actions: [
          { icon: 'star', label: 'Favorite', onClick: async () => { c.starred = !c.starred; await db.put('contacts', c); toast(c.starred ? 'Added to favorites' : 'Removed from favorites'); } },
          { icon: 'edit', label: 'Edit', onClick: () => this.edit(c) }],
          menu: [{ label: 'Delete', onClick: () => dialog({ message: 'This contact will be deleted.', buttons: [{ label: 'Cancel' }, { label: 'OK', onClick: async () => { await db.del('contacts', c.id); this.stack.pop(); this.render(); } }] }) }] }),
        h('div.cd-letter', c.name[0]), h('div.cd-name', c.name)),
      h('div.page-content.settings-list', null,
        c.phone ? listItem({ icon: 'phone', title: c.phone, summary: 'Mobile', onClick: () => sys.launch('phone', { call: c.phone, name: c.name }), widget: h('button.tb-btn.rip.rip-u', { onclick: e => { e.stopPropagation(); sys.launch('messaging', { to: c.phone, name: c.name }); } }, icon('message')) }) : null,
        c.email ? listItem({ icon: 'send', title: c.email, summary: 'Email', onClick: () => window.open('mailto:' + c.email) }) : null));
    page.querySelector('.cd-header').style.setProperty('--primary', color);
    this.setStatusBarColor(color);
    page.onHide = () => this.setStatusBarColor(this.manifest.colorDark);
    this.stack.push(page);
  }
  edit(c = {}) {
    const f = k => h('input.text-field', { value: c[k] || '', placeholder: { name: 'Name', phone: 'Phone', email: 'Email' }[k], type: k === 'phone' ? 'tel' : k === 'email' ? 'email' : 'text' });
    const name = f('name'), phone = f('phone'), email = f('email');
    const page = h('div', null, toolbar({ title: c.id ? 'Edit contact' : 'Add new contact', back: () => this.stack.pop(), actions: [{ icon: 'check', label: 'Save', onClick: async () => {
      if (!name.value.trim()) return toast('Name is required');
      Object.assign(c, { name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim() });
      await db.put('contacts', c); toast('Contact saved'); this.stack.pop(); this.render();
    } }] }), h('div.page-content.editor', null, h('div.ed-row', icon('person'), name), h('div.ed-row', icon('phone'), phone), h('div.ed-row', icon('send'), email)));
    this.stack.push(page);
    setTimeout(() => name.focus(), 250);
  }
  importVcf() {
    const inp = h('input', { type: 'file', accept: '.vcf,text/vcard' });
    inp.onchange = async () => {
      const text = await inp.files[0].text();
      let n = 0;
      for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
        const name = (card.match(/^FN[^:]*:(.*)$/mi) || [])[1], phone = (card.match(/^TEL[^:]*:(.*)$/mi) || [])[1], email = (card.match(/^EMAIL[^:]*:(.*)$/mi) || [])[1];
        if (name) { await db.put('contacts', { name: name.trim(), phone: (phone || '').trim(), email: (email || '').trim() }); n++; }
      }
      toast(`Imported ${n} contacts`); this.render();
    };
    inp.click();
  }
  async exportVcf() {
    const all = await getContacts();
    const text = all.map(c => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\n${c.phone ? 'TEL:' + c.phone + '\r\n' : ''}${c.email ? 'EMAIL:' + c.email + '\r\n' : ''}END:VCARD`).join('\r\n');
    h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/vcard' })), download: 'contacts.vcf' }).click();
  }
}
registerApp({ id: 'contacts', label: 'Contacts', icon: 'contacts', color: '#0288d1', colorDark: '#0277bd', accent: '#0288d1', pkg: 'com.android.contacts', stores: ['contacts'] }, Contacts);
