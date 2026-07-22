import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
const DURATION_SEC = parseFloat(process.env.DURATION_SEC || '6');
const OUT = 'dist';
if (!SHEET_CSV_URL) { console.error('Falta SHEET_CSV_URL'); process.exit(1); }

const MEDIDAS = {
  h: { col: 'url_horizontal', w: 1920, h: 1080 },
  v: { col: 'url_vertical',   w: 1080, h: 1920 },
};
const CODIGO = { venezuela: 've', colombia: 'co' };

function parseCSV(t) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (q) { if (c === '"' && n === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c === '\r') {} else f += c; }
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const toObjects = rows => {
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).filter(r => r.some(c => c.trim() !== ''))
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
};
const truthy = v => ['si','sí','true','1','x','activo','yes'].includes(String(v||'').trim().toLowerCase());
const hoyVE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

async function frameBuffer(url, W, H) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return await sharp(buf)
    .resize(W, H, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .png().toBuffer();
}

async function build(tag, W, H, urls) {
  const frames = [];
  for (const u of urls) {
    try { frames.push(await frameBuffer(u, W, H)); }
    catch (e) { console.warn('  imagen omitida:', u, e.message); }
  }
  if (frames.length === 0) {
    frames.push(await sharp({ create: { width: W, height: H, channels: 3, background: { r:0,g:0,b:0 } } }).png().toBuffer());
  }
  const delay = frames.map(() => Math.max(1, DURATION_SEC) * 1000);
  const mk = () => frames.length === 1 ? sharp(frames[0]) : sharp(frames, { join: { animated: true } });

  const gif = await mk().gif({ delay, loop: 0, dither: 1.0 }).toBuffer();
  await writeFile(`${OUT}/${tag}.gif`, gif);
  const webp = await mk().webp({ delay, loop: 0, quality: 82 }).toBuffer();
  await writeFile(`${OUT}/${tag}.webp`, webp);
  console.log(`  ${tag}: ${frames.length} frame(s) — gif ${Math.round(gif.length/1024)}KB, webp ${Math.round(webp.length/1024)}KB`);
}

const csv = await (await fetch(SHEET_CSV_URL, { headers: { 'cache-control': 'no-cache' } })).text();
const hoy = hoyVE();
const activos = toObjects(parseCSV(csv)).filter(r =>
  truthy(r.activo) && (!r.inicio || hoy >= r.inicio) && (!r.fin || hoy <= r.fin)
).sort((a, b) => (parseFloat(a.orden)||9999) - (parseFloat(b.orden)||9999));
console.log(`Hoy (VE): ${hoy} — ${activos.length} arte(s) activo(s)`);

const grupos = {};
for (const r of activos) {
  const code = CODIGO[String(r.pais||'').trim().toLowerCase()] || 've';
  for (const [k, m] of Object.entries(MEDIDAS)) {
    const url = r[m.col];
    if (!url) continue;
    ((grupos[`sc_${code}_${k}`] ||= { w: m.w, h: m.h, urls: [] })).urls.push(url);
  }
}

await mkdir(OUT, { recursive: true });
for (const [tag, g] of Object.entries(grupos)) {
  console.log(`${tag} (${g.w}x${g.h}):`);
  await build(tag, g.w, g.h, g.urls);
}
console.log('Listo.');
