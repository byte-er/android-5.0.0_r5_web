// packages/apps/PackageInstaller (Lollipop): PackageInstallerActivity +
// InstallAppProgress, installing .wapk packages through core/packages.js.
import { h, icon, sleep } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { prefs } from '../core/prefs.js';
import { button, dialog, tabs, toast } from '../core/ui.js';
import { parseWapk, installParsed, installedPackage, permissionLabel } from '../core/packages.js';
import { PI_STRINGS } from '@gen';

const S = (k, d) => PI_STRINGS[k] || d;

class PackageInstaller extends App {
  onCreate(root, intent) { this.root = root; this.start(intent); }
  onNewIntent(intent) { this.start(intent); }

  async start(intent) {
    this.root.innerHTML = '';
    if (!intent.bytes) { this.finish(); return; }
    // Settings > Security > Unknown sources (Settings.Global.INSTALL_NON_MARKET_APPS)
    if (!prefs.get('unknown_sources')) {
      dialog({
        title: S('unknown_apps_dlg_title', 'Install blocked'), message: S('unknown_apps_dlg_text', 'For security, your phone is set to block installation of apps obtained from unknown sources.'),
        buttons: [{ label: S('cancel', 'Cancel'), onClick: () => this.finish() }, { label: S('settings', 'Settings'), onClick: () => { sys.launch('settings', { page: 'security' }); } }],
        onDismiss: () => { if (!prefs.get('unknown_sources') && sys.current === this.task) this.finish(); },
      });
      this.pending = intent;
      this.unsub = prefs.on('unknown_sources', v => { if (v && this.pending) { const i = this.pending; this.pending = null; setTimeout(() => this.start(i), 0); } });
      return;
    }
    let parsed;
    try { parsed = await parseWapk(intent.bytes); }
    catch (e) {
      dialog({ title: S('Parse_error_dlg_title', 'Parse error'), message: e.message || S('Parse_error_dlg_text', 'There was a problem parsing the package.'), buttons: [{ label: S('ok', 'OK'), onClick: () => this.finish() }], onDismiss: () => this.finish() });
      return;
    }
    const m = parsed.manifest;
    const existing = await installedPackage(m.package);
    this.confirm(parsed, existing);
  }
  onDestroy() { this.unsub && prefs.off('unknown_sources', this.unsub); }

  header(parsed) {
    const m = parsed.manifest;
    return h('div.pi-header', h('img.pi-icon', { src: parsed.iconUrl || '' }), h('div.pi-label', m.label));
  }

  confirm(parsed, existing) {
    const m = parsed.manifest;
    const perms = m.permissions || [];
    const oldPerms = new Set(existing ? existing.manifest.permissions || [] : []);
    const newPerms = perms.filter(p => !oldPerms.has(p));
    const question = existing
      ? (newPerms.length ? S('install_confirm_question_update', 'Do you want to install an update to this existing application?') : S('install_confirm_question_update_no_perms', 'Do you want to install an update to this existing application?'))
      : (perms.length ? S('install_confirm_question', 'Do you want to install this application? It will get access to:') : S('install_confirm_question_no_perms', 'Do you want to install this application? It does not require any special access.'));
    const list = h('div.pi-perms');
    const renderPerms = which => {
      list.innerHTML = '';
      const ps = which === 'new' ? newPerms : perms;
      if (!ps.length) list.append(h('div.pi-noperm', 'No new permissions.'));
      ps.forEach(p => list.append(h('div.pi-perm', icon('info'), h('div', h('div.pi-perm-title', permissionLabel(p)), h('div.pi-perm-name', p)))));
    };
    const tabBar = existing && newPerms.length ? tabs([S('newPerms', 'New'), S('allPerms', 'All')], i => renderPerms(i ? 'all' : 'new')) : null;
    tabBar && tabBar.select(0, true);
    renderPerms(existing && newPerms.length ? 'new' : 'all');
    const src = parsed.source;
    const scroller = h('div.pi-scroll', null,
      h('div.pi-question', question), tabBar, list,
      h('div.pi-meta',
        h('div', `Package: ${m.package}`), h('div', `Version: ${m.versionName} (${m.versionCode})`),
        h('div', `Min SDK: ${m.minSdkVersion || 1} · Target SDK: ${m.targetSdkVersion || '?'}`),
        src && src.apk ? h('div', `Converted from APK ${src.apk.sha256.slice(0, 16)}… (${src.apk.dexFiles.length} DEX file(s) replaced by a web implementation)`) : null));
    const install = button(S('install', 'Install'), () => this.install(parsed, existing), 'flat');
    const page = h('div.package-installer', null, this.header(parsed), scroller,
      h('div.pi-buttons', button(S('cancel', 'Cancel'), () => this.finish()), install));
    this.root.innerHTML = ''; this.root.append(page);
  }

  async install(parsed, existing) {
    const progress = h('div.pi-progress', h('div'));
    const status = h('div.pi-status', S('installing', 'Installing…'));
    const page = h('div.package-installer', null, this.header(parsed), h('div.pi-scroll.pi-center', status, progress), h('div.pi-buttons'));
    this.root.innerHTML = ''; this.root.append(page);
    try {
      await sleep(400);
      await installParsed(parsed);
      await sleep(300);
      status.textContent = S('install_done', 'App installed.');
      progress.remove();
      status.prepend(icon('check'));
      page.querySelector('.pi-buttons').append(
        button(S('done', 'Done'), () => this.finish()),
        button(S('launch', 'Open'), () => { const pkg = parsed.manifest.package; this.finish(); setTimeout(() => sys.launch(pkg), 300); }));
    } catch (e) {
      status.textContent = S('install_failed', 'App not installed.') + ' ' + (e.message || '');
      progress.remove();
      page.querySelector('.pi-buttons').append(button(S('done', 'Done'), () => this.finish()));
    }
  }
}
registerApp({ id: 'packageinstaller', label: 'Package installer', icon: 'application', color: '#263238', colorDark: '#21272b', accent: '#009688', hidden: true, pkg: 'com.android.packageinstaller' }, PackageInstaller);
