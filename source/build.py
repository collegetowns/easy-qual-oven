import re, datetime, pathlib, sys
root = pathlib.Path(__file__).parent
version = (root/'VERSION').read_text().strip()
date = datetime.date.today().isoformat()
def strip_map(s): return re.sub(r'//# sourceMappingURL=\S+', '', s)
def safe(s): return s.replace('</script', '<\\/script')
html = (root/'src/index.html').read_text()
css = (root/'src/styles.css').read_text()
js = '\n'.join((root/f'src/{n}.js').read_text() for n in ['importers','exporters','groups','reviews','app'])
js = js.replace('/*VERSION*/', version).replace('/*BUILD_DATE*/', date)
pdf = strip_map((root/'vendor/pdfjs/build/pdf.js').read_text())
worker = strip_map((root/'vendor/pdfjs/build/pdf.worker.js').read_text())
for k, v in [('/*INLINE_CSS*/', css), ('/*INLINE_JS*/', safe(js)), ('/*INLINE_PDFJS*/', safe(pdf)), ('/*INLINE_PDFWORKER*/', safe(worker))]:
    assert k in html, k
    html = html.replace(k, v)
out = root/'dist'; out.mkdir(exist_ok=True)
(out/'easy-qual-oven.html').write_text(html)
print('built', version, date, len(html)//1024, 'KB')
