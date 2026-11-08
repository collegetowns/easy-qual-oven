# Easy Qual Oven

*Where coding isn't half-baked.*

Easy Qual Oven is a simple qualitative coding tool for interview research. Import your transcripts, build a codebook, and see every excerpt for a code in one place.

- Import interview transcripts from Word (.docx), text (.txt) or PDF
- Build a codebook with definitions, colors, child codes, and "use when / don't use when" notes
- Highlight a passage to code it; click a code to see every excerpt, with a link back to the transcript
- Record participant details (gender, age group, year in program…) with your own categories
- Compare codes across groups, counting participants rather than excerpts
- Save dated versions of your codebook with notes, and see what changed since last time
- Export a Word codebook (code, description, exemplar), a Word document of excerpts by code, and an Excel spreadsheet

Live site: https://easyqualoven.collegetowns.org

## Web version or download

Use it online, or click **Download the app** to keep it on your computer. The downloaded file opens in your browser by double-clicking and works without an internet connection.

## Privacy

Everything runs in the browser on your own computer. Transcripts, codes and notes are never uploaded, stored on a server, or shared. Your work is saved in a project file (`.qualoven`) that you keep. This makes Easy Qual Oven a good fit for sensitive interviews and projects with IRB, ethics board or data-protection requirements.

Works best in Google Chrome or Microsoft Edge on a laptop or desktop computer (these browsers can save your project file automatically). Safari and Firefox work too; there, Save downloads your project file.

## Editing the app

The app is the single file `index.html`, which loads nothing from outside. It is built from the files in `source/`: run `python3 build.py` inside `source/` and copy `dist/easy-qual-oven.html` to `index.html`. The version number is in `source/VERSION`. PDF reading uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0).

A [College Towns](https://www.collegetowns.org/) project.
