/**
 * Reports pixel statistics for the rendered screenshots.
 *
 * There is no way to look at an image in a headless environment, so the
 * renderer is verified numerically instead: dominant colours, how much of the
 * frame is actually drawn on, the warm/cool split (which distinguishes Eimi
 * from Asch), and a silhouette bounding box.
 *
 *      npm run inspect
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface Image {
  width: number;
  height: number;
  data: Buffer;
}

/** Decodes an 8-bit truecolour PNG written by tools/softrender.ts. */
function decodePNG(file: string): Image {
  const buf = fs.readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2) throw new Error('expected 8-bit RGB PNG');
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3 + 1;
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    raw.copy(out, y * width * 3, y * stride + 1, y * stride + 1 + width * 3);
  }
  return { width, height, data: out };
}

function analyse(file: string): void {
  const { width, height, data } = decodePNG(file);
  const total = width * height;

  const counts = new Map<string, number>();
  const at = (i: number): [number, number, number] => [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!];

  for (let i = 0; i < total; i += 1) {
    const [r, g, b] = at(i);
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [dominantKey, dominantCount] = ranked[0]!;
  const [dr, dg, db] = dominantKey.split(',').map(Number) as [number, number, number];

  let warm = 0;
  let cool = 0;
  let bright = 0;
  let silhouetteMinX = Infinity;
  let silhouetteMaxX = -Infinity;
  let silhouetteMinY = Infinity;
  let silhouetteMaxY = -Infinity;
  let silhouettePixels = 0;

  for (let i = 0; i < total; i += 1) {
    const [r, g, b] = at(i);
    if (r > g && g > b && r - b > 25) warm += 1;
    else if (b >= r && g > r && b - r > 15) cool += 1;
    if (r + g + b > 480) bright += 1;

    const delta = Math.abs(r - dr) + Math.abs(g - dg) + Math.abs(b - db);
    if (delta > 60) {
      silhouettePixels += 1;
      const x = i % width;
      const y = (i - x) / width;
      if (x < silhouetteMinX) silhouetteMinX = x;
      if (x > silhouetteMaxX) silhouetteMaxX = x;
      if (y < silhouetteMinY) silhouetteMinY = y;
      if (y > silhouetteMaxY) silhouetteMaxY = y;
    }
  }

  const pct = (n: number): string => `${((n / total) * 100).toFixed(2)}%`;
  console.log(`\n${path.basename(file)}  (${width}x${height})`);
  console.log(`  dominant        rgb(${dominantKey})  ${pct(dominantCount)} of frame`);
  console.log(`  drawn on        ${pct(total - dominantCount)}`);
  console.log(`  cool / warm     ${pct(cool)} / ${pct(warm)}`);
  console.log(`  bright          ${pct(bright)}`);
  console.log(`  distinct colours ${counts.size}`);
  if (silhouettePixels > 0) {
    console.log(
      `  silhouette      ${pct(silhouettePixels)}  ` +
        `x ${silhouetteMinX}..${silhouetteMaxX} (${silhouetteMaxX - silhouetteMinX + 1}px)  ` +
        `y ${silhouetteMinY}..${silhouetteMaxY} (${silhouetteMaxY - silhouetteMinY + 1}px)`,
    );
  }
}

const dir = path.resolve(process.cwd(), 'screenshots');
if (!fs.existsSync(dir)) {
  console.error(`No screenshots directory at ${dir}. Run \`npm run screenshots\` first.`);
  process.exitCode = 1;
} else {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  if (files.length === 0) {
    console.error('No PNGs in screenshots/.');
    process.exitCode = 1;
  }
  for (const file of files) analyse(path.join(dir, file));
  console.log('');
}
