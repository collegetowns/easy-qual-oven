/* ===== File importers: .txt, .docx (built-in zip reader), .pdf (pdf.js, loaded on demand) ===== */
const Importers = (() => {
  function normalize(t) {
    return t.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  async function readZip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This does not look like a Word (.docx) file.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      files[dec.decode(new Uint8Array(buf, p + 46, nl))] = { method, csize, lho };
      p += 46 + nl + xl + cl;
    }
    return {
      has: n => !!files[n],
      async text(name) {
        const f = files[name]; if (!f) return null;
        const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
        const data = new Uint8Array(buf, start, f.csize);
        let bytes;
        if (f.method === 0) bytes = data;
        else if (f.method === 8) {
          if (typeof DecompressionStream === 'undefined') throw new Error('Your browser is too old to read Word files. Please update it, or use Chrome or Edge.');
          const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        } else throw new Error('Unsupported compression in Word file.');
        return dec.decode(bytes);
      }
    };
  }

  async function docx(buf) {
    const zip = await readZip(buf);
    const xml = await zip.text('word/document.xml');
    if (!xml) throw new Error('Could not find the text inside this Word file.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    const paras = [];
    const walk = (node, out) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType !== 1) continue;
        const ln = ch.localName;
        if (ch.namespaceURI === W) {
          if (ln === 't') { out.push(ch.textContent); continue; }
          if (ln === 'tab') { out.push('\t'); continue; }
          if (ln === 'br' || ln === 'cr') { out.push('\n'); continue; }
          if (ln === 'noBreakHyphen') { out.push('-'); continue; }
          if (ln === 'del' || ln === 'delText' || ln === 'instrText' || ln === 'rPr' || ln === 'pPr') continue;
        }
        walk(ch, out);
      }
    };
    const visit = node => {
      for (const ch of node.childNodes) {
        if (ch.nodeType !== 1) continue;
        if (ch.namespaceURI === W && ch.localName === 'p') {
          const out = []; walk(ch, out);
          const t = out.join('').replace(/[ \t]+$/, '');
          if (t.trim()) paras.push(t);
        } else if (ch.namespaceURI === W && ch.localName === 'tr') {
          const cells = [];
          for (const tc of ch.childNodes) {
            if (tc.nodeType === 1 && tc.localName === 'tc') { const out = []; walk(tc, out); cells.push(out.join('').trim()); }
          }
          const t = cells.filter(Boolean).join('\t');
          if (t) paras.push(t);
        } else visit(ch);
      }
    };
    visit(body || doc);
    return normalize(paras.join('\n\n'));
  }

  let pdfReady = null;
  function loadPdfJs() {
    if (pdfReady) return pdfReady;
    pdfReady = new Promise((resolve, reject) => {
      try {
        for (const id of ['lib-pdfworker', 'lib-pdf']) {
          const src = document.getElementById(id).textContent;
          const s = document.createElement('script');
          s.textContent = src;
          document.head.appendChild(s);
        }
        if (!window.pdfjsLib) throw new Error('PDF reader failed to load.');
        resolve(window.pdfjsLib);
      } catch (e) { reject(e); }
    });
    return pdfReady;
  }

  async function pdf(buf) {
    const lib = await loadPdfJs();
    const pdfDoc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const tc = await page.getTextContent();
      const lines = []; let cur = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
        if (!cur) cur = { text: '', y, h };
        cur.text += it.str;
        if (it.hasEOL) { lines.push(cur); cur = null; }
      }
      if (cur) lines.push(cur);
      pages.push(lines.map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter(l => l.text));
    }
    const speaker = /^([A-Z][A-Za-z0-9 .'\-]{0,28}|Q|A|I|R|P\d+)\s?:\s/;
    // remove repeated headers/footers and page numbers
    const key = t => t.replace(/\d+/g, '#').toLowerCase();
    const freq = {};
    pages.forEach(ls => { const seen = new Set(); [...ls.slice(0, 2), ...ls.slice(-2)].forEach(l => { const k = key(l.text); if (!seen.has(k)) { seen.add(k); freq[k] = (freq[k] || 0) + 1; } }); });
    const isNoise = (l, idx, ls) => {
      if (/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.text)) return true;
      const edge = idx < 2 || idx >= ls.length - 2;
      return edge && pages.length >= 3 && l.text.length < 80 && !speaker.test(l.text) && freq[key(l.text)] >= Math.max(3, pages.length * 0.6);
    };
    const paras = []; let para = '';
    pages.forEach(ls => {
      const clean = ls.filter((l, i) => !isNoise(l, i, ls));
      const gaps = []; for (let i = 1; i < clean.length; i++) gaps.push(Math.abs(clean[i - 1].y - clean[i].y));
      const sorted = gaps.slice().sort((a, b) => a - b);
      const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 14;
      clean.forEach((l, i) => {
        const gap = i > 0 ? Math.abs(clean[i - 1].y - l.y) : 0;
        const brk = !para || (i > 0 && gap > typical * 1.45) || speaker.test(l.text);
        if (brk && para) { paras.push(para); para = ''; }
        if (!para) para = l.text;
        else if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(l.text)) para = para.slice(0, -1) + l.text;
        else para += ' ' + l.text;
      });
    });
    if (para) paras.push(para);
    const text = normalize(paras.join('\n\n'));
    if (!text) throw new Error('No text was found in this PDF. It may be a scanned image; try a Word or text version instead.');
    return text;
  }

  async function readFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, '');
    if (ext === 'txt' || ext === 'md' || ext === 'text') return { name, text: normalize(await file.text()), source: 'txt' };
    if (ext === 'docx') return { name, text: await docx(await file.arrayBuffer()), source: 'docx' };
    if (ext === 'pdf') return { name, text: await pdf(await file.arrayBuffer()), source: 'pdf' };
    if (ext === 'doc') throw new Error('Older .doc files are not supported. Open it in Word and use "Save As" → .docx.');
    throw new Error('Unsupported file type. Use .docx, .txt, or .pdf.');
  }
  return { readFile, readZip, normalize };
})();
