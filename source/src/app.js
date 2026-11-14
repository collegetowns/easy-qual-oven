/* ===== Easy Qual Oven ===== */
'use strict';
const APP_VERSION = '/*VERSION*/';
const BUILD_DATE = '/*BUILD_DATE*/';
const FORMAT_VERSION = 1;
const FILE_EXT = '.qualoven';
const PALETTE = ['#E07A5F', '#3D85C6', '#6BAA75', '#E9B949', '#9B6FD6', '#E0629B', '#2BA5A5', '#D9822B', '#7D9D3A', '#B56576', '#5C7AEA', '#A6764B'];
const CAN_FS = typeof window.showSaveFilePicker === 'function';
const SITE_URL = 'https://easyqualoven.collegetowns.org';
// Opened from a file on the computer (downloaded copy) vs. from the website.
const IS_LOCAL = !/^https?:$/.test(location.protocol);
// The page's own source, captured before anything is drawn, so "Download the app" can save a copy.
const APP_SOURCE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
const prettyDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); };
function downloadApp() {
  downloadBlob(new Blob([APP_SOURCE], { type: 'text/html' }), `Easy Qual Oven v${APP_VERSION}.html`);
  toast(`Downloaded Easy Qual Oven v${APP_VERSION}. Move it to a folder you'll remember, then double-click it to open. It works without the internet.`, { ms: 9000 });
}
async function webWarningOnce() {
  if (IS_LOCAL) return true;
  try { if (sessionStorage.getItem('eqo-web-ok')) return true; } catch (e) { }
  const v = await modal({
    title: 'You are using the web version',
    body: `<p>Your transcripts still stay on your computer and are never uploaded. But in the web version, <b>work you have not saved to a project file is kept only in this browser</b>. It can be lost if you clear your browsing history, use a private window, or the browser closes unexpectedly.</p>
      <p>For real research data, especially sensitive interviews, we recommend <b>downloading the app</b>. It runs from a file on your computer and works without the internet.</p>
      <p class="muted" style="font-size:13px">If you continue online, click <b>Save</b> often to keep a project file on your computer.</p>`,
    buttons: [{ label: 'Download the app', value: 'dl' }, { label: 'Continue online', kind: 'primary', value: 'ok' }]
  });
  if (v === 'dl') { downloadApp(); return false; }
  if (v !== 'ok') return false;
  try { sessionStorage.setItem('eqo-web-ok', '1'); } catch (e) { }
  return true;
}

let P = null; // current project
const S = {
  view: 'home', docId: null, codeId: null, includeChildren: true, exSearch: '', codeFilter: '',
  dirty: false, lastSaved: null, fileHandle: null, fileName: null, collapsed: new Set(),
  recentCodes: [], saving: false
};

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const plural = (n, w, pl) => `${n.toLocaleString()} ${n === 1 ? w : (pl || w + 's')}`;
const words = t => (t.match(/\S+/g) || []).length;
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function ago(d) {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 10) return 'just now'; if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const fileSafe = s => (s || 'project').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'project';

/* ---------- project model ---------- */
function newProject(name) {
  return { app: 'Easy Qual Oven', formatVersion: FORMAT_VERSION, id: uid(), name: name || 'Untitled project', created: now(), modified: now(), documents: [], codes: [], codings: [], attributes: [], reviews: [] };
}
function migrate(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.documents) || !Array.isArray(p.codes) || !Array.isArray(p.codings)) throw new Error('This file is not an Easy Qual Oven project.');
  if ((p.formatVersion || 1) > FORMAT_VERSION) throw new Error('This project was made with a newer version of Easy Qual Oven. Please get the latest version.');
  p.formatVersion = FORMAT_VERSION;
  p.id ||= uid();
  p.codes.forEach((c, i) => { c.order ??= i; c.parentId ??= null; c.description ??= ''; c.inclusion ??= ''; c.exclusion ??= ''; });
  p.documents.forEach(d => { d.attributes ??= {}; });
  p.attributes ??= [];
  p.reviews ??= [];
  p.codings.forEach(c => { c.starred = !!c.starred; });
  return p;
}
const docById = id => P.documents.find(d => d.id === id);
const codeById = id => P.codes.find(c => c.id === id);
const childrenOf = pid => P.codes.filter(c => (c.parentId || null) === (pid || null)).sort((a, b) => a.order - b.order);
function descendants(id) { const out = []; const rec = pid => childrenOf(pid).forEach(c => { out.push(c.id); rec(c.id); }); rec(id); return out; }
function codePath(c) { const parts = []; let x = c; while (x) { parts.unshift(x.name); x = x.parentId ? codeById(x.parentId) : null; } return parts; }
function treeOrder() { const out = []; const rec = (pid, depth) => childrenOf(pid).forEach(c => { out.push({ c, depth }); rec(c.id, depth + 1); }); rec(null, 0); return out; }
function nextColor() { const used = P.codes.map(c => c.color); return PALETTE.find(c => !used.includes(c)) || PALETTE[P.codes.length % PALETTE.length]; }
function codeStats() {
  const m = new Map(); P.codes.forEach(c => m.set(c.id, { n: 0, docs: new Set() }));
  P.codings.forEach(k => { const s = m.get(k.codeId); if (s) { s.n++; s.docs.add(k.docId); } });
  return m;
}
const codingText = k => { const d = docById(k.docId); return d ? d.text.slice(k.start, k.end) : ''; };

/* ---------- undo (snapshot) ---------- */
let undoSnap = null;
function snapshot() { undoSnap = JSON.stringify(P); }
function undo() { if (!undoSnap) return; P = JSON.parse(undoSnap); undoSnap = null; changed(); toast('Undone'); }

