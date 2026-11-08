/* ===== Participant details (demographics) and group comparison ===== */
// P.attributes = [{ id, name, type: 'choice' | 'text', options: [{ id, label }] }]
// doc.attributes[attrId] = option id (choice) or string (text)

const NOT_SET = '__notset__';
function attrList() { return P.attributes || (P.attributes = []); }
function attrById(id) { return attrList().find(a => a.id === id); }
function attrValue(doc, a) { const v = (doc.attributes || {})[a.id]; return v == null || v === '' ? null : v; }
function attrLabel(doc, a) {
  const v = attrValue(doc, a); if (v == null) return '';
  if (a.type === 'choice') { const o = a.options.find(o => o.id === v); return o ? o.label : ''; }
  return String(v);
}
function docDetails(doc, sep = ' · ') { return attrList().map(a => { const l = attrLabel(doc, a); return l ? `${a.name}: ${l}` : ''; }).filter(Boolean).join(sep); }
// groups for an attribute: [{ key, label, docs: [doc] }]
function attrGroups(a) {
  const groups = [];
  if (a.type === 'choice') a.options.forEach(o => groups.push({ key: o.id, label: o.label, docs: [] }));
  const byKey = new Map(groups.map(g => [g.key, g]));
  const notSet = { key: NOT_SET, label: 'Not set', docs: [] };
  P.documents.forEach(d => {
    const v = attrValue(d, a);
    if (v == null || (a.type === 'choice' && !byKey.has(v))) { notSet.docs.push(d); return; }
    const key = a.type === 'choice' ? v : String(v).trim().toLowerCase();
    if (!byKey.has(key)) { const g = { key, label: String(v).trim(), docs: [] }; byKey.set(key, g); groups.push(g); }
    byKey.get(key).docs.push(d);
  });
  if (a.type === 'text') groups.sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }));
  if (notSet.docs.length) groups.push(notSet);
  return groups;
}

