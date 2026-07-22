// Genera un GIF animado por (pais x medida) a partir de un Google Sheet publicado (CSV).
// Filtra por activo + rango de fechas (hoy en horario de Venezuela). Sin servicios externos de pago.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { mkdir, writeFile } from 'node:fs/promises';

const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
const DURATION_SEC = parseFloat(process.env.DURATION_SEC || '6');
const OUT = 'dist';

if (!SHEET_CSV_URL) { console.error('Falta SHEET_CSV_URL'); process.exit(1); }

// medidas: tamaño del lienzo por orientación
const MEDIDAS = {
  h: { col: 'url_horizontal', w: 1920, h: 1080 },
  v: { col: 'url_vertical',   w: 1080, h: 1920 },
};
const CODIGO = { venezuela: 've', colombia: 'co' };

// ---------- CSV ----------
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
function toObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).filter(r => r.some(c => c.trim() !== ''))
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
const truthy = v => ['si', 'sí', 'true', '1', 'x', 'activo', 'yes'].includes(String(v || '').trim().toLowerCase());
const hoyVE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); // YYYY-MM-DD

// ---------- dibujar frame (contain sobre fondo negro) ----------
async function drawFrame(ctx, W, H, url) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const img = await loadImage(buf);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const s = Math.min(W / img.width, H / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

async function buildGif(frames, W, H, outPath) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();
  const delay = Math.max(1, DURATION_SEC) * 1000;

  let written = 0;
  for (const url of frames) {
    try {
      await drawFrame(ctx, W, H, url);
      const { data } = ctx.getImageData(0, 0, W, H);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, W, H, { palette, delay });
      written++;
    } catch (e) { console.warn('  ⚠️  imagen omitida (no cargó):', url, e.message); }
  }
  if (written === 0) { // sin artes: 1 frame negro para que la URL siga viva
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay });
  }
  gif.finish();
  await writeFile(outPath, gif.bytes());
  console.log(`  ✅ ${outPath}  (${written} artes, ${(gif.bytes().length/1024).toFixed(0)} KB)`);
}

// ---------- main ----------
const csv = await (await fetch(SHEET_CSV_URL, { headers: { 'cache-control': 'no-cache' } })).text();
const hoy = hoyVE();
const activos = toObjects(parseCSV(csv)).filter(r =>
  truthy(r.activo) &&
  (!r.inicio || hoy >= r.inicio) &&
  (!r.fin || hoy <= r.fin)
).sort((a, b) => (parseFloat(a.orden) || 9999) - (parseFloat(b.orden) || 9999));

console.log(`Hoy (VE): ${hoy} — ${activos.length} arte(s) activo(s)`);

// agrupar por pais+medida
const grupos = {}; // tag -> {w,h,frames[]}
for (const r of activos) {
  const code = CODIGO[String(r.pais || '').trim().toLowerCase()] || 've';
  for (const [k, m] of Object.entries(MEDIDAS)) {
    const url = r[m.col];
    if (!url) continue;
    const tag = `sc_${code}_${k}`;
    (grupos[tag] ||= { w: m.w, h: m.h, frames: [] }).frames.push(url);
  }
}

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/_headers`, '/*.gif\n  Cache-Control: no-cache, max-age=0, must-revalidate\n');
if (Object.keys(grupos).length === 0) console.log('Sin artes activos hoy; no se genera nada nuevo.');
for (const [tag, g] of Object.entries(grupos)) {
  console.log(`GIF ${tag} (${g.w}x${g.h}):`);
  await buildGif(g.frames, g.w, g.h, `${OUT}/${tag}.gif`);
}
console.log('Listo.');