/* ---------- storage: recovery copy in IndexedDB ---------- */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try { const r = indexedDB.open('easy-qual-oven', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
      catch (e) { rej(e); }
    });
    return dbp;
  }
  async function op(mode, fn) { const db = await open(); return new Promise((res, rej) => { const tx = db.transaction('kv', mode); const st = tx.objectStore('kv'); const r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
  return {
    get: k => op('readonly', st => st.get(k)).catch(() => null),
    set: (k, v) => op('readwrite', st => st.put(v, k)).catch(() => null),
    del: k => op('readwrite', st => st.delete(k)).catch(() => null)
  };
})();

/* ---------- change tracking & saving ---------- */
let autosaveTimer = null;
function changed(opts = {}) {
  P.modified = now();
  S.dirty = true;
  render();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 1200);
}
async function autosave() {
  if (!P) return;
  await DB.set('recovery', { project: P, savedAt: now(), savedToFile: !S.dirty, fileName: S.fileName });
  if (S.fileHandle) await writeToHandle(true);
}
function serialize() { return JSON.stringify(P, null, 1); }
async function writeToHandle(silent) {
  try {
    S.saving = true; renderSaveStatus();
    const w = await S.fileHandle.createWritable();
    await w.write(serialize()); await w.close();
    S.dirty = false; S.lastSaved = now(); S.saving = false;
    DB.set('recovery', { project: P, savedAt: now(), savedToFile: true, fileName: S.fileName });
    renderSaveStatus();
    return true;
  } catch (e) {
    S.saving = false;
    if (!silent || e.name !== 'NotAllowedError') toast('Could not save to the file: ' + (e.message || e.name), { error: true });
    S.fileHandle = null; renderSaveStatus();
    return false;
  }
}
async function save() {
  if (!P) return;
  if (S.fileHandle) { if (await writeToHandle()) toast('Saved'); return; }
  return saveAs();
}
async function saveAs() {
  if (!P) return;
  if (CAN_FS) {
    try {
      const h = await window.showSaveFilePicker({ id: 'eqo-project', ...(S.fileHandle ? { startIn: S.fileHandle } : {}), suggestedName: fileSafe(P.name) + FILE_EXT, types: [{ description: 'Easy Qual Oven project', accept: { 'application/json': [FILE_EXT] } }] });
      S.fileHandle = h; S.fileName = h.name;
      DB.set('handle', { handle: h, projectId: P.id });
      if (await writeToHandle()) toast(`Saved to ${h.name}. From now on, changes save automatically.`);
    } catch (e) { if (e.name !== 'AbortError') toast('Save failed: ' + e.message, { error: true }); }
    return;
  }
  const blob = new Blob([serialize()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileSafe(P.name) + FILE_EXT;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  S.dirty = false; S.lastSaved = now(); S.fileName = a.download;
  DB.set('recovery', { project: P, savedAt: now(), savedToFile: true, fileName: S.fileName });
  renderSaveStatus();
  toast(`Downloaded ${a.download}. Keep this file somewhere safe; it is your whole project.`);
}
async function loadProjectText(text, handle, name) {
  let p;
  try { p = migrate(JSON.parse(text)); } catch (e) { toast(e instanceof SyntaxError ? 'That file could not be read as a project.' : e.message, { error: true }); return; }
  openProject(p, { handle, fileName: name || (handle && handle.name), dirty: false });
}
async function openFile() {
  if (S.dirty && P && !(await confirmLeave())) return;
  if (!P && !(await webWarningOnce())) return;
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [h] = await window.showOpenFilePicker({ id: 'eqo-project', ...(S.fileHandle ? { startIn: S.fileHandle } : {}), types: [{ description: 'Easy Qual Oven project', accept: { 'application/json': [FILE_EXT, '.json'] } }] });
      const f = await h.getFile();
      await loadProjectText(await f.text(), h, f.name);
      DB.set('handle', { handle: h, projectId: P && P.id });
    } catch (e) { if (e.name !== 'AbortError') toast('Could not open: ' + e.message, { error: true }); }
    return;
  }
  $('#fileOpen').click();
}
function openProject(p, { handle = null, fileName = null, dirty = false } = {}) {
  P = p; S.fileHandle = handle; S.fileName = fileName; S.dirty = dirty; S.lastSaved = dirty ? null : now();
  S.view = 'home'; S.docId = null; S.codeId = null; S.collapsed = new Set(); undoSnap = null;
  buildShell(); render();
  DB.set('recovery', { project: P, savedAt: now(), savedToFile: !dirty, fileName });
}
async function confirmLeave() {
  return modal({
    title: 'Save your changes first?',
    body: `<p>“${esc(P.name)}” has changes that are not saved to a project file yet.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: "Don't save", value: true, kind: 'danger' }, { label: 'Save', value: 'save', kind: 'primary' }]
  }).then(async v => { if (v === 'save') { await save(); return !S.dirty; } return !!v; });
}
async function closeProject() {
  if (S.dirty && !(await confirmLeave())) return;
  P = null; S.fileHandle = null; S.dirty = false;
  await DB.del('recovery');
  showWelcome();
}

/* ---------- toasts & modals ---------- */
function toast(msg, { action, onAction, error, ms } = {}) {
  const t = document.createElement('div'); t.className = 'toast';
  if (error) t.style.background = '#7A2A20';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { onAction(); t.remove(); };
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms || (action ? 8000 : 3800));
}
function modal({ title, body, buttons, onOpen, wide }) {
  return new Promise(resolve => {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" ${wide ? 'style="width:620px"' : ''}><h2>${esc(title)}</h2><div class="mb">${body || ''}</div><div class="mf"></div></div>`;
    const mf = back.querySelector('.mf');
    const close = v => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    (buttons || [{ label: 'OK', value: true, kind: 'primary' }]).forEach(b => {
      const el = document.createElement('button'); el.className = 'btn ' + (b.kind || '') + (b.left ? ' left' : ''); el.textContent = b.label;
      el.onclick = () => { if (b.validate && !b.validate(back)) return; close(typeof b.value === 'function' ? b.value(back) : b.value); };
      if (b.kind === 'primary') el.dataset.primary = '1';
      mf.appendChild(el);
    });
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { const p = mf.querySelector('[data-primary]'); if (p) { e.preventDefault(); p.click(); } }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', e => { if (e.target === back) close(undefined); });
    document.body.appendChild(back);
    if (onOpen) onOpen(back);
    const f = back.querySelector('input,textarea'); if (f) setTimeout(() => { f.focus(); f.select && f.select(); }, 20);
  });
}
async function promptText(title, label, value, help) {
  const v = await modal({
    title, body: `<div class="field"><label>${esc(label)}</label><input type="text" id="m-in" value="${esc(value || '')}">${help ? `<div class="help">${esc(help)}</div>` : ''}</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', kind: 'primary', value: b => b.querySelector('#m-in').value.trim() }]
  });
  return v || null;
}

/* ---------- logo ---------- */
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="8" width="52" height="50" rx="9" fill="#B4532A"/><rect x="6" y="8" width="52" height="14" rx="9" fill="#8F3E1C"/><rect x="6" y="16" width="52" height="6" fill="#8F3E1C"/><circle cx="18" cy="15" r="3" fill="#F7E7C2"/><circle cx="28" cy="15" r="3" fill="#F7E7C2"/><rect x="38" y="13" width="14" height="4" rx="2" fill="#D9A441"/><rect x="13" y="26" width="38" height="26" rx="5" fill="#FBF4E8"/><rect x="13" y="26" width="38" height="26" rx="5" fill="none" stroke="#5B2A12" stroke-width="2"/><path d="M19 47c0-7.5 5.8-12 13-12s13 4.5 13 12z" fill="#D9A441"/><path d="M24 41l3-2.5M30.5 38.5l3-2M37.5 40l3-2" stroke="#B4532A" stroke-width="2" stroke-linecap="round"/><rect x="17" y="47" width="30" height="2.5" rx="1.2" fill="#8A7663"/></svg>`;
const ICON_OVEN = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="6" width="30" height="29" rx="5" fill="#B4532A"/><rect x="5" y="6" width="30" height="8" rx="5" fill="#8F3E1C"/><rect x="5" y="11" width="30" height="3" fill="#8F3E1C"/><circle cx="11" cy="10" r="1.8" fill="#F7E7C2"/><circle cx="17" cy="10" r="1.8" fill="#F7E7C2"/><rect x="23" y="8.8" width="8" height="2.4" rx="1.2" fill="#D9A441"/><rect x="9" y="17" width="22" height="14" rx="3" fill="#FBF4E8" stroke="#5B2A12" stroke-width="1.4"/><rect x="13" y="19.5" width="14" height="2" rx="1" fill="#5B2A12"/><path d="M12.5 29c0-4 3.4-6.3 7.5-6.3s7.5 2.3 7.5 6.3z" fill="#D9A441"/></svg>`;
const ICON_BAKE = `<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(38 20 20)"><path d="M23 20C16 11.5 5 13 4.5 20C5 27 16 28.5 23 20Z" fill="none" stroke="#7A6A5A" stroke-width="1.5"/><path d="M23 20C17 15.5 9 16.5 8.5 20C9 23.5 17 24.5 23 20" fill="none" stroke="#7A6A5A" stroke-width="1.2"/><path d="M23 20H12" stroke="#7A6A5A" stroke-width="1.1"/><rect x="22" y="18.3" width="15" height="3.4" rx="1.7" fill="#5B4A3B"/></g><g transform="rotate(-38 20 20)"><rect x="9.5" y="15.5" width="21" height="9" rx="4.5" fill="#E6B656" stroke="#8F3E1C" stroke-width="1.3"/><path d="M14 17.8v4.4M18 17.8v4.4M22 17.8v4.4M26 17.8v4.4" stroke="#F7E7C2" stroke-width="1" stroke-linecap="round"/><rect x="2" y="18.2" width="8" height="3.6" rx="1.8" fill="#B4532A"/><rect x="30" y="18.2" width="8" height="3.6" rx="1.8" fill="#B4532A"/></g></svg>`;
const FOOTER = () => `<span>Easy Qual Oven v${APP_VERSION} · updated ${prettyDate(BUILD_DATE)}</span><span>·</span><span>Powered by <a href="https://collegetowns.org" target="_blank" rel="noopener">CollegeTowns.org</a></span><span>·</span><span>More free apps in the <a href="https://applocker.collegetowns.org/" target="_blank" rel="noopener">College Towns App Locker</a></span>`;

/* ---------- welcome ---------- */
async function showWelcome() {
  const app = $('#app');
  // If a project is open (user came back via the logo), offer it directly; otherwise use the recovery copy.
  const live = !!P;
  const rec = live ? { project: P, savedToFile: !S.dirty } : await DB.get('recovery');
  app.innerHTML = `<div class="welcome"><div class="welcome-inner">
    <div class="welcome-hero">${LOGO}<div><h1>Easy Qual Oven</h1><div class="tagline">Where coding isn't half-baked.</div><p>Easy Qual Oven is a simple qualitative coding tool for interview research. Import your transcripts, build a codebook, and see every excerpt for a code in one place.</p></div></div>
    ${rec && rec.project ? `<div class="resume"><div style="font-size:26px">🍞</div><div class="rt"><b>Continue “${esc(rec.project.name)}”</b><div>Last edited ${esc(ago(rec.project.modified))} · ${plural(rec.project.documents.length, 'transcript')}, ${plural(rec.project.codes.length, 'code')}${rec.savedToFile ? '' : ' · <b>has changes not yet saved to a file</b>'}</div></div><button class="btn primary" id="w-resume">Continue</button></div>` : ''}
    ${IS_LOCAL ? `<div class="where-note local"><span class="where-dot"></span><div><b>You're using the copy on your computer</b> (version ${APP_VERSION}). It works without the internet. <a href="${SITE_URL}" target="_blank" rel="noopener">Check for a newer version</a></div></div>`
      : `<div class="ways"><h2>Two ways to use Easy Qual Oven</h2><div class="ways-row">
          <div class="way rec"><div class="way-tag">Recommended for research data</div><h3>⤓ Download the app</h3><p>Keep Easy Qual Oven as a file on your computer and open it any time, even without the internet. Your project files stay in folders you control.</p><button class="btn primary" id="w-getapp">Download the app <span class="vtag">v${APP_VERSION}</span></button></div>
          <div class="way"><div class="way-tag">Good for trying it out</div><h3>🌐 Work online</h3><p>Start right here with one of the options below. Your transcripts stay on your computer, but <b>work you haven't saved to a project file is kept only in this browser</b> and can be lost if you clear your browsing history. Click Save often.</p></div>
        </div></div>`}
    <div class="cards">
      <button class="card" id="w-new"><span class="ci">${ICON_BAKE}</span><h3>New project</h3><p>Start fresh with your own interview transcripts.</p></button>
      <button class="card" id="w-open"><span class="ci">${ICON_OVEN}</span><h3>Open project</h3><p>Pick up a project you saved earlier (a ${FILE_EXT} file).</p></button>
      <button class="card" id="w-sample"><span class="ci">🥐</span><h3>Try the sample</h3><p>Practice on three short example interviews that are already partly coded.</p></button>
    </div>
    ${CAN_FS ? `<div class="tip">💡 <b>Saving:</b> the first time you click <b>Save</b>, choose where to keep your project file. After that, Easy Qual Oven saves automatically as you work.</div>`
      : `<div class="tip">💡 <b>Saving in this browser:</b> clicking <b>Save</b> downloads your project file. Download again whenever you finish a session and keep the newest copy. For automatic saving, open Easy Qual Oven in <b>Google Chrome</b> or <b>Microsoft Edge</b>.</div>`}
    <div class="privacy-box"><div class="pb-ico">🔒</div><div><b>Private by design.</b> Easy Qual Oven runs entirely on your own computer, and once downloaded it works without an internet connection. Your transcripts, codes, and notes are never uploaded, stored on a server, or shared with anyone. That makes it a good fit for sensitive interviews, vulnerable participants, and projects with IRB, ethics board, or data-protection requirements.</div></div>
  </div><div class="footer">${FOOTER()}</div></div>`;
  const okToSwitch = async () => !live || !S.dirty || !!S.fileHandle || await confirmLeave();
  if ($('#w-getapp')) $('#w-getapp').onclick = downloadApp;
  $('#w-new').onclick = async () => { if (!(await okToSwitch())) return; if (!(await webWarningOnce())) return; const n = await promptText('New project', 'Project name', '', 'For example: "Thesis interviews – Spring 2026"'); if (n) openProject(newProject(n), { dirty: true }); };
  $('#w-open').onclick = openFile;
  $('#w-sample').onclick = async () => { if (!(await okToSwitch())) return; if (!(await webWarningOnce())) return; openProject(sampleProject(), { dirty: true }); };
  if ($('#w-resume')) $('#w-resume').onclick = async () => {
    if (live) { buildShell(); render(); return; }
    const p = migrate(rec.project);
    let handle = null;
    const hrec = await DB.get('handle');
    if (hrec && hrec.handle && hrec.projectId === p.id) {
      try { if ((await hrec.handle.requestPermission({ mode: 'readwrite' })) === 'granted') handle = hrec.handle; } catch (e) { }
    }
    openProject(p, { handle, fileName: rec.fileName, dirty: !rec.savedToFile || !!handle });
    if (handle) writeToHandle(true);
  };
}

async function goHome() {
  closePops();
  clearTimeout(autosaveTimer);
  await autosave();
  showWelcome();
}

/* ---------- main shell ---------- */
function buildShell() {
  $('#app').innerHTML = `
  <header class="topbar">
    <button class="brand" id="brandHome" title="Back to the start screen">${LOGO}<span>Easy Qual Oven</span></button>
    <span class="where ${IS_LOCAL ? 'local' : 'web'}" title="${IS_LOCAL ? `You're using the copy of Easy Qual Oven saved on this computer (version ${APP_VERSION}).` : `You're using Easy Qual Oven on the web (version ${APP_VERSION}). Download the app to keep a copy on your computer.`}">${IS_LOCAL ? 'On your computer' : 'Web version'} · v${APP_VERSION}</span>
    <div class="sep"></div>
    <button class="proj-name" id="projName" title="Go to project overview"></button><button class="icon-btn" id="projRename" title="Rename project">✎</button>
    <div class="spacer"></div>
    <div class="save-status" id="saveStatus"></div>
    <button class="btn" id="btnExport" title="Export a codebook or your coded excerpts">⇩ Export</button>
    <button class="btn primary" id="btnSave" title="Save (Ctrl/⌘ + S)">Save</button>
    <div class="menu-wrap"><button class="btn" id="btnMenu">Project ▾</button>
      <div class="dropdown hidden" id="menu">
        <button data-act="import">Import transcripts…</button>
        <button data-act="export">Export codebook &amp; excerpts…</button>
        <hr>
        <button data-act="save">Save<span class="kbd">Ctrl/⌘ S</span></button>
        <button data-act="saveas">Save as…</button>
        <button data-act="open">Open project…</button>
        <button data-act="new">New project</button>
        <hr>
        <button data-act="help">How to use Easy Qual Oven</button>
        ${IS_LOCAL ? `<button data-act="site">Check for a newer version</button>` : `<button data-act="getapp">⤓ Download the app (v${APP_VERSION})</button>`}
        <button data-act="close">Close project</button>
      </div></div>
  </header>
  <div class="web-strip hidden" id="webStrip"><span>⚠ <b>Web version:</b> your latest changes are only in this browser until you save a project file. Clearing your browsing history can erase them.</span><button class="btn small primary" id="wsSave">Save project file</button><button class="btn small" id="wsApp">⤓ Download the app</button></div>
  <main class="layout">
    <aside class="panel left"><div class="panel-head"><h2>Project</h2><button class="btn small" id="btnImport">＋ Import</button></div><div class="panel-body" id="docList"></div></aside>
    <section class="center" id="center"></section>
    <aside class="panel right"><div class="panel-head"><h2>Codebook</h2><button class="btn small" id="btnNewCode">＋ New code</button></div>
      <input class="code-search" id="codeFilter" type="search" placeholder="Filter codes…">
      <div class="panel-body" id="codeTree"></div>
      <div class="code-hint">Highlight text in a transcript to apply codes. Click a code to see all its excerpts. Drag codes to nest or reorder them. <span class="nodef"></span> = needs a definition.</div>
    </aside>
  </main>
  <div class="footer">${FOOTER()}</div>`;
  $('#projName').onclick = goOverview;
  $('#projRename').onclick = renameProject;
  $('#brandHome').onclick = goHome;
  $('#btnSave').onclick = save;
  $('#wsSave').onclick = save; $('#wsApp').onclick = downloadApp;
  $('#btnExport').onclick = showExport;
  $('#btnImport').onclick = pickTranscripts;
  $('#btnNewCode').onclick = () => editCode(null);
  $('#codeFilter').oninput = e => { S.codeFilter = e.target.value; renderCodes(); };
  $('#btnMenu').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); };
  $('#menu').onclick = e => {
    const a = e.target.closest('button')?.dataset.act; if (!a) return;
    $('#menu').classList.add('hidden');
    ({ import: pickTranscripts, export: showExport, save, saveas: saveAs, open: openFile, close: closeProject, help: showHelp, getapp: downloadApp, site: () => window.open(SITE_URL, '_blank', 'noopener'),
      new: async () => { if (S.dirty && !(await confirmLeave())) return; const n = await promptText('New project', 'Project name', ''); if (n) openProject(newProject(n), { dirty: true }); } })[a]();
  };
}
function render() {
  if (!P || !$('#center')) return;
  $('#projName').textContent = P.name;
  renderSaveStatus(); renderDocs(); renderCodes(); renderCenter();
}
function renderSaveStatus() {
  const el = $('#saveStatus'); if (!el || !P) return;
  let txt, unsaved = false;
  if (S.saving) txt = 'Saving…';
  else if (S.fileHandle) { txt = S.dirty ? 'Saving soon…' : `Saved to ${S.fileName} · ${ago(S.lastSaved)}`; }
  else if (S.dirty) { txt = S.lastSaved ? `Changes since last save (${ago(S.lastSaved)})` : 'Not saved to a file yet'; unsaved = true; }
  else txt = `Saved ${ago(S.lastSaved)}`;
  el.className = 'save-status' + (unsaved ? ' unsaved' : '');
  el.innerHTML = `<span class="dot"></span><span>${esc(txt)}</span>`;
  el.title = S.fileHandle ? 'Changes save automatically to your project file.' : (CAN_FS ? 'Click Save to choose a file; after that, saving is automatic.' : 'Click Save to download your project file.');
  const b = $('#btnSave'); if (b) b.style.display = S.fileHandle && !S.dirty ? 'none' : '';
  const ws = $('#webStrip'); if (ws) ws.classList.toggle('hidden', IS_LOCAL || !!S.fileHandle || !S.dirty);
}
async function renameProject() {
  const n = await promptText('Rename project', 'Project name', P.name);
  if (n && n !== P.name) { P.name = n; changed(); }
}

/* ---------- documents panel ---------- */
function goOverview() { goView('home'); }
function goView(v) { S.view = v; closePops(); render(); $('#center').scrollTop = 0; }
function renderDocs() {
  const list = $('#docList');
  const counts = {}; P.codings.forEach(k => counts[k.docId] = (counts[k.docId] || 0) + 1);
  const nav = (v, ico, label) => `<div class="doc-item overview ${S.view === v ? 'active' : ''}" data-view="${v}"><span class="ov-ico">${ico}</span><div class="nm">${label}</div></div>`;
  const overview = `<div class="nav-group">${nav('home', '⌂', 'Project overview')}${nav('people', '👥', 'Participants')}${nav('compare', '▦', 'Compare groups')}${nav('reviews', '📝', 'Code review &amp; notes')}</div>`;
  const wire = () => { $$('[data-view]', list).forEach(x => x.onclick = () => goView(x.dataset.view)); };
  if (!P.documents.length) {
    list.innerHTML = overview + `<div class="dropzone"><strong>No transcripts yet</strong><br>Drag Word, text, or PDF files here, or click <b>＋ Import</b>.</div>`;
    wire(); return;
  }
  list.innerHTML = overview + `<div class="list-label">Transcripts</div>` + P.documents.map(d => `<div class="doc-item ${S.view === 'doc' && S.docId === d.id ? 'active' : ''}" data-id="${d.id}">
    <span class="doc-ico"></span><div style="min-width:0"><div class="nm">${esc(d.name)}</div><div class="meta">${plural(words(d.text), 'word')} · ${plural(counts[d.id] || 0, 'coding')}</div></div>
    <button class="icon-btn more" title="More">⋯</button></div>`).join('');
  wire();
  $$('.doc-item[data-id]', list).forEach(el => {
    const id = el.dataset.id;
    el.onclick = e => { if (e.target.closest('.more')) return; openDoc(id); };
    const menu = e => { e.preventDefault(); e.stopPropagation(); ctxMenu(e, [
      { label: 'Rename', fn: () => renameDoc(id) },
      { label: 'Delete transcript', danger: true, fn: () => deleteDoc(id) }]); };
    el.querySelector('.more').onclick = menu; el.oncontextmenu = menu;
  });
}
function openDoc(id, focusCodingId) {
  S.view = 'doc'; S.docId = id; closePops(); render();
  if (focusCodingId) requestAnimationFrame(() => flashCoding(focusCodingId));
  else $('#center').scrollTop = 0;
}
async function renameDoc(id) { const d = docById(id); const n = await promptText('Rename transcript', 'Name', d.name, 'Tip: use a pseudonym or participant ID, not a real name.'); if (n) { d.name = n; changed(); } }
async function deleteDoc(id) {
  const d = docById(id); const n = P.codings.filter(k => k.docId === id).length;
  const ok = await modal({ title: 'Delete transcript?', body: `<p>“${esc(d.name)}” and its ${plural(n, 'coding')} will be removed from this project. The original file on your computer is not affected.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', kind: 'danger', value: true }] });
  if (!ok) return;
  snapshot();
  P.documents = P.documents.filter(x => x.id !== id); P.codings = P.codings.filter(k => k.docId !== id);
  if (S.docId === id) { S.view = 'home'; S.docId = null; }
  changed(); toast(`Deleted “${d.name}”`, { action: 'Undo', onAction: undo });
}
// Chrome/Edge: open the picker in the folder transcripts last came from (or next to the project file).
async function pickTranscripts() {
  if (typeof window.showOpenFilePicker !== 'function') { $('#fileImport').click(); return; }
  let startIn = S.fileHandle || undefined;
  const last = await DB.get('importFrom');
  if (last && last.handle) startIn = last.handle;
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      id: 'eqo-transcripts', multiple: true, ...(startIn ? { startIn } : {}),
      types: [{ description: 'Transcripts (Word, text, PDF)', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'text/plain': ['.txt', '.md', '.text'], 'application/pdf': ['.pdf'] } }]
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (startIn) { DB.del('importFrom'); $('#fileImport').click(); return; } // stale folder: fall back to the plain picker
    toast('Could not open files: ' + e.message, { error: true }); return;
  }
  DB.set('importFrom', { handle: handles[0] });
  importFiles(await Promise.all(handles.map(h => h.getFile())));
}
async function importFiles(files) {
  if (!P) return;
  files = [...files]; if (!files.length) return;
  let added = 0, lastId = null, hadPdf = false;
  if (files.length > 2 || files.some(f => /\.pdf$/i.test(f.name))) toast(`Importing ${plural(files.length, 'file')}…`, { ms: 1500 });
  for (const f of files) {
    try {
      const r = await Importers.readFile(f);
      if (!r.text.trim()) throw new Error('The file has no text.');
      const d = { id: uid(), name: r.name, text: r.text, source: r.source, added: now(), attributes: {} };
      P.documents.push(d); added++; lastId = d.id; if (r.source === 'pdf') hadPdf = true;
    } catch (e) { toast(`${f.name}: ${e.message}`, { error: true, ms: 7000 }); }
  }
  if (added) { changed(); openDoc(lastId); toast(`Imported ${plural(added, 'transcript')}`); }
  if (hadPdf) toast('PDF text sometimes has odd line breaks. If you have a Word or text version of this transcript, it will come through cleaner.', { ms: 9000 });
}