/* ---------- manage fields ---------- */
async function manageFields() {
  closePops();
  const draft = JSON.parse(JSON.stringify(attrList()));
  const used = id => P.documents.filter(d => attrValue(d, { id }) != null).length;
  const res = await modal({
    title: 'Participant details & categories', wide: true,
    body: `<p style="margin-top:0">Add the details you record for each interview, such as gender, age group, or year in program.</p>
      <ul class="fld-tips"><li><b>You choose the categories.</b> For a list, add, rename, or remove options to fit your study, for example “Prefer not to disclose” or “Not reported.”</li>
      <li><b>Change the order</b> with the ↑ ↓ arrows. This is the order of the columns in the Participants table.</li>
      <li>Use <b>List of options</b> for anything you want to compare groups by.</li></ul><div id="fieldList"></div>
      <button class="btn small" id="addField" style="margin-top:6px">＋ Add a detail</button>`,
    onOpen: b => {
      const draw = () => {
        b.querySelector('#fieldList').innerHTML = draft.length ? draft.map((a, i) => `<div class="fld" data-i="${i}">
          <div class="fld-row"><input type="text" class="fld-name" placeholder="Detail name, e.g. Gender" value="${esc(a.name)}">
            <select class="fld-type"><option value="choice" ${a.type === 'choice' ? 'selected' : ''}>List of options</option><option value="text" ${a.type === 'text' ? 'selected' : ''}>Free text</option></select>
            <button class="icon-btn fld-up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn fld-down" title="Move down" ${i === draft.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon-btn fld-del" title="Remove this detail">🗑</button></div>
          ${a.type === 'choice' ? `<div class="fld-opts">${a.options.map((o, j) => `<span class="opt">${j ? `<button class="icon-btn opt-left" data-j="${j}" title="Move this option earlier">‹</button>` : ''}<input type="text" value="${esc(o.label)}" data-j="${j}" placeholder="Option" size="${Math.max(9, o.label.length + 2)}"><button class="icon-btn opt-del" data-j="${j}" title="Remove option">✕</button></span>`).join('')}<button class="btn small ghost opt-add">＋ Add option</button></div>` : '<div class="fld-help">Students type any value. Matching values are grouped together when comparing.</div>'}
          ${used(a.id) ? `<div class="fld-help">Filled in for ${plural(used(a.id), 'transcript')}.</div>` : ''}</div>`).join('') : '<div class="fld-help" style="padding:10px 0">No details yet.</div>';
        b.querySelectorAll('.fld').forEach(el => {
          const a = draft[+el.dataset.i];
          el.querySelector('.fld-name').oninput = e => { a.name = e.target.value; };
          el.querySelector('.fld-type').onchange = e => { a.type = e.target.value; if (a.type === 'choice' && !a.options.length) a.options.push({ id: uid(), label: '' }, { id: uid(), label: '' }); draw(); };
          el.querySelector('.fld-del').onclick = () => { draft.splice(+el.dataset.i, 1); draw(); };
          const mv = d => { const i = +el.dataset.i, k = i + d; if (k < 0 || k >= draft.length) return; [draft[i], draft[k]] = [draft[k], draft[i]]; draw(); };
          el.querySelector('.fld-up').onclick = () => mv(-1); el.querySelector('.fld-down').onclick = () => mv(1);
          el.querySelectorAll('.opt-left').forEach(x => x.onclick = () => { const j = +x.dataset.j; if (j > 0) { [a.options[j - 1], a.options[j]] = [a.options[j], a.options[j - 1]]; draw(); } });
          el.querySelectorAll('.opt input').forEach(inp => inp.oninput = e => { a.options[+inp.dataset.j].label = e.target.value; });
          el.querySelectorAll('.opt-del').forEach(x => x.onclick = () => { a.options.splice(+x.dataset.j, 1); draw(); });
          const add = el.querySelector('.opt-add'); if (add) add.onclick = () => { a.options.push({ id: uid(), label: '' }); draw(); const ins = el.parentNode.querySelectorAll(`.fld[data-i="${el.dataset.i}"] .opt input`); ins[ins.length - 1]?.focus(); };
        });
      };
      b.querySelector('#addField').onclick = () => { draft.push({ id: uid(), name: '', type: 'choice', options: [{ id: uid(), label: '' }, { id: uid(), label: '' }] }); draw(); const n = b.querySelectorAll('.fld-name'); n[n.length - 1].focus(); };
      if (!draft.length) b.querySelector('#addField').click(); else draw();
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save details', kind: 'primary', value: () => draft }]
  });
  if (!res) return;
  const cleaned = res.filter(a => a.name.trim()).map(a => ({ ...a, name: a.name.trim(), options: a.type === 'choice' ? a.options.filter(o => o.label.trim()).map(o => ({ ...o, label: o.label.trim() })) : [] }));
  const removed = attrList().filter(a => !cleaned.some(c => c.id === a.id));
  const lostValues = removed.reduce((n, a) => n + used(a.id), 0);
  if (lostValues) {
    const ok = await modal({ title: 'Remove details?', body: `<p>${esc(removed.map(a => a.name).join(', '))} will be removed, along with the values entered for ${plural(lostValues, 'transcript')}.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Remove', kind: 'danger', value: true }] });
    if (!ok) return;
  }
  snapshot();
  // a field switched between types loses its values
  cleaned.forEach(a => { const old = attrById(a.id); if (old && old.type !== a.type) P.documents.forEach(d => { delete d.attributes[a.id]; }); });
  removed.forEach(a => P.documents.forEach(d => { delete d.attributes[a.id]; }));
  P.attributes = cleaned;
  if (S.compareAttr && !attrById(S.compareAttr)) S.compareAttr = null;
  changed();
}
function setAttr(docId, attrId, value) {
  const d = docById(docId); d.attributes ||= {};
  if (value == null || value === '') delete d.attributes[attrId]; else d.attributes[attrId] = value;
  changed();
}
function attrInput(doc, a, cls = '') {
  const v = attrValue(doc, a);
  if (a.type === 'choice') return `<select class="attr-in ${cls}" data-doc="${doc.id}" data-attr="${a.id}"><option value="">—</option>${a.options.map(o => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}<option value="__add__">＋ Add an option…</option></select>`;
  return `<input type="text" class="attr-in ${cls}" data-doc="${doc.id}" data-attr="${a.id}" value="${esc(v || '')}" placeholder="—">`;
}
function wireAttrInputs(root) {
  root.querySelectorAll('.attr-in').forEach(el => {
    const commit = () => { const cur = attrValue(docById(el.dataset.doc), { id: el.dataset.attr }) || ''; const nv = el.value.trim(); if (nv !== cur) setAttr(el.dataset.doc, el.dataset.attr, nv); };
    if (el.tagName === 'SELECT') el.onchange = async () => {
      if (el.value !== '__add__') return commit();
      const a = attrById(el.dataset.attr); const prev = attrValue(docById(el.dataset.doc), a) || '';
      const label = await promptText(`Add an option to “${a.name}”`, 'New option', '', 'For example: Prefer not to disclose, or Not reported. It is added to the list for every transcript.');
      if (!label) { el.value = prev; return; }
      let o = a.options.find(x => x.label.toLowerCase() === label.toLowerCase());
      if (!o) { o = { id: uid(), label }; a.options.push(o); }
      setAttr(el.dataset.doc, a.id, o.id);
      toast(`Added “${label}” to ${a.name}`);
    };
    else { el.onchange = commit; el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } }; }
  });
}
// strip at the top of a transcript
function detailsStrip(doc) {
  const as = attrList();
  if (!as.length) return `<div class="pd-strip empty"><span>👤 Participant details</span><button class="btn small ghost" data-act="fields">＋ Add details like gender or age group</button></div>`;
  return `<div class="pd-strip"><span class="pd-title">👤 Participant details</span>${as.map(a => `<label class="pd-field"><span>${esc(a.name)}</span>${attrInput(doc, a)}</label>`).join('')}<button class="btn small ghost pd-edit" data-act="fields">Edit details &amp; categories</button></div>`;
}

/* ---------- participants table ---------- */
function renderPeopleView(el) {
  const as = attrList(); const counts = {}; P.codings.forEach(k => counts[k.docId] = (counts[k.docId] || 0) + 1);
  el.innerHTML = `<div class="cv wide"><div class="cv-head"><div style="flex:1"><h1>Participants</h1><p class="cv-def">Fill in details for each interview here, or at the top of each transcript. You decide which details and categories to use.</p></div>
    <div class="cv-actions"><button class="btn small" id="pvFields">Edit details &amp; categories</button><button class="btn small close-view">✕ Close</button></div></div>
    ${!P.documents.length ? `<div class="empty-state"><div class="big">No transcripts yet</div>Import transcripts first, then fill in their details here.</div>`
      : !as.length ? `<div class="empty-state"><div class="big">No participant details yet</div>Add details such as gender, age group, or year in program to compare groups.<br><br><button class="btn primary" id="pvFirst">＋ Add participant details</button></div>`
      : `<div class="ptips"><span>↔ Use the arrows in a column heading to move it left or right.</span><span>＋ Need another category? Choose <b>Add an option…</b> at the bottom of any dropdown.</span></div>
        <div class="ptable-wrap"><table class="ptable"><thead><tr><th>Transcript</th>${as.map((a, i) => `<th><div class="th-in"><button class="col-mv" data-mv="${a.id}" data-d="-1" title="Move column left" ${i === 0 ? 'disabled' : ''}>◀</button><span>${esc(a.name)}</span><button class="col-mv" data-mv="${a.id}" data-d="1" title="Move column right" ${i === as.length - 1 ? 'disabled' : ''}>▶</button></div></th>`).join('')}<th class="num">Codings</th></tr></thead><tbody>
        ${P.documents.map(d => `<tr><td><a href="#" class="plink" data-doc="${d.id}">${esc(d.name)}</a></td>${as.map(a => `<td>${attrInput(d, a)}</td>`).join('')}<td class="num">${counts[d.id] || 0}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="psum">${as.filter(a => a.type === 'choice').map(a => `<div><b>${esc(a.name)}:</b> ${attrGroups(a).map(g => `${esc(g.label)} ${g.docs.length}`).join(' · ')}</div>`).join('')}</div>
        ${as.some(a => a.type === 'choice' || a.type === 'text') && P.codings.length ? `<button class="btn primary" id="pvCompare">Compare codes across groups →</button>` : ''}`}</div>`;
  $('.close-view', el).onclick = goOverview;
  $('#pvFields').onclick = manageFields;
  if ($('#pvFirst')) $('#pvFirst').onclick = manageFields;
  if ($('#pvCompare')) $('#pvCompare').onclick = () => goView('compare');
  el.querySelectorAll('.col-mv').forEach(b => b.onclick = () => {
    const list = attrList(); const i = list.findIndex(a => a.id === b.dataset.mv); const k = i + +b.dataset.d;
    if (k < 0 || k >= list.length) return; [list[i], list[k]] = [list[k], list[i]]; changed();
  });
  el.querySelectorAll('.plink').forEach(x => x.onclick = e => { e.preventDefault(); openDoc(x.dataset.doc); });
  wireAttrInputs(el);
}

/* ---------- compare ---------- */
function compareData(a, includeKids) {
  const groups = attrGroups(a); const all = { key: '__all__', label: 'All participants', docs: P.documents.slice() };
  const rows = treeOrder().map(({ c, depth }) => {
    const hasKids = P.codes.some(x => x.parentId === c.id);
    const ids = new Set(includeKids && hasKids ? [c.id, ...descendants(c.id)] : [c.id]);
    const ks = P.codings.filter(k => ids.has(k.codeId));
    const cell = g => { const docIds = new Set(g.docs.map(d => d.id)); const gk = ks.filter(k => docIds.has(k.docId)); return { people: new Set(gk.map(k => k.docId)).size, n: g.docs.length, excerpts: gk.length }; };
    return { c, depth, hasKids, ids: [...ids], cells: groups.map(cell), total: cell(all) };
  });
  return { groups, rows, all };
}
function renderCompareView(el) {
  const as = attrList();
  if (!as.length) {
    el.innerHTML = `<div class="cv"><div class="cv-head"><div style="flex:1"><h1>Compare groups</h1></div><button class="btn small close-view">✕ Close</button></div>
      <div class="empty-state"><div class="big">Add participant details first</div>To compare, record details like gender or age group for each interview.<br><br><button class="btn primary" id="cmpFields">＋ Add participant details</button></div></div>`;
    $('.close-view', el).onclick = goOverview; $('#cmpFields').onclick = manageFields; return;
  }
  if (!S.compareAttr || !attrById(S.compareAttr)) S.compareAttr = (as.find(a => a.type === 'choice') || as[0]).id;
  const a = attrById(S.compareAttr); const mode = S.compareMode || 'people'; const kids = S.compareKids !== false;
  const { groups, rows } = compareData(a, kids);
  const fmt = x => mode === 'people' ? `<b>${x.people}</b><span> of ${x.n}</span>` : mode === 'pct' ? `<b>${x.n ? Math.round(x.people / x.n * 100) : 0}%</b>` : `<b>${x.excerpts}</b>`;
  const shade = x => { const p = x.n ? x.people / x.n : 0; return p ? `background:${hexA('#B4532A', 0.08 + p * 0.42)}` : ''; };
  const sel = S.compareCell;
  el.innerHTML = `<div class="cv wide"><div class="cv-head"><div style="flex:1"><h1>Compare groups</h1>
      <p class="cv-def">How often each code comes up in each group. Counting <b>participants</b> keeps one talkative interviewee from making a code look bigger than it is. Click any number to read those excerpts.</p></div>
      <div class="cv-actions"><button class="btn small" id="cmpExport">⇩ Word table</button><button class="btn small close-view">✕ Close</button></div></div>
    <div class="cmp-tools">
      <label>Compare by <select id="cmpAttr">${as.map(x => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="seg-ctl" id="cmpMode">${[['people', 'Participants'], ['pct', 'Percent'], ['excerpts', 'Excerpts']].map(([k, l]) => `<button data-m="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label><input type="checkbox" id="cmpKids" ${kids ? 'checked' : ''}> Parent codes include their child codes</label>
    </div>
    ${!P.codes.length ? '<div class="empty-state">No codes yet.</div>' : `<div class="ptable-wrap"><table class="ptable cmp"><thead><tr><th>Code</th>${groups.map(g => `<th class="num ${g.key === NOT_SET ? 'notset' : ''}">${esc(g.label)}<span class="gn">${plural(g.docs.length, 'participant')}</span></th>`).join('')}<th class="num tot">All<span class="gn">${plural(P.documents.length, 'participant')}</span></th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.hasKids ? 'parent' : ''}"><td style="padding-left:${10 + r.depth * 18}px"><span class="swatch" style="background:${r.c.color}"></span>${esc(r.c.name)}</td>
        ${r.cells.map((x, i) => `<td class="num cellbtn ${sel && sel.codeId === r.c.id && sel.key === groups[i].key ? 'sel' : ''}" data-code="${r.c.id}" data-key="${groups[i].key}" style="${shade(x)}" title="${x.people} of ${x.n} participants · ${plural(x.excerpts, 'excerpt')}">${fmt(x)}</td>`).join('')}
        <td class="num tot cellbtn ${sel && sel.codeId === r.c.id && sel.key === '__all__' ? 'sel' : ''}" data-code="${r.c.id}" data-key="__all__" title="${r.total.people} of ${r.total.n} participants · ${plural(r.total.excerpts, 'excerpt')}">${fmt(r.total)}</td></tr>`).join('')}
    </tbody></table></div>`}
    <div id="cmpDetail"></div></div>`;
  $('.close-view', el).onclick = goOverview;
  $('#cmpAttr').onchange = e => { S.compareAttr = e.target.value; S.compareCell = null; renderCenter(); };
  $('#cmpMode').onclick = e => { const b = e.target.closest('button'); if (b) { S.compareMode = b.dataset.m; renderCenter(); } };
  $('#cmpKids').onchange = e => { S.compareKids = e.target.checked; renderCenter(); };
  $('#cmpExport').onclick = () => { try { exportCompareDoc(a, kids); toast('Your comparison table is fresh out of the oven. Check your Downloads folder.'); } catch (err) { console.error(err); toast('Export failed: ' + err.message, { error: true }); } };
  el.querySelectorAll('.cellbtn').forEach(td => td.onclick = () => {
    const same = sel && sel.codeId === td.dataset.code && sel.key === td.dataset.key;
    S.compareCell = same ? null : { codeId: td.dataset.code, key: td.dataset.key };
    renderCenter();
    if (!same) requestAnimationFrame(() => $('#cmpDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
  if (sel && codeById(sel.codeId)) renderCompareDetail($('#cmpDetail'), a, rows.find(r => r.c.id === sel.codeId), sel.key === '__all__' ? { key: '__all__', label: 'All participants', docs: P.documents } : groups.find(g => g.key === sel.key));
}
function renderCompareDetail(box, a, row, g) {
  if (!row || !g) return;
  const docIds = new Set(g.docs.map(d => d.id)); const docOrder = new Map(P.documents.map((d, i) => [d.id, i]));
  const ks = P.codings.filter(k => row.ids.includes(k.codeId) && docIds.has(k.docId)).sort((x, y) => (docOrder.get(x.docId) - docOrder.get(y.docId)) || x.start - y.start);
  const people = new Set(ks.map(k => k.docId)).size;
  const without = g.docs.filter(d => !ks.some(k => k.docId === d.id));
  box.innerHTML = `<div class="cmp-detail"><div class="cmp-detail-head"><span class="swatch" style="background:${row.c.color}"></span><h2>${esc(row.c.name)} <span>· ${esc(g.label)}</span></h2><button class="icon-btn" id="cdClose" title="Close">✕</button></div>
    <div class="cmp-detail-sub">${people} of ${plural(g.docs.length, 'participant')} · ${plural(ks.length, 'excerpt')}${without.length && without.length <= 8 ? ` · Not mentioned by: ${esc(without.map(d => d.name).join(', '))}` : ''}</div>
    ${ks.length ? ks.map(k => { const kc = codeById(k.codeId); const d = docById(k.docId); return `<div class="ex" style="--c:${kc.color}" data-k="${k.id}"><div class="ex-text">${esc(codingText(k))}</div><div class="ex-foot">
      <span>📄 ${esc(d.name)}${docDetails(d) ? ` · ${esc(docDetails(d))}` : ''}</span>${kc.id !== row.c.id ? `<span class="tag"><i style="background:${kc.color}"></i>${esc(kc.name)}</span>` : ''}<span style="flex:1"></span>
      <button class="btn small ghost" data-act="go">Show in transcript →</button></div></div>`; }).join('') : '<div class="empty-state" style="padding:24px">No excerpts for this group.</div>'}</div>`;
  $('#cdClose').onclick = () => { S.compareCell = null; renderCenter(); };
  box.onclick = e => { const b = e.target.closest('[data-act=go]'); if (!b) return; const k = P.codings.find(z => z.id === b.closest('.ex').dataset.k); openDoc(k.docId, k.id); };
}
function exportCompareDoc(a, kids) {
  const D = Docx; const { groups, rows } = compareData(a, kids);
  const ncol = groups.length + 2; const landscape = ncol > 6; const total = landscape ? 13680 : 9720;
  const first = Math.min(3600, Math.max(2400, total * 0.3)); const rest = Math.floor((total - first) / (ncol - 1));
  const widths = [Math.floor(first), ...Array(ncol - 1).fill(rest)];
  const T = (txt, o = {}, po = {}) => D.para(D.run(txt, o), { style: 'TableText', ...po });
  const cellTxt = x => T(`${x.people} of ${x.n}`, { b: true }, { jc: 'center' }) + T(`${x.n ? Math.round(x.people / x.n * 100) : 0}% · ${plural(x.excerpts, 'excerpt')}`, { color: '7A6A5A', size: 16 }, { jc: 'center' });
  const body = rows.map(r => ({ cells: [T((r.depth ? '↳ ' : '') + r.c.name, { b: r.hasKids }, { indent: r.depth * 220 }), ...r.cells.map(cellTxt), cellTxt(r.total)], shade: r.depth === 0 && r.hasKids ? 'F6ECDC' : null }));
  const headers = [`Code`, ...groups.map(g => `${g.label} (n=${g.docs.length})`), `All (n=${P.documents.length})`];
  const xml = D.para(D.run(`Codes by ${a.name}`), { style: 'Title' })
    + D.para(D.run(`${P.name} · ${longDate()} · Cells show participants with at least one excerpt for the code, out of all participants in the group.${kids ? ' Parent codes include their child codes.' : ''}`), { style: 'Subtitle' })
    + D.table(widths, headers, body);
  downloadBlob(D.build(xml, { landscape, title: `${P.name} – Codes by ${a.name}` }), `${fileSafe(P.name)} - Codes by ${fileSafe(a.name)}.docx`);
}
