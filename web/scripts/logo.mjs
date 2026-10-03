// Draws the submission logo (Track 01 wants a JPG/PNG/WEBP of 3 MB or less) from the brand mark and
// the Newsreader wordmark. satori turns the wordmark into vector paths, so no system font is needed,
// and rsvg-convert rasterises the result. Run from web/: `node scripts/logo.mjs`. Writes
// docs/submission/logo-square.png (1024²) and docs/submission/logo-wide.png (2400×800).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// satori comes in with workers-og (the OG image renderer); resolve it from there.
const require = createRequire(import.meta.url);
const ogRequire = createRequire(require.resolve("workers-og"));
const satoriModule = await import(ogRequire.resolve("satori"));
const satori = satoriModule.default?.default ?? satoriModule.default ?? satoriModule.satori;

const NIGHT = "#141a26";
const BRASS = "#d8c27a";
const PAPER = "#f8f7f4";
const HEIGHTS = [1, 2, 2, 4]; // the mark: four columns of dots, as in app/components/halftone.tsx

function mark(x, y, pitch) {
  const r = pitch * 0.41;
  return HEIGHTS.flatMap((h, c) =>
    Array.from({ length: h }, (_, i) => `<circle cx="${x + c * pitch}" cy="${y - i * pitch}" r="${r}"/>`),
  ).join("");
}

async function wordmark(fontSize) {
  const font = readFileSync(require.resolve("@fontsource/newsreader/files/newsreader-latin-400-normal.woff"));
  const width = Math.round(fontSize * 4.6);
  const height = Math.round(fontSize * 1.3);
  const svg = await satori(
    { type: "div", props: { style: { display: "flex", fontFamily: "Newsreader", fontSize, color: PAPER, letterSpacing: "-0.01em" }, children: "Proofbook" } },
    { width, height, fonts: [{ name: "Newsreader", data: font, weight: 400, style: "normal" }] },
  );
  return { svg, width, height };
}

function render(file, w, h, body) {
  const tmp = mkdtempSync(join(tmpdir(), "proofbook-logo-"));
  const src = join(tmp, "logo.svg");
  writeFileSync(src, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${NIGHT}"/>${body}</svg>`);
  const out = join("..", "docs", "submission", file);
  execFileSync("rsvg-convert", ["-w", String(w), "-h", String(h), "-o", out, src]);
  console.log(out, `${(statSync(out).size / 1024).toFixed(0)} KiB`);
}

// Square: the mark alone, centred.
{
  const size = 1024;
  const pitch = (size * 0.56) / 3.83;
  render("logo-square.png", size, size, `<g fill="${BRASS}">${mark((size - pitch * 3) / 2, (size + pitch * 3) / 2, pitch)}</g>`);
}

// Wide: the mark, then the wordmark, on one baseline.
{
  const [w, h] = [2400, 800];
  const pitch = 64;
  const words = await wordmark(260);
  const markW = pitch * 3.83;
  const gap = 90;
  const left = (w - (markW + gap + words.width * 0.93)) / 2;
  const base = h / 2 + pitch * 1.6 - 18;
  // Satori puts the baseline about 0.78 of the line box down; sit it on the bottom of the lowest dots.
  const textY = base + pitch * 0.41 - words.height * 0.78 + 74;
  const inner = words.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  render(
    "logo-wide.png",
    w,
    h,
    `<g fill="${BRASS}">${mark(left + pitch * 0.41, base, pitch)}</g>` +
      `<svg x="${left + markW + gap}" y="${textY}" width="${words.width}" height="${words.height}" viewBox="0 0 ${words.width} ${words.height}">${inner}</svg>`,
  );
}
