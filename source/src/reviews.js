/* ===== Code review & notes: dated versions of the codebook with notes and change tracking ===== */
// P.reviews = [{ id, n, date, note, feedback, stats: {docs, codes, codings}, docNames: [], codes: codebookSnapshot() }]
function reviewList() { return P.reviews || (P.reviews = []); }
function touched() { P.modified = now(); S.dirty = true; renderSaveStatus(); clearTimeout(autosaveTimer); autosaveTimer = setTimeout(autosave, 1200); }
const isoDay = d => new Date(d).toISOString().slice(0, 10);
const niceDate = d => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function diffVersions(prev, cur) {
  const pm = new Map(prev.codes.map(c => [c.id, c])), cm = new Map(cur.codes.map(c => [c.id, c]));
  const out = { added: [], removed: [], renamed: [], redefined: [], moved: [], grew: [], docsAdded: [], docsRemoved: [] };
  cur.codes.forEach(c => {
    const p = pm.get(c.id);
    if (!p) { out.added.push(c.name); return; }
    if (p.name !== c.name) out.renamed.push([p.name, c.name]);
    if ((p.description || '') !== (c.description || '') || (p.inclusion || '') !== (c.inclusion || '') || (p.exclusion || '') !== (c.exclusion || '')) out.redefined.push(c.name);
    if ((p.parentId || null) !== (c.parentId || null)) out.moved.push(c.name);
    if (c.n !== p.n) out.grew.push([c.name, c.n - p.n]);
  });
  prev.codes.forEach(p => { if (!cm.has(p.id)) out.removed.push(p.name); });
  const pd = new Set(prev.docNames || []), cd = new Set(cur.docNames || []);
  out.docsAdded = [...cd].filter(x => !pd.has(x)); out.docsRemoved = [...pd].filter(x => !cd.has(x));
  out.excerptDelta = cur.stats.codings - prev.stats.codings;
  return out;
}
function changeItems(d) {
  const list = (arr, max = 6) => esc(arr.slice(0, max).join(', ')) + (arr.length > max ? `, and ${arr.length - max} more` : '');
  const items = [];
  if (d.docsAdded.length) items.push(`<b>${plural(d.docsAdded.length, 'transcript')} added:</b> ${list(d.docsAdded)}`);
  if (d.docsRemoved.length) items.push(`<b>${plural(d.docsRemoved.length, 'transcript')} removed:</b> ${list(d.docsRemoved)}`);
  if (d.added.length) items.push(`<b>${plural(d.added.length, 'new code')}:</b> ${list(d.added)}`);
  if (d.removed.length) items.push(`<b>${plural(d.removed.length, 'code')} removed:</b> ${list(d.removed)}`);
  if (d.renamed.length) items.push(`<b>${plural(d.renamed.length, 'code')} renamed:</b> ${d.renamed.slice(0, 6).map(([a, b]) => `${esc(a)} → ${esc(b)}`).join(', ')}`);
  if (d.moved.length) items.push(`<b>${plural(d.moved.length, 'code')} moved</b> in the codebook: ${list(d.moved)}`);
  if (d.redefined.length) items.push(`<b>${d.redefined.length === 1 ? 'Definition' : 'Definitions'} updated:</b> ${list(d.redefined)}`);
  if (d.excerptDelta) {
    const top = d.grew.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([nm, n]) => `${esc(nm)} +${n}`).join(', ');
    const m = Math.abs(d.excerptDelta); const w = m === 1 ? 'coded excerpt' : 'coded excerpts';
    items.push(`<b>${d.excerptDelta > 0 ? `${m.toLocaleString()} more ${w}` : `${m.toLocaleString()} fewer ${w}`}</b>${top ? ` (new in ${top})` : ''}`);
  }
  return items;
}
function currentVersionData() {
  return { stats: { docs: P.documents.length, codes: P.codes.length, codings: P.codings.length }, docNames: P.documents.map(d => d.name), codes: codebookSnapshot() };
}