/* ---------- codebook panel ---------- */
function renderCodes() {
  const tree = $('#codeTree'); const stats = codeStats(); const f = S.codeFilter.trim().toLowerCase();
  if (!P.codes.length) { tree.innerHTML = `<div class="dropzone"><strong>No codes yet</strong><br>Click <b>＋ New code</b>, or highlight text in a transcript and type a new code name.</div>`; return; }
  let rows = treeOrder();
  if (f) rows = rows.filter(r => r.c.name.toLowerCase().includes(f)).map(r => ({ ...r, depth: 0 }));
  else rows = rows.filter(r => { let x = r.c; while (x.parentId) { if (S.collapsed.has(x.parentId)) return false; x = codeById(x.parentId); } return true; });
  tree.innerHTML = rows.map(({ c, depth }) => {
    const hasKids = P.codes.some(x => x.parentId === c.id); const st = stats.get(c.id);
    const tot = hasKids ? [c.id, ...descendants(c.id)].reduce((a, id) => a + stats.get(id).n, 0) : st.n;
    return `<div class="code-row ${S.view === 'code' && S.codeId === c.id ? 'active' : ''}" data-id="${c.id}" draggable="${f ? 'false' : 'true'}" style="padding-left:${6 + depth * 16}px" title="${esc(c.description || 'No definition yet')}">
      <button class="caret">${hasKids && !f ? (S.collapsed.has(c.id) ? '▶' : '▼') : ''}</button>
      <span class="swatch" style="background:${c.color}"></span><span class="cname">${esc(c.name)}</span>
      ${c.description.trim() ? '' : '<span class="nodef" title="Add a definition for your codebook"></span>'}
      <button class="icon-btn edit" title="Edit code">✎</button><span class="count" title="${hasKids ? `${plural(tot, 'excerpt')} including child codes (${st.n} coded directly)` : `${plural(st.n, 'excerpt')} in ${plural(st.docs.size, 'transcript')}`}">${tot}</span></div>`;
  }).join('') + (f ? '' : `<div class="code-root-drop hidden" id="rootDrop">Drop here to make a top-level code</div>`);
  $$('.code-row', tree).forEach(el => {
    const id = el.dataset.id;
    el.onclick = e => {
      if (e.target.closest('.caret')) { S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); renderCodes(); return; }
      if (e.target.closest('.edit')) { editCode(id); return; }
      openCode(id);
    };
    el.ondblclick = () => editCode(id);
    el.oncontextmenu = e => { e.preventDefault(); ctxMenu(e, [
      { label: 'View excerpts', fn: () => openCode(id) }, { label: 'Edit code…', fn: () => editCode(id) },
      { label: 'Add child code…', fn: () => editCode(null, id) }, { label: 'Delete code', danger: true, fn: () => deleteCode(id) }]); };
  });
  setupCodeDnD(tree);
}
function setupCodeDnD(tree) {
  let dragId = null; const root = $('#rootDrop');
  const clear = () => $$('.code-row', tree).forEach(r => r.classList.remove('drop-inside', 'drop-before', 'drop-after'));
  $$('.code-row[draggable=true]', tree).forEach(el => {
    el.addEventListener('dragstart', e => { dragId = el.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-eqo-code', dragId); root && root.classList.remove('hidden'); });
    el.addEventListener('dragend', () => { dragId = null; clear(); root && root.classList.add('hidden'); });
    el.addEventListener('dragover', e => {
      if (!dragId || dragId === el.dataset.id || descendants(dragId).includes(el.dataset.id)) return;
      e.preventDefault(); clear();
      const r = el.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
      el.classList.add(y < .28 ? 'drop-before' : y > .72 ? 'drop-after' : 'drop-inside');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-inside', 'drop-before', 'drop-after'));
    el.addEventListener('drop', e => {
      e.preventDefault(); if (!dragId) return;
      const zone = el.classList.contains('drop-before') ? 'before' : el.classList.contains('drop-after') ? 'after' : 'inside';
      moveCode(dragId, el.dataset.id, zone);
    });
  });
  if (root) {
    root.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); root.classList.add('over'); } });
    root.addEventListener('dragleave', () => root.classList.remove('over'));
    root.addEventListener('drop', e => { e.preventDefault(); if (dragId) moveCode(dragId, null, 'root'); });
  }
}
function moveCode(id, targetId, zone) {
  const c = codeById(id); const t = targetId && codeById(targetId);
  if (zone === 'inside') { c.parentId = t.id; c.order = Math.max(-1, ...childrenOf(t.id).filter(x => x.id !== id).map(x => x.order)) + 1; S.collapsed.delete(t.id); }
  else if (zone === 'root') { c.parentId = null; c.order = Math.max(-1, ...childrenOf(null).filter(x => x.id !== id).map(x => x.order)) + 1; }
  else {
    c.parentId = t.parentId || null;
    const sibs = childrenOf(c.parentId).filter(x => x.id !== id);
    const i = sibs.findIndex(x => x.id === t.id);
    sibs.splice(zone === 'before' ? i : i + 1, 0, c);
    sibs.forEach((x, k) => x.order = k);
  }
  changed();
}
function openCode(id) { S.view = 'code'; S.codeId = id; S.exSearch = ''; closePops(); render(); $('#center').scrollTop = 0; }
function createCode(name, parentId = null) {
  const c = { id: uid(), name, color: nextColor(), description: '', inclusion: '', exclusion: '', parentId, order: Math.max(-1, ...childrenOf(parentId).map(x => x.order)) + 1, created: now() };
  P.codes.push(c); return c;
}
async function editCode(id, parentForNew = null) {
  const c = id ? codeById(id) : null;
  const banned = c ? new Set([c.id, ...descendants(c.id)]) : new Set();
  const parentSel = c ? c.parentId : parentForNew;
  let color = c ? c.color : nextColor();
  const opts = treeOrder().filter(r => !banned.has(r.c.id)).map(r => `<option value="${r.c.id}" ${r.c.id === parentSel ? 'selected' : ''}>${'  '.repeat(r.depth)}${r.depth ? '↳ ' : ''}${esc(r.c.name)}</option>`).join('');
  const res = await modal({
    title: c ? 'Edit code' : (parentForNew ? 'New child code' : 'New code'),
    body: `<div class="field"><label>Code name</label><input type="text" id="c-name" value="${esc(c ? c.name : '')}" placeholder="e.g. Sense of belonging"></div>
      <div class="field"><label>Definition</label><textarea id="c-desc" placeholder="What does this code capture? This becomes the description in your codebook.">${esc(c ? c.description : '')}</textarea></div>
      <div class="field"><label>Color</label><div class="swatches" id="c-sw">${PALETTE.map(p => `<button type="button" data-c="${p}" style="background:${p}" class="${p === color ? 'on' : ''}"></button>`).join('')}</div></div>
      <div class="field"><label>Parent code</label><select id="c-parent"><option value="">— None (top level) —</option>${opts}</select></div>
      <details class="more" ${c && (c.inclusion || c.exclusion) ? 'open' : ''}><summary>More codebook fields (optional)</summary>
        <div class="field"><label>Use when…</label><textarea id="c-inc" placeholder="Inclusion criteria: when should this code be applied?">${esc(c ? c.inclusion : '')}</textarea></div>
        <div class="field"><label>Don't use when…</label><textarea id="c-exc" placeholder="Exclusion criteria: what looks similar but belongs elsewhere?">${esc(c ? c.exclusion : '')}</textarea></div></details>`,
    onOpen: b => { b.querySelector('#c-sw').onclick = e => { const x = e.target.closest('button'); if (!x) return; color = x.dataset.c; $$('#c-sw button', b).forEach(y => y.classList.toggle('on', y === x)); }; },
    buttons: [...(c ? [{ label: 'Delete code', kind: 'danger', left: true, value: 'delete' }] : []), { label: 'Cancel', value: null },
      { label: c ? 'Save' : 'Create code', kind: 'primary', validate: b => { const ok = b.querySelector('#c-name').value.trim(); if (!ok) b.querySelector('#c-name').focus(); return !!ok; },
        value: b => ({ name: b.querySelector('#c-name').value.trim(), description: b.querySelector('#c-desc').value.trim(), parentId: b.querySelector('#c-parent').value || null, inclusion: b.querySelector('#c-inc').value.trim(), exclusion: b.querySelector('#c-exc').value.trim() }) }]
  });
  if (res === 'delete') return deleteCode(id);
  if (!res) return;
  if (c) {
    if (res.parentId !== c.parentId) { c.parentId = res.parentId; c.order = Math.max(-1, ...childrenOf(res.parentId).filter(x => x.id !== c.id).map(x => x.order)) + 1; }
    Object.assign(c, { name: res.name, description: res.description, inclusion: res.inclusion, exclusion: res.exclusion, color });
  } else {
    const n = createCode(res.name, res.parentId); Object.assign(n, { description: res.description, inclusion: res.inclusion, exclusion: res.exclusion, color });
    if (res.parentId) S.collapsed.delete(res.parentId);
  }
  changed();
}
async function deleteCode(id) {
  const c = codeById(id); const n = P.codings.filter(k => k.codeId === id).length; const kids = childrenOf(id).length;
  const ok = await modal({ title: `Delete “${c.name}”?`, body: `<p>This removes the code and its ${plural(n, 'coding')}. The transcript text is not changed.${kids ? ` Its ${plural(kids, 'child code')} will move up a level.` : ''}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Delete code', kind: 'danger', value: true }] });
  if (!ok) return;
  snapshot();
  childrenOf(id).forEach(k => { k.parentId = c.parentId; });
  P.codes = P.codes.filter(x => x.id !== id); P.codings = P.codings.filter(k => k.codeId !== id);
  if (S.codeId === id) { S.view = 'home'; S.codeId = null; }
  changed(); toast(`Deleted code “${c.name}”`, { action: 'Undo', onAction: undo });
}

/* ---------- center ---------- */
function renderCenter() {
  const el = $('#center');
  if (S.view === 'doc' && docById(S.docId)) return renderDocView(el);
  if (S.view === 'code' && codeById(S.codeId)) return renderCodeView(el);
  if (S.view === 'people') return renderPeopleView(el);
  if (S.view === 'compare') return renderCompareView(el);
  if (S.view === 'reviews') return renderReviewsView(el);
  S.view = 'home'; renderHome(el);
}
function renderHome(el) {
  const nDocs = P.documents.length, nCodes = P.codes.length, nK = P.codings.length;
  const defined = P.codes.filter(c => c.description.trim()).length;
  const step = (done, n, t, p, go) => `<div class="step ${done ? 'done' : ''} ${go ? 'clickable' : ''}" ${go ? `data-go="${go}" role="button" tabindex="0"` : ''}><span class="n">${done ? '✓' : n}</span><h3>${t}</h3><p>${p}</p></div>`;
  el.innerHTML = `<div class="home"><h1>${esc(P.name)}</h1><div class="sub">Here's how to get your project baking.</div>
    <div class="steps">
      ${step(nDocs > 0, 1, 'Import transcripts', 'Drag Word (.docx), text (.txt), or PDF files onto the window, or use <b>＋ Import</b>. Use pseudonyms in file names.')}
      ${step(nCodes > 0, 2, 'Build your codebook', 'Add codes with <b>＋ New code</b> and give each a short definition. Drag a code onto another to nest it.')}
      ${step(nK > 0, 3, 'Code your transcripts', 'Highlight a passage and pick a code, or type a new name and press Enter. Click any code to see all of its excerpts.')}
      ${step((P.reviews || []).length > 0, 4, 'Code review &amp; notes <span class="step-go">Open →</span>', 'Save a dated version of your codebook with notes, see what changed since last time, and export files to share.', 'reviews')}
    </div>
    <div class="stats">
      <div class="stat"><b>${nDocs}</b><span>transcripts</span></div>
      <div class="stat"><b>${nCodes}</b><span>codes (${defined} defined)</span></div>
      <div class="stat"><b>${nK}</b><span>coded excerpts</span></div>
    </div>
    <div class="ov-people"><div class="ov-people-head"><h3>👥 Participants</h3><button class="btn small" data-go="people">${attrList().length ? 'Edit details' : '＋ Add participant details'}</button>${attrList().length && nK ? '<button class="btn small primary" data-go="compare">Compare groups →</button>' : ''}</div>
      ${attrList().length ? attrList().map(a => `<div class="ov-attr"><b>${esc(a.name)}</b> ${attrGroups(a).map(g => `<span class="chip ${g.key === NOT_SET ? 'muted' : ''}">${esc(g.label)} <b>${g.docs.length}</b></span>`).join('')}</div>`).join('')
        : '<p>Record details like gender, age group, or year in program for each interview, then compare how codes differ between groups.</p>'}</div></div>`;
  $$('[data-go]', el).forEach(b => { b.onclick = () => goView(b.dataset.go); b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goView(b.dataset.go); } }; });
}
function renderDocView(el) {
  const d = docById(S.docId);
  const ks = P.codings.filter(k => k.docId === d.id);
  const pts = [...new Set([0, d.text.length, ...ks.flatMap(k => [k.start, k.end])])].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1]; const seg = d.text.slice(s, e);
    const act = ks.filter(k => k.start <= s && k.end >= e);
    if (!act.length) { html += esc(seg); continue; }
    const codes = [...new Map(act.map(k => [k.codeId, codeById(k.codeId)])).values()].filter(Boolean);
    const shortest = act.slice().sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const bg = codeById(shortest.codeId)?.color || '#ccc';
    const shadows = codes.slice(0, 4).map((c, j) => `inset 0 -${3 * (j + 1)}px 0 ${c.color}`).join(',');
    html += `<span class="seg" data-s="${s}" data-e="${e}" style="background:${hexA(bg, .2)};box-shadow:${shadows}" title="${esc(codes.map(c => c.name).join(' · '))}">${esc(seg)}</span>`;
  }
  const scroll = el.scrollTop; const same = el.dataset.doc === d.id;
  el.innerHTML = `<div class="doc-head"><div><h1>${esc(d.name)}</h1><div class="meta">${plural(words(d.text), 'word')} · ${plural(ks.length, 'coding')}</div></div><div class="hint">Highlight text to code it · click colored text to see its codes</div><button class="btn small close-view" title="Close and go back to the project overview">✕ Close</button></div>
    ${detailsStrip(d)}
    ${d.source === 'pdf' ? `<div class="pdf-note">📄 Imported from PDF. If paragraphs look off, a Word or text version of this transcript will import more cleanly.</div>` : ''}
    <div class="doc-paper"><div class="doc-text" id="docText">${html}</div></div>`;
  el.dataset.doc = d.id;
  if (same) el.scrollTop = scroll;
  $('.close-view', el).onclick = goOverview;
  $$('[data-act=fields]', el).forEach(x => x.onclick = manageFields);
  wireAttrInputs(el);
  const dt = $('#docText');
  dt.addEventListener('mouseup', e => setTimeout(() => onDocMouseUp(e), 0));
  dt.addEventListener('contextmenu', e => { const sel = getSelOffsets(); if (sel) { e.preventDefault(); showPicker(sel, e.clientX, e.clientY); } });
}
function flashCoding(kid) {
  const k = P.codings.find(x => x.id === kid); if (!k) return;
  const segs = $$('#docText .seg').filter(s => +s.dataset.s >= k.start && +s.dataset.e <= k.end);
  if (!segs.length) return;
  const c = $('#center'); const r = segs[0].getBoundingClientRect(); const cr = c.getBoundingClientRect();
  c.scrollTop += r.top - cr.top - cr.height / 3;
  segs.forEach(s => { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); });
}

/* ---------- selection & coding ---------- */
function getSelOffsets() {
  const dt = $('#docText'); const sel = window.getSelection();
  if (!dt || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(dt)) return null;
  const off = (node, o) => { const x = document.createRange(); x.selectNodeContents(dt); x.setEnd(node, o); return x.toString().length; };
  const text = docById(S.docId).text;
  let s = dt.contains(r.startContainer) ? off(r.startContainer, r.startOffset) : 0;
  let e = dt.contains(r.endContainer) ? off(r.endContainer, r.endOffset) : text.length;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (e <= s) return null;
  return { docId: S.docId, start: s, end: e, rect: r.getBoundingClientRect() };
}
function onDocMouseUp(e) {
  if (e.button !== 0) return;
  const sel = getSelOffsets();
  if (sel) { const rr = sel.rect; showPicker(sel, rr.left + rr.width / 2, rr.bottom); return; }
  const seg = e.target.closest('.seg');
  if (seg) showCoverage(+seg.dataset.s, +seg.dataset.e, e.clientX, e.clientY);
}
let popEl = null;
function closePops() { if (popEl) { popEl.remove(); popEl = null; } $$('.ctx').forEach(x => x.remove()); }
function placePop(el, x, y) {
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8);
  let top = y + 10; if (top + h > innerHeight - 8) top = Math.max(8, y - h - 30);
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
function showPicker(sel, x, y) {
  closePops();
  const pop = document.createElement('div'); pop.className = 'pop'; popEl = pop;
  const preview = docById(sel.docId).text.slice(sel.start, sel.end);
  pop.innerHTML = `<div class="pop-title"><span>Apply codes to “${esc(preview.length > 38 ? preview.slice(0, 38) + '…' : preview)}”</span></div>
    <div id="pickMain"><input type="text" placeholder="Find or create a code…" id="pickIn" autocomplete="off"><div class="pick-list" id="pickList"></div>
    <div class="pop-foot"><span>Enter to apply · Esc to close</span><button class="btn small" id="pickDone">Done</button></div></div>
    <div id="pickCreate" class="hidden">
      <div class="pc-field"><label for="pcName">New code name</label><input type="text" id="pcName" autocomplete="off"></div>
      <div class="pc-field"><label for="pcDef">Definition</label><textarea id="pcDef" rows="3" placeholder="What does this code capture? This becomes the description in your codebook."></textarea></div>
      <div class="pop-foot"><button class="btn small ghost" id="pcBack">← Back</button><span style="flex:1"></span><button class="btn small primary" id="pcGo">Create &amp; apply</button></div>
    </div>`;
  placePop(pop, x, y);
  let idx = 0, items = [];
  const has = cid => P.codings.some(k => k.docId === sel.docId && k.start === sel.start && k.end === sel.end && k.codeId === cid);
  const draw = () => {
    const q = $('#pickIn', pop).value.trim(); const ql = q.toLowerCase();
    items = []; let html = '';
    const row = (c, depth) => { items.push({ type: 'code', id: c.id }); return `<div class="pick" data-i="${items.length - 1}" style="padding-left:${7 + depth * 14}px"><span class="chk">${has(c.id) ? '✓' : ''}</span><span class="swatch" style="background:${c.color}"></span><span class="pn">${esc(c.name)}</span></div>`; };
    if (!q) {
      const rec = S.recentCodes.map(codeById).filter(Boolean).slice(0, 4);
      if (rec.length && P.codes.length > 6) { html += '<div class="pick-sec">Recent</div>' + rec.map(c => row(c, 0)).join(''); html += '<div class="pick-sec">All codes</div>'; }
      html += treeOrder().map(r => row(r.c, r.depth)).join('');
    } else {
      const m = P.codes.filter(c => c.name.toLowerCase().includes(ql)).sort((a, b) => a.name.toLowerCase().indexOf(ql) - b.name.toLowerCase().indexOf(ql));
      html += m.map(c => row(c, 0)).join('');
      if (!P.codes.some(c => c.name.toLowerCase() === ql)) { items.push({ type: 'create', name: q }); html += `<div class="pick create" data-i="${items.length - 1}"><span class="chk">＋</span><span class="pn">Create code “${esc(q)}”</span></div>`; }
    }
    if (!items.length) html = `<div class="pick-sec" style="text-transform:none;letter-spacing:0">Type a name to create your first code.</div>`;
    idx = Math.min(idx, Math.max(0, items.length - 1));
    $('#pickList', pop).innerHTML = html; mark();
  };
  const mark = () => { $$('.pick', pop).forEach(p => p.classList.toggle('sel', +p.dataset.i === idx)); const s = $('.pick.sel', pop); s && s.scrollIntoView({ block: 'nearest' }); };
  const choose = i => {
    const it = items[i]; if (!it) return;
    if (it.type === 'create') { openCreate(it.name); return; }
    toggleCoding(sel, it.id);
    draw(); $('#pickIn', pop).focus();
  };
  const openCreate = name => {
    $('#pickMain', pop).classList.add('hidden'); $('#pickCreate', pop).classList.remove('hidden');
    $('#pcName', pop).value = name; $('#pcDef', pop).value = '';
    setTimeout(() => $('#pcDef', pop).focus(), 0);
  };
  const backToList = () => { $('#pickCreate', pop).classList.add('hidden'); $('#pickMain', pop).classList.remove('hidden'); draw(); $('#pickIn', pop).focus(); };
  const submitCreate = () => {
    const name = $('#pcName', pop).value.trim(); if (!name) { $('#pcName', pop).focus(); return; }
    const c = createCode(name); c.description = $('#pcDef', pop).value.trim();
    addCoding(sel, c.id);
    $('#pickIn', pop).value = ''; idx = 0;
    toast(`Created and applied “${c.name}”`);
    backToList();
  };
  $('#pcGo', pop).onclick = submitCreate;
  $('#pcBack', pop).onclick = backToList;
  $('#pickCreate', pop).addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); backToList(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (e.target.id === 'pcName') $('#pcDef', pop).focus(); else submitCreate(); }
  });
  $('#pickIn', pop).addEventListener('input', () => { idx = 0; draw(); });
  $('#pickIn', pop).addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(idx); }
    else if (e.key === 'Escape') { closePops(); }
  });
  $('#pickList', pop).addEventListener('mousedown', e => { e.preventDefault(); const p = e.target.closest('.pick'); if (p) choose(+p.dataset.i); });
  $('#pickDone', pop).onclick = closePops;
  draw(); setTimeout(() => $('#pickIn', pop)?.focus(), 0);
}
function addCoding(sel, codeId) {
  P.codings.push({ id: uid(), docId: sel.docId, codeId, start: sel.start, end: sel.end, starred: false, created: now() });
  S.recentCodes = [codeId, ...S.recentCodes.filter(x => x !== codeId)].slice(0, 6);
  changedKeepPop();
}
function toggleCoding(sel, codeId) {
  const ex = P.codings.find(k => k.docId === sel.docId && k.start === sel.start && k.end === sel.end && k.codeId === codeId);
  if (ex) { P.codings = P.codings.filter(k => k !== ex); changedKeepPop(); }
  else addCoding(sel, codeId);
}
function changedKeepPop() { const p = popEl; popEl = null; changed(); popEl = p; }
function showCoverage(s, e, x, y) {
  closePops();
  const ks = P.codings.filter(k => k.docId === S.docId && k.start <= s && k.end >= e);
  if (!ks.length) return;
  const pop = document.createElement('div'); pop.className = 'pop'; popEl = pop;
  pop.innerHTML = `<div class="pop-title"><span>Codes on this passage</span></div>` + ks.map(k => { const c = codeById(k.codeId); const t = codingText(k);
    return `<div class="cov-item" data-k="${k.id}"><span class="swatch" style="background:${c.color}"></span><span class="pn" title="View all “${esc(c.name)}” excerpts">${esc(c.name)}</span><span style="font-size:11px;color:var(--muted)">${plural(words(t), 'word')}</span><button class="icon-btn" data-rm title="Remove this coding">✕</button></div>`; }).join('')
    + `<div class="pop-foot"><span>Tip: highlight the same text again to add more codes.</span></div>`;
  placePop(pop, x, y);
  pop.onclick = ev => {
    const it = ev.target.closest('.cov-item'); if (!it) return;
    const k = P.codings.find(z => z.id === it.dataset.k);
    if (ev.target.closest('[data-rm]')) { snapshot(); P.codings = P.codings.filter(z => z !== k); closePops(); changed(); toast(`Removed “${codeById(k.codeId).name}” from that passage`, { action: 'Undo', onAction: undo }); }
    else if (ev.target.closest('.pn')) openCode(k.codeId);
  };
}
function ctxMenu(e, items) {
  closePops();
  const m = document.createElement('div'); m.className = 'ctx';
  m.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 8) + 'px';
  m.onclick = ev => { const b = ev.target.closest('button'); if (b) { m.remove(); items[+b.dataset.i].fn(); } };
}

/* ---------- code view (excerpts) ---------- */
function renderCodeView(el) {
  S.visitedCode = true;
  const c = codeById(S.codeId); const kids = descendants(c.id);
  const ids = new Set([c.id, ...(S.includeChildren ? kids : [])]);
  let ks = P.codings.filter(k => ids.has(k.codeId));
  const docOrder = new Map(P.documents.map((d, i) => [d.id, i]));
  ks.sort((a, b) => (docOrder.get(a.docId) - docOrder.get(b.docId)) || a.start - b.start);
  const totalDocs = new Set(ks.map(k => k.docId)).size;
  const q = S.exSearch.trim().toLowerCase();
  const shown = q ? ks.filter(k => codingText(k).toLowerCase().includes(q)) : ks;
  const path = codePath(c);
  const hl = t => { const e = esc(t); if (!q) return e; const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); return e.replace(re, m => `<mark>${m}</mark>`); };
  const autoEx = exemplarFor(c.id); const autoId = autoEx && autoEx.auto ? autoEx.k.id : null;
  const groups = []; shown.forEach(k => { let g = groups[groups.length - 1]; if (!g || g.docId !== k.docId) groups.push(g = { docId: k.docId, items: [] }); g.items.push(k); });
  el.innerHTML = `<div class="cv">
    <div class="cv-head"><span class="bar" style="background:${c.color}"></span><div style="flex:1">
      ${path.length > 1 ? `<div class="cv-path">${esc(path.slice(0, -1).join(' › '))} ›</div>` : ''}
      <h1>${esc(c.name)}</h1>
      <p class="cv-def ${c.description ? '' : 'empty'}">${c.description ? esc(c.description) : 'No definition yet. Add one so it appears in your codebook.'}</p>
      ${c.inclusion ? `<p class="cv-def"><b>Use when:</b> ${esc(c.inclusion)}</p>` : ''}${c.exclusion ? `<p class="cv-def"><b>Don't use when:</b> ${esc(c.exclusion)}</p>` : ''}
    </div><div class="cv-actions"><button class="btn small" id="cvEdit">Edit code</button><button class="btn small close-view" title="Close and go back to the project overview">✕ Close</button></div></div>
    <div class="cv-stats"><span class="pill"><b>${ks.length}</b> ${ks.length === 1 ? 'excerpt' : 'excerpts'}</span><span class="pill"><b>${totalDocs}</b> of ${P.documents.length} transcripts</span>
      ${kids.length ? `<label style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="cvKids" ${S.includeChildren ? 'checked' : ''}> Include child codes (${kids.length})</label>` : ''}</div>
    ${ks.length ? `<div class="cv-tools"><input type="search" id="cvSearch" placeholder="Search within these excerpts…" value="${esc(S.exSearch)}"></div>` : ''}
    <div id="cvList">${!ks.length ? `<div class="empty-state"><div class="big">Nothing coded here yet</div>Open a transcript, highlight a passage, and choose “${esc(c.name)}”.</div>`
      : !shown.length ? `<div class="empty-state">No excerpts match “${esc(S.exSearch)}”.</div>`
      : groups.map(g => { const d = docById(g.docId); return `<div class="cv-group"><h3>📄 ${esc(d.name)} <span style="font-weight:400">(${g.items.length})</span></h3>` + g.items.map(k => { const kc = codeById(k.codeId);
        return `<div class="ex ${k.starred ? 'starred' : ''}" style="--c:${kc.color}" data-k="${k.id}"><div class="ex-text">${hl(codingText(k))}</div><div class="ex-foot">
          ${kc.id !== c.id ? `<span class="tag"><i style="background:${kc.color}"></i>${esc(kc.name)}</span>` : ''}
          <button class="star ${k.starred ? 'on' : ''}" data-act="star" title="Mark as the exemplar quote for this code in your codebook">${k.starred ? '★ Exemplar' : '☆ Use as exemplar'}</button>
          ${k.id === autoId ? '<span class="auto-ex" title="No exemplar is starred for this code, so your codebook will use this excerpt. Star a different one to choose your own.">Auto exemplar</span>' : ''}
          <span style="flex:1"></span>
          <button class="btn small ghost" data-act="go">Show in transcript →</button>
          <button class="icon-btn" data-act="rm" title="Remove this coding">✕</button></div></div>`; }).join('') + '</div>'; }).join('')}</div></div>`;
  $('#cvEdit').onclick = () => editCode(c.id);
  $('.close-view', el).onclick = goOverview;
  if ($('#cvKids')) $('#cvKids').onchange = e => { S.includeChildren = e.target.checked; renderCenter(); };
  const si = $('#cvSearch'); if (si) si.oninput = e => { S.exSearch = e.target.value; const pos = e.target.selectionStart; renderCenter(); const n = $('#cvSearch'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#cvList').onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const k = P.codings.find(z => z.id === b.closest('.ex').dataset.k);
    if (b.dataset.act === 'go') openDoc(k.docId, k.id);
    if (b.dataset.act === 'star') { const was = k.starred; P.codings.forEach(z => { if (z.codeId === k.codeId) z.starred = false; }); k.starred = !was; changed(); }
    if (b.dataset.act === 'rm') { snapshot(); P.codings = P.codings.filter(z => z !== k); changed(); toast('Removed coding', { action: 'Undo', onAction: undo }); }
  };
}

/* ---------- exports ---------- */
function exemplarFor(codeId) {
  const ks = P.codings.filter(k => k.codeId === codeId);
  if (!ks.length) return null;
  const st = ks.find(k => k.starred); if (st) return { k: st, auto: false };
  const score = k => { const w = words(codingText(k)); return w < 12 ? 50 + (12 - w) : w > 50 ? 50 + (w - 50) / 2 : Math.abs(w - 28) / 30; };
  return { k: ks.slice().sort((a, b) => score(a) - score(b) || a.created.localeCompare(b.created))[0], auto: true };
}
function trimWords(t, n) { const w = t.split(/(\s+)/); let c = 0, out = ''; for (const p of w) { if (/\S/.test(p)) { if (c === n) return out.trim() + ' […]'; c++; } out += p; } return t; }
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const longDate = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
function orderedCodings(codeIds) {
  const docOrder = new Map(P.documents.map((d, i) => [d.id, i]));
  return P.codings.filter(k => codeIds.includes(k.codeId)).sort((a, b) => (docOrder.get(a.docId) - docOrder.get(b.docId)) || a.start - b.start);
}
// A snapshot of the codebook (also stored with each saved review version).
function codebookSnapshot() {
  const stats = codeStats();
  return treeOrder().map(({ c, depth }) => {
    const hasKids = P.codes.some(x => x.parentId === c.id);
    const ids = [c.id, ...descendants(c.id)];
    const ex = exemplarFor(c.id);
    return { id: c.id, name: c.name, parentId: c.parentId || null, depth, hasKids, color: c.color, description: c.description, inclusion: c.inclusion, exclusion: c.exclusion,
      n: stats.get(c.id).n, nTot: ids.reduce((a, id) => a + stats.get(id).n, 0), ndTot: new Set(ids.flatMap(id => [...stats.get(id).docs])).size,
      exText: ex ? trimWords(codingText(ex.k), 120) : '', exSource: ex ? docById(ex.k.docId).name : '' };
  });
}
function codebookDocx(snap, { criteria, counts }, subtitle) {
  const D = Docx; const landscape = criteria;
  const cols = [['Code', 2], ['Description', 3]];
  if (criteria) cols.push(['Use when', 2.4], ["Don't use when", 2.4]);
  cols.push(['Exemplar', criteria ? 4 : 4.2]);
  if (counts) cols.push(['Frequency', 1.25]);
  const total = landscape ? 13680 : 9720; const sum = cols.reduce((a, c) => a + c[1], 0);
  const widths = cols.map(c => Math.floor(c[1] / sum * total));
  const T = (txt, o = {}, po = {}) => D.para(D.run(txt, o), { style: 'TableText', ...po });
  const dash = T('—', { color: 'A89888' });
  const body = snap.map(c => {
    const cells = [T((c.depth ? '↳ ' : '') + c.name, { b: true }, { indent: c.depth * 220 }), c.description ? T(c.description) : dash];
    if (criteria) cells.push(c.inclusion ? T(c.inclusion) : dash, c.exclusion ? T(c.exclusion) : dash);
    cells.push(c.exText ? T('“' + c.exText + '”', { i: true }) + T(c.exSource, { color: '7A6A5A', size: 16 }) : dash);
    if (counts) cells.push(T(plural(c.nTot, 'excerpt')) + T(plural(c.ndTot, 'transcript') + (c.hasKids ? ', incl. child codes' : ''), { color: '7A6A5A', size: 16 }));
    return { cells, shade: c.depth === 0 && c.hasKids ? 'F6ECDC' : null };
  });
  const xml = D.para(D.run('Codebook'), { style: 'Title' }) + D.para(D.run(subtitle), { style: 'Subtitle' }) + D.table(widths, cols.map(c => c[0]), body);
  return D.build(xml, { landscape, title: P.name + ' – Codebook' });
}
function exportCodebook(opts, suffix = '') {
  const sub = `${P.name} · ${plural(P.codes.length, 'code')} · ${plural(P.documents.length, 'transcript')} · ${longDate()}${suffix ? ' · ' + suffix.replace(/^ - /, '').replace(/ - /g, ' · ') : ''}`;
  downloadBlob(codebookDocx(codebookSnapshot(), opts, sub), `${fileSafe(P.name)} - Codebook${suffix}.docx`);
}
function exportExcerptsDoc(suffix = '') {
  const D = Docx; let xml = D.para(D.run('Coded excerpts by code'), { style: 'Title' })
    + D.para(D.run(`${P.name} · ${plural(P.codings.length, 'excerpt')} · ${plural(P.documents.length, 'transcript')} · ${longDate()}`), { style: 'Subtitle' });
  treeOrder().forEach(({ c, depth }) => {
    const ks = orderedCodings([c.id]); const nd = new Set(ks.map(k => k.docId)).size;
    xml += D.para(D.run(c.name), { style: 'Heading' + Math.min(3, depth + 1) });
    if (c.description) xml += D.para(D.run(c.description, { i: true, color: '5B4A3B' }));
    xml += D.para(D.run(ks.length ? `${plural(ks.length, 'excerpt')} from ${plural(nd, 'transcript')}` : 'No excerpts coded directly to this code.', { color: '7A6A5A', size: 18 }));
    ks.forEach(k => {
      xml += D.para(D.run(codingText(k)), { style: 'Quote', border: c.color.slice(1) });
      xml += D.para([D.run('— ' + docById(k.docId).name + (docDetails(docById(k.docId)) ? ` (${docDetails(docById(k.docId), '; ')})` : '')), k.starred ? D.run('   ★ Exemplar', { b: true, color: 'B4532A' }) : ''], { style: 'Source' });
    });
  });
  downloadBlob(D.build(xml, { title: P.name + ' – Excerpts' }), `${fileSafe(P.name)} - Excerpts by code${suffix}.docx`);
}
function exportExcel(suffix = '') {
  const stats = codeStats(); const order = treeOrder();
  const as = attrList();
  const excerpts = [['Code', 'Code path', 'Transcript', ...as.map(a => a.name), 'Excerpt', 'Words', 'Exemplar']];
  order.forEach(({ c }) => orderedCodings([c.id]).forEach(k => { const t = codingText(k); const d = docById(k.docId); excerpts.push([c.name, codePath(c).join(' > '), d.name, ...as.map(a => attrLabel(d, a)), t, words(t), k.starred ? 'Yes' : '']); }));
  const book = [['Code', 'Code path', 'Level', 'Definition', 'Use when', "Don't use when", 'Excerpts', 'Transcripts', 'Exemplar', 'Exemplar source']];
  order.forEach(({ c, depth }) => { const st = stats.get(c.id); const ex = exemplarFor(c.id); book.push([c.name, codePath(c).join(' > '), depth + 1, c.description, c.inclusion, c.exclusion, st.n, st.docs.size, ex ? codingText(ex.k) : '', ex ? docById(ex.k.docId).name : '']); });
  const matrix = [['Code', ...P.documents.map(d => d.name), 'Total']];
  order.forEach(({ c, depth }) => { const row = P.documents.map(d => P.codings.filter(k => k.codeId === c.id && k.docId === d.id).length); matrix.push([(depth ? '  '.repeat(depth) + '↳ ' : '') + c.name, ...row, row.reduce((a, b) => a + b, 0)]); });
  const people = [['Transcript', ...as.map(a => a.name), 'Codings', 'Words']];
  P.documents.forEach(d => people.push([d.name, ...as.map(a => attrLabel(d, a)), P.codings.filter(k => k.docId === d.id).length, words(d.text)]));
  const usedNames = new Set(['Excerpts', 'Codebook', 'Code by transcript', 'Participants']);
  const groupSheets = as.map(a => {
    const { groups, rows } = compareData(a, true);
    const out = [['Code', ...groups.map(g => `${g.label} (n=${g.docs.length})`), `All (n=${P.documents.length})`]];
    rows.forEach(r => out.push([(r.depth ? '  '.repeat(r.depth) + '↳ ' : '') + r.c.name, ...r.cells.map(x => x.people), r.total.people]));
    out.push([]); out.push(['Numbers are participants with at least one excerpt for the code. Parent codes include their child codes.']);
    let name = ('By ' + a.name).replace(/[\[\]:*?\/\\]/g, '').slice(0, 31); let i = 2; while (usedNames.has(name)) name = name.slice(0, 28) + ' ' + i++; usedNames.add(name);
    return { name, rows: out, widths: [32, ...groups.map(() => 16), 14] };
  });
  const blob = Xlsx.build([
    { name: 'Excerpts', rows: excerpts, widths: [24, 32, 20, ...as.map(() => 16), 80, 8, 10] },
    { name: 'Codebook', rows: book, widths: [24, 32, 7, 50, 36, 36, 10, 12, 60, 20] },
    { name: 'Code by transcript', rows: matrix, widths: [30, ...P.documents.map(() => 14), 9] },
    ...(as.length ? [{ name: 'Participants', rows: people, widths: [24, ...as.map(() => 18), 10, 10] }] : []),
    ...groupSheets
  ]);
  downloadBlob(blob, `${fileSafe(P.name)} - Coded excerpts${suffix}.xlsx`);
}
function showExport() {
  closePops();
  const noDef = P.codes.filter(c => !c.description.trim());
  const autoN = P.codes.filter(c => { const e = exemplarFor(c.id); return e && e.auto; }).length;
  const emptyN = P.codes.filter(c => !P.codings.some(k => k.codeId === c.id)).length;
  const notes = [];
  if (noDef.length) notes.push(`<b>${plural(noDef.length, 'code')}</b> ${noDef.length === 1 ? 'has' : 'have'} no definition yet (${esc(noDef.slice(0, 4).map(c => c.name).join(', '))}${noDef.length > 4 ? '…' : ''}).`);
  if (autoN) notes.push(`<b>${plural(autoN, 'code')}</b> ${autoN === 1 ? 'has' : 'have'} no starred exemplar, so one will be picked automatically. Click a code and star an excerpt to choose your own.`);
  if (emptyN) notes.push(`<b>${plural(emptyN, 'code')}</b> ${emptyN === 1 ? 'has' : 'have'} no excerpts yet, so the exemplar will be blank.`);
  modal({ title: 'Export', wide: true, body: `
    <div class="privacy-note">🔒 <div><b>Check quotes before sharing.</b> Exemplars and excerpts are direct quotes from participants. Before you share these files with your committee or include them in your thesis, make sure they don't contain names, places, or other details that could identify someone.</div></div>
    <div class="exp-card"><div class="exp-ico">📘</div><div class="exp-main"><h3>Codebook <span>Word</span></h3><p>A table of every code with its description and an exemplar quote. Child codes are indented under their parents.</p>
      <label><input type="checkbox" id="xCrit"><span>Include “Use when / Don't use when” columns <span class="muted">(landscape page)</span></span></label>
      <label><input type="checkbox" id="xCnt"><span>Include how many excerpts and transcripts each code has</span></label></div>
      <button class="btn primary" id="xBook" ${P.codes.length ? '' : 'disabled'}>Export</button></div>
    <div class="exp-card"><div class="exp-ico">📄</div><div class="exp-main"><h3>Excerpts by code <span>Word</span></h3><p>Every coded excerpt grouped under its code, with the transcript it came from. Handy when writing your findings.</p></div>
      <button class="btn primary" id="xDoc" ${P.codings.length ? '' : 'disabled'}>Export</button></div>
    <div class="exp-card"><div class="exp-ico">📊</div><div class="exp-main"><h3>Excerpts spreadsheet <span>Excel</span></h3><p>One row per excerpt for sorting and counting, plus sheets for the codebook, a code-by-transcript count, participant details, and a group comparison for each detail.</p></div>
      <button class="btn primary" id="xXls" ${P.codings.length ? '' : 'disabled'}>Export</button></div>
    ${notes.length ? `<div class="exp-notes"><b>Before you export</b><ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''}`,
    buttons: [{ label: 'Close', value: true }],
    onOpen: b => {
      const done = what => toast(`${what} is fresh out of the oven. Check your Downloads folder.`);
      const guard = fn => () => { try { fn(); } catch (e) { console.error(e); toast('Export failed: ' + e.message, { error: true }); } };
      b.querySelector('#xBook').onclick = guard(() => { exportCodebook({ criteria: b.querySelector('#xCrit').checked, counts: b.querySelector('#xCnt').checked }); done('Your codebook'); });
      b.querySelector('#xDoc').onclick = guard(() => { exportExcerptsDoc(); done('Your excerpts document'); });
      b.querySelector('#xXls').onclick = guard(() => { exportExcel(); done('Your spreadsheet'); });
    }
  });
}

/* ---------- help ---------- */
function showHelp() {
  modal({ title: 'How to use Easy Qual Oven', wide: true, body: `
    <p><b>1. Import transcripts.</b> Drag Word (.docx), text (.txt), or PDF files onto the window, or use <b>＋ Import</b>. Word and text files import most cleanly.</p>
    <p><b>2. Build a codebook.</b> Click <b>＋ New code</b>. Give each code a short definition; it becomes the description in your exported codebook. Drag a code onto another to make it a child code, or between codes to reorder.</p>
    <p><b>3. Code.</b> Highlight a passage in a transcript. A box appears: click a code, or type a new name and press <b>Enter</b>. You can apply several codes to the same passage. Right-clicking a highlight also opens the box. Click colored text to see or remove its codes.</p>
    <p><b>4. Review.</b> Click any code to see every excerpt with that code. Mark the clearest one as the <b>exemplar</b> for your codebook. “Show in transcript” jumps back to the original context.</p>
    <p><b>Code review &amp; notes.</b> Whenever you reach a milestone, or before sharing your work with someone, save a dated version with a note. Easy Qual Oven shows what changed since the last version, lets you export the files to share, and keeps a place for feedback and notes on each version.</p>
    <p><b>5. Compare groups.</b> Under <b>👥 Participants</b>, add details such as gender or age group and fill them in for each interview. <b>▦ Compare groups</b> then shows how many participants in each group mentioned each code. Click a number to read those excerpts.</p>
    <p><b>6. Export.</b> Click <b>⇩ Export</b> for a Word codebook (code, description, exemplar), a Word document of excerpts grouped by code, or an Excel spreadsheet.</p>
    <p><b>7. Save.</b> ${CAN_FS ? 'The first Save asks where to keep your project file; after that, it saves automatically.' : 'Save downloads your project file. Save at the end of every session and keep the newest copy.'} Keep a backup in your university cloud storage. To keep working later, choose <b>Open project</b>.</p>
    <p style="color:var(--muted)">🔒 <b>Private by design.</b> Everything stays on this computer, and a downloaded copy works without the internet. Nothing is uploaded or shared, which helps with IRB, ethics, and data-protection requirements.</p>`, buttons: [{ label: 'Got it', kind: 'primary', value: true }] });
}

/* ---------- sample project ---------- */
function sampleProject() {
  const p = newProject('Sample – Student life in a college town');
  const T = [
    ['P01 – Maya', `Interviewer: Can you tell me about your first semester here?

Maya: Honestly, the first few weeks were rough. I didn't know anyone, and everyone else seemed to already have friends from orientation. I remember eating lunch alone in the dining hall and thinking maybe I didn't belong here.

Interviewer: What changed?

Maya: I joined the hiking club because a girl in my chemistry lab invited me. After that, weekends felt different. I had people to text, people who noticed if I wasn't around.

Interviewer: How did you manage costs that first year?

Maya: I worked twenty hours a week at the coffee shop on Main Street. Rent in this town is ridiculous, so there were months where I was choosing between textbooks and groceries.

Interviewer: Did you use any campus services?

Maya: The food pantry, eventually. I was embarrassed at first, but the staff were really kind about it.`],
    ['P02 – Jordan', `Interviewer: What was it like moving here for college?

Jordan: My parents were really proud, but there was a lot of pressure. I'm the first in my family to go to a university, so every grade felt like it mattered for all of us.

Interviewer: Did you feel connected on campus?

Jordan: Not really, at least not at first. In seminars people used words I'd never heard, and I felt like an outsider who had snuck in. It took me a year to speak up in class.

Interviewer: Was there a turning point?

Jordan: The first-generation student group. Meeting people who had the same questions made a huge difference. We started a study group that met every Thursday at the library.

Interviewer: How about finances?

Jordan: I send part of my paycheck home. My mom says I don't have to, but I know it helps.`],
    ['P03 – Priya', `Interviewer: How would you describe your experience in this town?

Priya: I love it, actually. It's small enough that you run into professors at the farmers market, and that makes them feel more human.

Interviewer: Have you faced any challenges?

Priya: Finding housing was stressful. Landlords rent to students in August for the next year, so you have to sign a lease before you even know your roommates.

Interviewer: What about support on campus?

Priya: The writing center saved my thesis proposal. And my advisor checks in every couple of weeks, which keeps me on track.

Interviewer: Does your family weigh in on your plans?

Priya: They want me to go to medical school. I'm more interested in public health research, so we have a lot of conversations about that.`]
  ];
  const docs = T.map(([name, text]) => { const d = { id: uid(), name, text, source: 'sample', added: now(), attributes: {} }; p.documents.push(d); return d; });
  const opt = l => ({ id: uid(), label: l });
  const gender = { id: uid(), name: 'Gender', type: 'choice', options: [opt('Woman'), opt('Man'), opt('Non-binary'), opt('Prefer not to disclose')] };
  const firstGen = { id: uid(), name: 'First-generation', type: 'choice', options: [opt('Yes'), opt('No')] };
  const year = { id: uid(), name: 'Year in program', type: 'text', options: [] };
  p.attributes = [gender, firstGen, year];
  [[0, 1, 'Sophomore'], [1, 0, 'Junior'], [0, 1, 'Senior']].forEach(([g, f, y], i) => { docs[i].attributes = { [gender.id]: gender.options[g].id, [firstGen.id]: firstGen.options[f].id, [year.id]: y }; });
  P = p;
  const bel = createCode('Belonging'); bel.description = 'Experiences of fitting in, or not fitting in, at the university.';
  const fc = createCode('Finding community', bel.id); fc.description = 'Moments when the participant connects with a group or peers.'; fc.inclusion = 'Clubs, study groups, friendships, and invitations that lead to connection.';
  const out = createCode('Feeling like an outsider', bel.id); out.description = 'Descriptions of isolation or not belonging on campus.';
  const fin = createCode('Financial stress'); fin.description = 'Strain related to money, work, rent, or basic needs.';
  const fam = createCode('Family expectations'); fam.description = 'Pressure or hopes from family about school or career.';
  const res = createCode('Campus resources'); res.description = 'Use of university offices, programs, or services.';
  createCode('Town life');
  const code = (di, phrase, c, starred) => { const d = docs[di]; const s = d.text.indexOf(phrase); if (s >= 0) p.codings.push({ id: uid(), docId: d.id, codeId: c.id, start: s, end: s + phrase.length, starred: !!starred, created: now() }); };
  code(0, "I remember eating lunch alone in the dining hall and thinking maybe I didn't belong here.", out, true);
  code(1, 'I felt like an outsider who had snuck in', out);
  code(0, "I joined the hiking club because a girl in my chemistry lab invited me. After that, weekends felt different. I had people to text, people who noticed if I wasn't around.", fc, true);
  code(1, 'Meeting people who had the same questions made a huge difference.', fc);
  code(0, 'there were months where I was choosing between textbooks and groceries', fin);
  code(1, 'I send part of my paycheck home.', fin);
  code(2, 'Finding housing was stressful.', fin);
  code(1, "I'm the first in my family to go to a university, so every grade felt like it mattered for all of us.", fam);
  code(2, 'They want me to go to medical school.', fam);
  code(0, 'The food pantry, eventually. I was embarrassed at first, but the staff were really kind about it.', res);
  code(1, 'The first-generation student group.', res);
  code(2, 'The writing center saved my thesis proposal.', res);
  return p;
}

/* ---------- global events ---------- */
document.addEventListener('mousedown', e => {
  if (popEl && !popEl.contains(e.target)) { if (!e.target.closest('#docText')) closePops(); else { popEl.remove(); popEl = null; } }
  if (!e.target.closest('.ctx')) $$('.ctx').forEach(x => x.remove());
  if (!e.target.closest('.menu-wrap')) $('#menu')?.classList.add('hidden');
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (P) save(); }
  if (e.key === 'Escape') closePops();
});
$('#fileImport').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
$('#fileOpen').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadProjectText(await f.text(), null, f.name); });
let dragDepth = 0;
const isFileDrag = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!isFileDrag(e) || !P) return; dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { if (!isFileDrag(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!isFileDrag(e)) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (!P) return;
  const files = [...e.dataTransfer.files];
  const proj = files.find(f => /\.(qualoven)$/i.test(f.name));
  if (proj) { toast('To open a project, use Project ▾ → Open project.'); return; }
  importFiles(files);
});
window.addEventListener('beforeunload', e => { if (P && S.dirty && !S.fileHandle) { e.preventDefault(); e.returnValue = ''; } });
setInterval(renderSaveStatus, 20000);

$('.small-screen').innerHTML = `<div class="ss-inner">${LOGO}<h1>Easy Qual Oven</h1>
  <p class="ss-lead">Your window is a little too small.</p>
  <p>Easy Qual Oven shows your transcripts, the text you're coding, and your codebook side by side, so it needs a wider window.</p>
  <p class="ss-how"><b>Maximize this window</b> (or drag its edge to make it wider) and everything will appear.</p></div>
  <div class="footer">${FOOTER()}</div>`;
showWelcome();
