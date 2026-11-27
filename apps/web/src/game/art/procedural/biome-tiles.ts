// Ground tiles and wall textures of the eight biomes. A tile is 64x64 and is drawn around the origin the caller sets (and clipped
// to it). Every tile must sit next to any other tile of its biome, in any order, with no visible seam: the base is a field of
// 4px cells that does not depend on neighbors, details keep away from the edge or are drawn again 64px over (`wrap`), and any
// line that runs across the whole tile sits at the same place in every variant and repeats every 16 or 32px.
import { box, dot, hash32, oval, poly, rgba, span, stroke, unit, type Ctx, type Pt } from './draw';

export const TILE = 64;
export interface BiomePaint {
  base: string; speck: [string, string];
  /** Details on top of the base. `v` is the variant 0..5. */
  detail(ctx: Ctx, v: number): void;
  wall(ctx: Ctx): void;
}

/** Runs `fn` at (x, y) and again 64px over when it is near an edge, so that a feature leaving one side comes in on the other. */
function wrap(x: number, y: number, fn: (x: number, y: number) => void): void {
  const xs = x < 14 ? [x, x + TILE] : x > TILE - 14 ? [x, x - TILE] : [x];
  const ys = y < 14 ? [y, y + TILE] : y > TILE - 14 ? [y, y - TILE] : [y];
  for (const px of xs) for (const py of ys) fn(px, py);
}
/** `n` random positions for variant `v` (the same every run). */
const spots = (v: number, n: number, seed: number): Pt[] => Array.from({ length: n }, (_, i): Pt => [span(2, 61, v, i, seed), span(2, 61, v, i, seed + 100)]);
/** A jagged line from (x, y) that wanders (a crack). */
function crack(ctx: Ctx, x: number, y: number, v: number, seed: number, color: string, steps = 5, w = 1): void {
  const pts: Pt[] = [[x, y]];
  for (let i = 0; i < steps; i += 1) { const [px, py] = pts[i] ?? [x, y]; pts.push([px + span(-7, 7, v, i, seed), py + span(2, 8, v, i, seed + 5) * (unit(v, seed) < 0.5 ? 1 : -1)]); }
  stroke(ctx, pts, w, color, 0);
}

/** The field of 4px cells every ground starts with; `v` changes it a little. */
export function groundBase(ctx: Ctx, p: BiomePaint, v: number, seed: number): void {
  dot(ctx, 0, 0, TILE, TILE, p.base);
  for (let cy = 0; cy < 16; cy += 1) for (let cx = 0; cx < 16; cx += 1) {
    const h = hash32(cx, cy, v * 31 + seed);
    if (h % 5 === 0) dot(ctx, cx * 4, cy * 4, 4, 4, p.speck[0]);
    else if (h % 7 === 0) dot(ctx, cx * 4, cy * 4, 4, 4, p.speck[1]);
    else if (h % 13 === 0) dot(ctx, cx * 4 + 1, cy * 4 + 1, 2, 2, p.speck[1]);
  }
  for (let i = 0; i < 2; i += 1) { // big soft blotches, wrapped
    const x = span(0, 63, v, i, seed + 7); const y = span(0, 63, v, i, seed + 8);
    wrap(x, y, (px, py) => { ctx.fillStyle = rgba(i ? p.speck[1] : p.speck[0], 0.22); ctx.beginPath(); ctx.ellipse(px, py, 14, 9, unit(v, i) * 3, 0, Math.PI * 2); ctx.fill(); });
  }
}

/** Rows of bricks or blocks: `bw` x `bh`, every second row shifted by half; 64 is a multiple of both so the texture tiles. */
function bricks(ctx: Ctx, bw: number, bh: number, mortar: string, tones: string[], hi: string, lo: string, seed: number): void {
  dot(ctx, 0, 0, TILE, TILE, mortar);
  for (let r = 0; r < TILE / bh; r += 1) {
    for (let k = -1; k < TILE / bw; k += 1) {
      const x = k * bw + (r % 2) * (bw / 2); const h = hash32(r, k + 4, seed);
      dot(ctx, x + 1, r * bh + 1, bw - 1, bh - 1, tones[h % tones.length] ?? mortar);
      dot(ctx, x + 1, r * bh + 1, bw - 1, 1, hi); dot(ctx, x + 1, r * bh + bh - 1, bw - 1, 1, lo); // light top edge, dark bottom edge
      if (h % 5 === 0) dot(ctx, x + 3 + (h % 9), r * bh + 4, 3, 2, lo);
    }
  }
}

