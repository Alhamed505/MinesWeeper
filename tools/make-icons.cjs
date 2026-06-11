/* ============================================================
 * make-icons.js — generate the PWA / iOS app icons with no
 * external dependencies.
 *
 * Renders a reactor-mine glyph (glowing core + spikes inside a
 * neon hex ring on a dark gradient) at each target size with 2x
 * supersampling for clean edges, then encodes a PNG by hand
 * (zlib for IDAT + manual chunk/CRC framing).
 *
 * Run: node tools/make-icons.js
 * ============================================================ */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ----------------------------- math helpers ----------------------------- */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;

function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
const CYAN = hex('#2ee6d6');
const BLUE = hex('#4fd8ff');
const LIGHT = hex('#e8f4f8');
const TOP = hex('#0c2433');
const BOT = hex('#04090d');

/** distance from point p to segment a-b */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** signed distance to a regular hexagon (flat-top), radius r, centered origin */
function hexDist(px, py, r) {
  // fold into one sextant using abs + rotation symmetry approximation:
  // use the standard hexagon SDF (pointy via swapped axes)
  const k = [-0.866025404, 0.5, 0.577350269];
  let x = Math.abs(px), y = Math.abs(py);
  const dot = 2 * Math.min(k[0] * x + k[1] * y, 0);
  x -= dot * k[0];
  y -= dot * k[1];
  const clampedX = clamp(x, -k[2] * r, k[2] * r);
  const len = Math.hypot(x - clampedX, y - r);
  return len * Math.sign(y - r);
}

/* ----------------------------- the icon ----------------------------- */
/**
 * Compute the RGB color (0..255) for a normalized coordinate where the
 * icon spans [0,1]x[0,1]. Layers are composited with additive glows.
 */
function shade(nx, ny) {
  // center-origin coords in [-0.5, 0.5]
  const x = nx - 0.5, y = ny - 0.5;
  const r = Math.hypot(x, y);

  // 1) background vertical gradient
  let col = [mix(TOP[0], BOT[0], ny), mix(TOP[1], BOT[1], ny), mix(TOP[2], BOT[2], ny)];

  // 2) radial core glow (cyan), centered slightly high
  const glow = Math.exp(-Math.pow((Math.hypot(x, y + 0.02)) / 0.34, 2));
  col[0] += CYAN[0] * 0.22 * glow;
  col[1] += CYAN[1] * 0.22 * glow;
  col[2] += CYAN[2] * 0.22 * glow;

  // 3) neon hex ring at radius ~0.40, thickness ~0.022
  const hd = Math.abs(hexDist(x, y, 0.40)) ;
  const ringCore = clamp(1 - hd / 0.018, 0, 1);
  const ringGlow = Math.exp(-Math.pow(hd / 0.05, 2));
  for (let i = 0; i < 3; i++) {
    col[i] = mix(col[i], BLUE[i], ringCore * 0.95);
    col[i] += BLUE[i] * 0.5 * ringGlow * (1 - ringCore);
  }

  // 4) mine spikes — 8 directions, from r=0.16 to r=0.30
  let spike = 0;
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k;
    const ax = Math.cos(a) * 0.15, ay = Math.sin(a) * 0.15;
    const bx = Math.cos(a) * 0.31, by = Math.sin(a) * 0.31;
    const d = distSeg(x, y, ax, ay, bx, by);
    spike = Math.max(spike, clamp(1 - d / 0.026, 0, 1));
  }
  // spike glow + body
  const spikeGlow = spike;
  for (let i = 0; i < 3; i++) col[i] += CYAN[i] * 0.35 * spikeGlow;

  // 5) mine core disc r=0.17 with soft edge + cyan rim glow
  const discEdge = clamp((0.17 - r) / 0.02, 0, 1);          // 1 inside
  const discGlow = Math.exp(-Math.pow((r - 0.17) / 0.06, 2)); // halo
  for (let i = 0; i < 3; i++) {
    col[i] += CYAN[i] * 0.4 * discGlow * (1 - discEdge);
    col[i] = mix(col[i], LIGHT[i], discEdge);
  }

  // 6) glint on the core
  const gd = Math.hypot(x + 0.055, y + 0.055);
  col[0] = mix(col[0], 255, clamp(1 - gd / 0.045, 0, 1) * discEdge);
  col[1] = mix(col[1], 255, clamp(1 - gd / 0.045, 0, 1) * discEdge);
  col[2] = mix(col[2], 255, clamp(1 - gd / 0.045, 0, 1) * discEdge);

  return [clamp(col[0], 0, 255), clamp(col[1], 0, 255), clamp(col[2], 0, 255)];
}

/** Render an opaque RGBA buffer at `size`, supersampled `ss`x. */
function render(size, ss) {
  ss = ss || 2;
  const big = size * ss;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x * ss + sx + 0.5) / big;
          const ny = (y * ss + sy + 0.5) / big;
          const c = shade(nx, ny);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/* ----------------------------- PNG encoder ----------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ----------------------------- main ----------------------------- */
const outDir = path.join(__dirname, '..', 'assets');
const targets = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512]
];
for (const [name, size] of targets) {
  const png = encodePNG(render(size, 3), size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log('wrote', name, size + 'x' + size, png.length + ' bytes');
}
console.log('done');
