// Makes the one PNG art pack that is in the repo, only to try the way pictures travel (page -> data URL -> game iframe): hero/grunt-test.
// Plain Node, no library: the PNG is written by hand (zlib is part of Node). Run from apps/web:
//
//   node scripts/make-test-art.mjs
//
// It writes public/art/hero/grunt-test/{sheet.png,manifest.json} and makes sure public/art/index.json lists the pack.
// The picture is a round soldier with a helmet, seen from above, facing +x (right), 48 x 48 per frame, 8 frames in one row:
// 0 idle, 1-4 move, 5 shoot, 6 hit, 7 die. Its license is "procedural": made by this script.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art');
const FRAME = 48;
const FRAMES = 8;
const width = FRAME * FRAMES;
const height = FRAME;
const pixels = new Uint8Array(width * height * 4); // RGBA, transparent

function put(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  // simple "over" blend onto what is there
  const sa = a / 255;
  const da = pixels[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  pixels[i] = Math.round((r * sa + pixels[i] * da * (1 - sa)) / oa);
  pixels[i + 1] = Math.round((g * sa + pixels[i + 1] * da * (1 - sa)) / oa);
  pixels[i + 2] = Math.round((b * sa + pixels[i + 2] * da * (1 - sa)) / oa);
  pixels[i + 3] = Math.round(oa * 255);
}
const disc = (frame, cx, cy, rx, ry, c) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) put(frame * FRAME + x, y, c);
    }
  }
};
const rect = (frame, x, y, w, h, c) => { for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) put(frame * FRAME + x + i, y + j, c); };

const OUT = [11, 18, 32, 255];
const SKIN = [236, 188, 140, 255];
const SUIT = [74, 124, 89, 255];
const SUIT_DARK = [48, 84, 60, 255];
const HELMET = [101, 142, 78, 255];
const WHITE = [255, 255, 255, 255];

function soldier(frame, { bob = 0, step = 0, squash = 1, flash = 0, lean = 0 }) {
  const cx = 24 + lean;
  const cy = 24 + bob;
  disc(frame, cx - 1, cy + 5, 13 * squash, 6 * squash, [0, 0, 0, 70]); // shadow
  // two feet that swap as the soldier steps
  rect(frame, cx - 9, cy - 11 - step, 6, 5, OUT); rect(frame, cx - 8, cy - 10 - step, 4, 3, SUIT_DARK);
  rect(frame, cx - 9, cy + 7 + step, 6, 5, OUT); rect(frame, cx - 8, cy + 8 + step, 4, 3, SUIT_DARK);
  disc(frame, cx, cy, 14 * squash, 14 * squash, OUT); // outline
  disc(frame, cx, cy, 12.5 * squash, 12.5 * squash, SUIT); // body
  disc(frame, cx - 3, cy, 7 * squash, 9 * squash, SUIT_DARK); // back pack
  disc(frame, cx + 3, cy, 6.5 * squash, 6.5 * squash, HELMET); // helmet
  rect(frame, cx + 9, cy - 2, 4, 4, SKIN); // the face looks to +x
  rect(frame, cx + 10, cy - 1, 1, 1, OUT);
  rect(frame, cx + 6, cy - 12, 5, 3, SKIN); // hands, forward
  rect(frame, cx + 6, cy + 9, 5, 3, SKIN);
  if (flash > 0) disc(frame, cx, cy, 13 * squash, 13 * squash, [255, 255, 255, flash]);
}

soldier(0, { bob: 0 }); // idle
soldier(1, { step: 3 }); soldier(2, { step: 0, bob: 1 }); soldier(3, { step: -3 }); soldier(4, { step: 0, bob: 1 }); // move
soldier(5, { lean: -2 }); // shoot: a recoil, shifted back
soldier(6, { flash: 190 }); // hit: a white flash
soldier(7, { squash: 0.55, flash: 40 }); // die: a flat lump
disc(7, 24, 24, 6, 6, [200, 60, 60, 160]);
rect(7, 30, 18, 3, 3, WHITE);

// --- PNG (8-bit RGBA, no interlace): signature, IHDR, one IDAT of filtered scanlines, IEND ---
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
const raw = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y += 1) {
  raw[y * (width * 4 + 1)] = 0; // filter: none
  Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
}
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

const manifest = {
  version: 1, kind: 'hero', id: 'grunt-test', source: 'png', license: 'procedural', author: '', origin: 'apps/web/scripts/make-test-art.mjs',
  sheet: 'sheet.png', frame: { w: FRAME, h: FRAME }, columns: FRAMES,
  body: { radius: 14 }, anchor: { x: 0.5, y: 0.5 },
  animations: {
    idle: { frames: [0], fps: 1, loop: true },
    move: { frames: [1, 2, 3, 4], fps: 10, loop: true },
    shoot: { frames: [5, 0], fps: 14, loop: false },
    hit: { frames: [6], fps: 10, loop: false },
    die: { frames: [7], fps: 6, loop: false },
  },
};

const folder = join(root, 'hero', 'grunt-test');
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'sheet.png'), png);
writeFileSync(join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const indexPath = join(root, 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
if (!index.some((entry) => entry.kind === 'hero' && entry.id === 'grunt-test')) index.push({ kind: 'hero', id: 'grunt-test' });
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${folder} (${png.length} bytes) and ${indexPath}`);