const crackStroke = (ctx: Ctx, v: number, color: string, count = 1): void => { for (let i = 0; i < count; i += 1) crack(ctx, span(10, 52, v, i, 3), span(6, 30, v, i, 4), v, i + 1, color, 5, 1); };

// --- the eight biomes ---------------------------------------------------------------------------------------------------------
export const BIOME_PAINT: Record<string, BiomePaint> = {
  'zombie-city': {
    base: '#3a3d44', speck: ['#2f3238', '#4a4e56'],
    detail(ctx, v) {
      crackStroke(ctx, v, '#16181c', v % 3 === 0 ? 2 : 1);
      if (v === 2) for (let x = 0; x < TILE; x += 16) dot(ctx, x, 31, 10, 2, '#b8a23a'); // faded lane marking
      for (const [x, y] of spots(v, 3, 11)) { dot(ctx, x + 1, y + 1, 4, 3, '#1c1e22'); dot(ctx, x, y, 4, 3, '#6a6e76'); dot(ctx, x, y, 4, 1, '#8a8e96'); }
    },
    wall: (ctx) => bricks(ctx, 32, 16, '#2c2224', ['#7a4a3a', '#6e4234', '#85523f', '#5f3a30'], '#a8715a', '#3e2822', 1),
  },
  'alien-lab': {
    base: '#27343f', speck: ['#202b34', '#31404c'],
    detail(ctx, v) {
      for (const o of [0, 32]) { // seams between 32px plates: a dark line and a light line, the same in every variant
        dot(ctx, 0, o + 31, TILE, 1, '#141b22'); dot(ctx, 0, (o + 32) % TILE, TILE, 1, '#3d4f5e');
        dot(ctx, o + 31, 0, 1, TILE, '#141b22'); dot(ctx, (o + 32) % TILE, 0, 1, TILE, '#3d4f5e');
      }
      for (const [x, y] of [[5, 5], [26, 5], [5, 26], [26, 26], [37, 5], [58, 5], [37, 26], [58, 26], [5, 37], [26, 37], [5, 58], [26, 58], [37, 37], [58, 37], [37, 58], [58, 58]] as Pt[]) dot(ctx, x, y, 2, 2, '#4d5f6e');
      if (v % 2 === 1) { const x = span(4, 14, v, 1, 5) + (v > 2 ? 32 : 0); box(ctx, x, 30, 14, 3, '#1fb6d6', 0); dot(ctx, x + 2, 31, 10, 1, '#b8f6ff'); dot(ctx, x - 1, 29, 16, 1, 'rgba(61,224,255,0.3)'); } // a glowing seam
      if (v >= 2 && v % 2 === 0) { const y = span(4, 14, v, 2, 6) + (v > 2 ? 32 : 0); box(ctx, 30, y, 3, 14, '#1fb6d6', 0); dot(ctx, 31, y + 2, 1, 10, '#b8f6ff'); }
      if (v === 4) { box(ctx, 10, 10, 12, 10, '#18222b', 0); for (let i = 0; i < 4; i += 1) dot(ctx, 11, 11 + i * 2 + i, 10, 1, '#3b4b59'); }
    },
    wall(ctx) {
      dot(ctx, 0, 0, TILE, TILE, '#3b4d5c');
      for (const y of [0, 32]) { dot(ctx, 0, y, TILE, 1, '#7a93a8'); dot(ctx, 0, y + 1, TILE, 2, '#4d6578'); dot(ctx, 0, y + 30, TILE, 2, '#26333e'); }
      for (const x of [0, 32]) { dot(ctx, x, 0, 1, TILE, '#26333e'); dot(ctx, x + 1, 0, 1, TILE, '#4d6578'); }
      for (const [x, y] of [[5, 6], [26, 6], [5, 38], [26, 38], [37, 6], [58, 6], [37, 38], [58, 38]] as Pt[]) dot(ctx, x, y, 2, 2, '#9db3c6');
      box(ctx, 8, 16, 48, 3, '#1fb6d6', 0); dot(ctx, 10, 17, 44, 1, '#b8f6ff'); // glowing strip
      dot(ctx, 8, 14, 48, 1, 'rgba(61,224,255,0.25)'); dot(ctx, 8, 19, 48, 1, 'rgba(61,224,255,0.25)');
    },
  },
  'dark-forest': {
    base: '#1d3320', speck: ['#162a1a', '#274a2b'],
    detail(ctx, v) {
      for (const [x, y] of spots(v, 7, 21)) wrap(x, y, (px, py) => {
        const t = hash32(x, y, v) % 2 ? '#3f7a3a' : '#2d5a2d';
        stroke(ctx, [[px - 2, py - 3], [px, py]], 1, t, 0); stroke(ctx, [[px, py - 4], [px, py]], 1, t, 0); stroke(ctx, [[px + 2, py - 3], [px, py]], 1, t, 0);
      });
      for (const [i, [x, y]] of spots(v, 3, 22).entries()) wrap(x, y, (px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(unit(v, i, 9) * 3); oval(ctx, 0, 0, 3, 1.8, ['#8a5a22', '#a8741f', '#6b4018'][i % 3] ?? '#8a5a22', 0); ctx.restore();
      });
    },
    wall(ctx) {
      dot(ctx, 0, 0, TILE, TILE, '#12281a');
      for (let i = 0; i < 28; i += 1) {
        const x = span(0, 63, i, 3); const y = span(0, 63, i, 4); const r = span(5, 9, i, 5);
        wrap(x, y, (px, py) => { ctx.fillStyle = ['#1b3d24', '#24502d', '#2f6637', '#173320'][i % 4] ?? '#1b3d24'; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); });
      }
      for (let i = 0; i < 16; i += 1) { const x = span(0, 63, i, 8); const y = span(0, 63, i, 9); wrap(x, y, (px, py) => { dot(ctx, px, py, 3, 2, '#4f9a52'); dot(ctx, px + 1, py - 1, 2, 1, '#7fcf78'); }); }
      for (let x = 0; x < TILE; x += 16) dot(ctx, x, 0, 8, 1, 'rgba(160,230,150,0.35)'); // light top edge, repeats
    },
  },
  'desert-ruins': {
    base: '#d4b56e', speck: ['#c4a35c', '#e2c887'],
    detail(ctx, v) {
      for (let i = 0; i < 3; i += 1) { const x = span(8, 48, v, i, 31); const y = span(8, 56, v, i, 32); stroke(ctx, [[x, y], [x + 4, y - 1], [x + 9, y + 1], [x + 14, y]], 1, '#b8964a', 0); dot(ctx, x + 1, y + 2, 12, 1, '#e8d298'); }
      for (const [x, y] of spots(v, 4, 33)) { dot(ctx, x + 1, y + 1, 3, 2, '#9a7b3c'); dot(ctx, x, y, 3, 2, '#a38442'); }
      if (v % 3 === 1) { const x = span(14, 40, v, 7, 34); const y = span(14, 40, v, 8, 34); poly(ctx, [[x, y + 2], [x + 3, y - 3], [x + 9, y - 3], [x + 12, y + 2], [x + 8, y + 6], [x + 2, y + 6]], '#a89878', 0); dot(ctx, x + 3, y - 3, 6, 1, '#cfc2a0'); dot(ctx, x + 2, y + 6, 7, 1, '#7a6c50'); }
    },
    wall: (ctx) => bricks(ctx, 32, 16, '#8f7340', ['#c9a566', '#bd9a5c', '#d3b074', '#b08f52'], '#e8d29a', '#8a6c3a', 2),
  },
  'ice-base': {
    base: '#a7d3e6', speck: ['#95c4da', '#bfe3f1'],
    detail(ctx, v) {
      crackStroke(ctx, v, '#eaf8ff', v % 2 === 0 ? 2 : 1);
      for (const [i, [x, y]] of spots(v, 2, 41).entries()) wrap(x, y, (px, py) => { ctx.fillStyle = rgba('#f4fcff', 0.9); ctx.beginPath(); ctx.ellipse(px, py, 7 + i * 3 + (v % 3), 4 + (v % 2) * 2, unit(v, i, 2) * 3, 0, Math.PI * 2); ctx.fill(); });
      for (const [x, y] of spots(v, 3, 42)) { dot(ctx, x, y - 1, 1, 3, '#ffffff'); dot(ctx, x - 1, y, 3, 1, '#ffffff'); }
    },
    wall: (ctx) => bricks(ctx, 32, 32, '#5f93ad', ['#bfe3f1', '#add7ea', '#c9ecf8', '#a0cfe4'], '#ffffff', '#6aa3bf', 3),
  },
  'neon-arena': {
    base: '#0b0b1e', speck: ['#0e0e26', '#13132f'],
    detail(ctx, v) {
      dot(ctx, 0, 30, TILE, 1, '#1c1650'); dot(ctx, 31, 0, 1, TILE, '#1c1650'); // dim half grid
      dot(ctx, 0, 0, TILE, 4, 'rgba(25,198,230,0.16)'); dot(ctx, 0, 0, 4, TILE, 'rgba(25,198,230,0.16)'); // glow around the lines
      dot(ctx, 0, 0, TILE, 2, '#19c6e6'); dot(ctx, 0, 0, 2, TILE, '#19c6e6'); // the grid lines, on the top and left edge of every tile
      dot(ctx, 0, 0, 4, 4, '#aaf4ff');
      if (v % 2 === 1) { const a = span(10, 40, v, 1, 51); stroke(ctx, [[a, 56], [a + 20, 36]], 2, 'rgba(255,60,200,0.18)', 0); }
      if (v === 3) { ctx.fillStyle = 'rgba(255,60,200,0.16)'; ctx.beginPath(); ctx.arc(32, 32, 12, 0, Math.PI * 2); ctx.fill(); dot(ctx, 30, 30, 4, 4, '#ff6adf'); }
      if (v === 5) for (let i = 0; i < 3; i += 1) dot(ctx, 10 + i * 6, 44, 3, 3, '#7a4dff');
    },
    wall(ctx) {
      dot(ctx, 0, 0, TILE, TILE, '#17123a');
      for (const x of [0, 32]) { dot(ctx, x, 0, 1, TILE, '#0b0820'); dot(ctx, x + 1, 0, 1, TILE, '#2b2266'); }
      dot(ctx, 0, 0, TILE, 4, 'rgba(255,60,200,0.2)'); dot(ctx, 0, 0, TILE, 2, '#ff4fd8'); dot(ctx, 0, 2, TILE, 1, '#ffd0f4'); // neon top edge
      dot(ctx, 0, 32, TILE, 1, '#0b0820'); dot(ctx, 0, 33, TILE, 1, '#2b2266');
      for (let x = 4; x < TILE; x += 16) { poly(ctx, [[x, 44], [x + 4, 48], [x, 52]], '#19c6e6', 0); }
    },
  },
  hospital: {
    base: '#d9e5e8', speck: ['#cddbdf', '#e6f0f2'],
    detail(ctx, v) {
      for (const o of [0, 32]) { dot(ctx, 0, o, TILE, 1, '#a9bcc3'); dot(ctx, 0, o + 1, TILE, 1, '#f3f9fa'); dot(ctx, o, 0, 1, TILE, '#a9bcc3'); dot(ctx, o + 1, 0, 1, TILE, '#f3f9fa'); }
      if (v === 1 || v === 4) { const x = span(14, 48, v, 1, 61); const y = span(14, 48, v, 2, 61); ctx.fillStyle = rgba(v === 1 ? '#8c3b3b' : '#b89a6a', 0.32); ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0.6, 0, Math.PI * 2); ctx.fill(); disc2(ctx, x + 6, y + 5, v === 1 ? '#8c3b3b' : '#b89a6a'); }
      if (v === 2) { ctx.fillStyle = 'rgba(160,220,200,0.2)'; ctx.fillRect(0, 0, TILE, TILE); }
      if (v === 3) crack(ctx, 40, 8, v, 2, '#9aaeb6', 3, 1);
      for (const [x, y] of spots(v, 2, 62)) stroke(ctx, [[x, y], [x + 7, y - 2]], 1, 'rgba(120,140,150,0.35)', 0);
    },
    wall(ctx) {
      dot(ctx, 0, 0, TILE, TILE, '#c9dcd8');
      for (const x of [0, 32]) { dot(ctx, x, 0, 1, TILE, '#98b0aa'); dot(ctx, x + 1, 0, 1, TILE, '#eef7f5'); }
      dot(ctx, 0, 0, TILE, 2, '#f4fbf9'); dot(ctx, 0, 2, TILE, 1, '#a9c2bc'); // light top edge
      dot(ctx, 0, 40, TILE, 6, '#7fb7a8'); dot(ctx, 0, 40, TILE, 1, '#a8d6c9'); dot(ctx, 0, 45, TILE, 1, '#5e9486'); // green dado band
      dot(ctx, 0, 32, TILE, 1, '#98b0aa');
    },
  },
  'military-base': {
    base: '#6f7660', speck: ['#636a55', '#7b836b'],
    detail(ctx, v) {
      dot(ctx, 0, 0, TILE, 1, '#40463a'); dot(ctx, 0, 1, TILE, 1, '#868e75'); dot(ctx, 0, 0, 1, TILE, '#40463a'); dot(ctx, 1, 0, 1, TILE, '#868e75'); // slab joints
      for (const [x, y] of [[4, 4], [58, 4], [4, 58], [58, 58]] as Pt[]) dot(ctx, x, y, 2, 2, '#4a5040');
      if (v === 2) { dot(ctx, 0, 22, TILE, 3, 'rgba(30,34,26,0.4)'); dot(ctx, 0, 30, TILE, 3, 'rgba(30,34,26,0.4)'); } // tire tracks
      if (v === 3 || v === 5) { const x = span(14, 48, v, 1, 71); const y = span(14, 48, v, 2, 71); ctx.fillStyle = 'rgba(20,22,16,0.4)'; ctx.beginPath(); ctx.ellipse(x, y, 8, 5, 0.5, 0, Math.PI * 2); ctx.fill(); }
      if (v === 1) crack(ctx, 22, 10, v, 4, '#3a4032', 4, 1);
      if (v === 4) for (let x = 8; x < 56; x += 16) dot(ctx, x, 30, 8, 2, '#c9b23a'); // painted dashes
    },
    wall(ctx) {
      dot(ctx, 0, 0, TILE, TILE, '#5d6450');
      for (const y of [0, 32]) { dot(ctx, 0, y, TILE, 1, '#8c9478'); dot(ctx, 0, y + 1, TILE, 1, '#707860'); dot(ctx, 0, y + 31, TILE, 1, '#3f4536'); }
      dot(ctx, 31, 0, 1, TILE, '#3f4536');
      for (let x = -16; x < TILE; x += 16) poly(ctx, [[x, 44], [x + 8, 44], [x + 16, 56], [x + 8, 56]], '#d6b92e', 0); // hazard stripes
      dot(ctx, 0, 43, TILE, 1, '#2c3024'); dot(ctx, 0, 56, TILE, 1, '#2c3024');
      for (const [x, y] of [[5, 8], [26, 8], [37, 8], [58, 8]] as Pt[]) dot(ctx, x, y, 2, 2, '#9aa285');
    },
  },
};

/** A small round drop (a stain's spot). */
function disc2(ctx: Ctx, x: number, y: number, color: string): void { ctx.fillStyle = rgba(color, 0.4); ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