function renderReviewsView(el) {
  const rs = reviewList(); const last = rs[rs.length - 1]; const nextN = (last ? last.n : 0) + 1;
  const cur = currentVersionData();
  const pending = last ? changeItems(diffVersions(last, cur)) : [];
  const keepNote = $('#rvNote') ? $('#rvNote').value : '';
  el.innerHTML = `<div class="cv wide">
    <div class="cv-head"><div style="flex:1"><h1>Code review &amp; notes</h1>
      <p class="cv-def">Save a dated version of your codebook whenever you reach a milestone or want feedback on your coding. Each version records your codes, definitions, and counts, shows what changed since the version before, and keeps a place for notes.</p></div>
      <button class="btn small close-view">✕ Close</button></div>
    <div class="rv-new">
      <h2>Save version ${nextN}</h2>
      <div class="rv-since">${!last ? 'This will be your first saved version.' : pending.length ? `<div class="rv-since-head">Changes since version ${last.n} (${esc(niceDate(last.date))})</div><ul>${pending.map(i => `<li>${i}</li>`).join('')}</ul>` : `No changes since version ${last.n} (${esc(niceDate(last.date))}).`}</div>
      <div class="field"><label for="rvNote">Note for this version <span class="muted">(optional)</span></label><textarea id="rvNote" rows="3" placeholder="What did you work on? For example: Coded P01–P06. Split “Belonging” into two child codes.">${esc(keepNote)}</textarea></div>
      <div class="rv-files"><div class="rv-files-head">Also export these files</div>
        <label><input type="checkbox" id="rvBook" checked> Codebook (Word)</label>
        <label><input type="checkbox" id="rvDoc"> Excerpts by code (Word)</label>
        <label><input type="checkbox" id="rvXls"> Excerpts spreadsheet (Excel)</label>
        <label><input type="checkbox" id="rvProj"> Copy of the project file (someone with Easy Qual Oven can open your actual coding)</label>
        <div class="muted" style="font-size:12px;margin-top:4px">File names include the version number and date. Check quotes for identifying details before sharing.</div></div>
      <button class="btn primary" id="rvSave">Save version ${nextN}</button>
    </div>
    <h2 class="rv-hist-title">Saved versions</h2>
    ${!rs.length ? '<div class="empty-state" style="padding:24px">No versions saved yet.</div>' : rs.slice().reverse().map((r, i, arr) => {
      const prev = rs[rs.indexOf(r) - 1]; const items = prev ? changeItems(diffVersions(prev, r)) : [];
      return `<div class="rv-card" data-id="${r.id}">
        <div class="rv-card-head"><h3>Version ${r.n}</h3><span class="rv-date">${esc(niceDate(r.date))}</span><span style="flex:1"></span>
          <span class="chip">${plural(r.stats.docs, 'transcript')}</span><span class="chip">${plural(r.stats.codes, 'code')}</span><span class="chip">${plural(r.stats.codings, 'excerpt')}</span></div>
        ${r.note ? `<div class="rv-note">${esc(r.note)}</div>` : ''}
        ${prev ? (items.length ? `<details class="rv-changes" ${i === 0 ? 'open' : ''}><summary>Changes from version ${prev.n}</summary><ul>${items.map(x => `<li>${x}</li>`).join('')}</ul></details>` : `<div class="rv-changes muted">No changes from version ${prev.n}.</div>`) : '<div class="rv-changes muted">First version.</div>'}
        <div class="field"><label>Notes &amp; feedback</label><textarea class="rv-fb" rows="2" placeholder="Feedback received, decisions made, things to revisit…">${esc(r.feedback || '')}</textarea></div>
        <div class="rv-actions"><button class="btn small" data-act="book">⇩ Codebook from this version</button><span style="flex:1"></span><button class="btn small ghost danger" data-act="del">Delete version</button></div>
      </div>`; }).join('')}
  </div>`;
  $('.close-view', el).onclick = goOverview;
  $('#rvSave').onclick = () => saveReview({ note: $('#rvNote').value.trim(), book: $('#rvBook').checked, doc: $('#rvDoc').checked, xls: $('#rvXls').checked, proj: $('#rvProj').checked });
  el.querySelectorAll('.rv-card').forEach(card => {
    const r = rs.find(x => x.id === card.dataset.id);
    card.querySelector('.rv-fb').oninput = e => { r.feedback = e.target.value; touched(); };
    card.querySelector('[data-act=book]').onclick = () => {
      const opts = { criteria: r.codes.some(c => c.inclusion || c.exclusion), counts: true };
      downloadBlob(codebookDocx(r.codes, opts, `${P.name} · Version ${r.n} · ${niceDate(r.date)} · ${plural(r.stats.codes, 'code')} · ${plural(r.stats.docs, 'transcript')}`), `${fileSafe(P.name)} - Codebook - Version ${r.n} - ${isoDay(r.date)}.docx`);
      toast(`Codebook from version ${r.n} is fresh out of the oven. Check your Downloads folder.`);
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      const ok = await modal({ title: `Delete version ${r.n}?`, body: `<p>This removes the saved record of version ${r.n}, including its notes. Your current coding is not affected.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Delete version', kind: 'danger', value: true }] });
      if (!ok) return; snapshot(); P.reviews = rs.filter(x => x !== r); changed(); toast(`Deleted version ${r.n}`, { action: 'Undo', onAction: undo });
    };
  });
}
function saveReview({ note, book, doc, xls, proj }) {
  const rs = reviewList(); const n = (rs.length ? rs[rs.length - 1].n : 0) + 1;
  const r = { id: uid(), n, date: now(), note, feedback: '', ...currentVersionData() };
  rs.push(r);
  const tag = ` - Version ${n} - ${isoDay(r.date)}`;
  const jobs = [];
  if (book) jobs.push(() => exportCodebook({ criteria: P.codes.some(c => c.inclusion || c.exclusion), counts: true }, tag));
  if (doc && P.codings.length) jobs.push(() => exportExcerptsDoc(tag));
  if (xls && P.codings.length) jobs.push(() => exportExcel(tag));
  if (proj) jobs.push(() => downloadBlob(new Blob([serialize()], { type: 'application/json' }), `${fileSafe(P.name)}${tag}${FILE_EXT}`));
  if ($('#rvNote')) $('#rvNote').value = '';
  changed();
  jobs.forEach((j, i) => setTimeout(() => { try { j(); } catch (e) { console.error(e); toast('Export failed: ' + e.message, { error: true }); } }, i * 600));
  toast(jobs.length ? `Saved version ${n}. Your ${jobs.length === 1 ? 'file is' : 'files are'} fresh out of the oven. Check your Downloads folder.` : `Saved version ${n}.`, { ms: 6000 });
  if (jobs.length > 1) setTimeout(() => toast('If your browser asks about downloading multiple files, choose Allow.', { ms: 7000 }), 900);
}
