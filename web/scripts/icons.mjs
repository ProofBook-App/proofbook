// Draws the PWA and home-screen icons from the brand mark (the favicon's brass dots on night)
// and rasterises them with rsvg-convert (`brew install librsvg`). Run from web/: `node scripts/icons.mjs`.
// The PNGs are committed, so this only needs to run again if the mark changes.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NIGHT = "#141a26";
const BRASS = "#d8c27a";

// Same steps as Mark in app/components/halftone.tsx: four columns, 1, 2, 2 and 4 dots high.
const HEIGHTS = [1, 2, 2, 4];

// `mark` is the width of the dot block as a share of the icon. `radius` rounds the ground's
// corners (0 for icons the OS masks itself: maskable and apple-touch).
function svg(size, { mark, radius }) {
  const pitch = (size * mark) / 3.83; // 3 gaps plus one dot's width, as in the favicon
  const r = pitch * 0.41;
  const left = (size - pitch * 3) / 2;
  const bottom = (size + pitch * 3) / 2;
  const dots = HEIGHTS.flatMap((h, c) =>
    Array.from({ length: h }, (_, i) => `<circle cx="${left + c * pitch}" cy="${bottom - i * pitch}" r="${r}"/>`),
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${size * radius}" fill="${NIGHT}"/><g fill="${BRASS}">${dots}</g></svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, mark: 0.64, radius: 0.22 },
  { file: "icon-512.png", size: 512, mark: 0.64, radius: 0.22 },
  // Maskable: the OS may crop to a circle 80% wide, so the mark sits well inside it.
  { file: "icon-maskable-512.png", size: 512, mark: 0.5, radius: 0 },
  // iOS rounds the corners itself and shows transparency as black.
  { file: "apple-touch-icon.png", size: 180, mark: 0.6, radius: 0 },
];

const tmp = mkdtempSync(join(tmpdir(), "proofbook-icons-"));
for (const icon of ICONS) {
  const src = join(tmp, `${icon.file}.svg`);
  writeFileSync(src, svg(icon.size, icon));
  execFileSync("rsvg-convert", ["-w", String(icon.size), "-h", String(icon.size), "-o", join("public", icon.file), src]);
  console.log(`public/${icon.file}`);
}
