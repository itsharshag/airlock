// Renders film/index.html frame by frame into an mp4.
// Usage: node film/render.mjs <recording out dir (demo.mp4, agent.log, t0)> <out.mp4> [--only=<sec>]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const [rec, outFile, only] = process.argv.slice(2);
const dir = path.dirname(new URL(import.meta.url).pathname);
const t0 = Number(fs.readFileSync(path.join(rec, 't0'), 'utf8'));
const marks = {};
for (const l of fs.readFileSync(path.join(rec, 'agent.log'), 'utf8').split('\n')) { const m = l.match(/^MARK (\w+) (\d+)/); if (m) marks[m[1]] = (Number(m[2]) - t0) / 1000; }
console.log('marks', marks);
fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
if (!fs.existsSync(path.join(dir, 'frames', 'f00001.jpg'))) execSync(`ffmpeg -loglevel error -i ${rec}/demo.mp4 -vf fps=30 -q:v 2 ${dir}/frames/f%05d.jpg`);
const browser = await chromium.launch();
const mk = async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(m => { window.MARKS = m; }, marks);
  await page.goto('file://' + path.join(dir, 'index.html'));
  await page.evaluate(() => window.ready);
  return page;
};
const probe = await mk();
const dur = await probe.evaluate(() => window.DURATION);
const N = Math.ceil(dur * 30);
const tmp = path.join(dir, 'out-frames'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
if (only) {
  for (const s of only.split(',')) { await probe.evaluate(t => window.seek(t), Number(s)); await probe.screenshot({ path: path.join(rec, `still-${s}.jpg`), type: 'jpeg', quality: 90 }); }
  await browser.close(); process.exit(0);
}
const W = 6; const pages = [probe, ...await Promise.all(Array.from({ length: W - 1 }, mk))];
let next = 0; const started = Date.now();
await Promise.all(pages.map(async pg => {
  for (;;) {
    const i = next++; if (i >= N) return;
    await pg.evaluate(t => window.seek(t), i / 30);
    await pg.screenshot({ path: path.join(tmp, `o${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    if (i % 300 === 0) console.log(`frame ${i}/${N} ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}));
await browser.close();
execSync(`ffmpeg -y -loglevel error -framerate 30 -i ${tmp}/o%05d.jpg -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart ${outFile}`);
console.log('wrote', outFile, dur.toFixed(1) + 's');
