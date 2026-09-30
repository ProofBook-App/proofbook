// Renders the social preview cards to public/ with headless Chrome.
// Run after changing scripts/og/card.html or the copy below: `pnpm og`
// (needs Google Chrome installed, or set CHROME to its binary).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(resolve(here, "card.html"), "utf8");
const out = resolve(here, "../../public");

const CARDS = [
  {
    file: "og.png",
    chip: "Waitlist open. Launching on Monad.",
    h1: "AI trading agents<br><em>Proven in public</em>",
    sub: "Rules enforced onchain",
    seed: 11,
  },
  {
    file: "og-builders.png",
    chip: "For builders. The arena is opening soon.",
    h1: "Build the agent<br><em>Prove the agent</em>",
    sub: "A public track record for your trading agent",
    seed: 17,
  },
];

// Same "climb" path as app/components/halftone.tsx.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function halftone(seed, W = 960, H = 560, step = 11) {
  const cols = Math.floor(W / step);
  const rows = Math.floor(H / step);
  const rand = rng(seed);
  const raw = [];
  let v = 0;
  for (let i = 0; i < cols; i++) {
    v += (rand() - 0.5) * 2.4 + Math.sin(i * 0.45) * 0.6 + 0.34;
    raw.push(v);
  }
  const sm = raw.map((_, i) => {
    let t = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      if (raw[i + k] !== undefined) {
        t += raw[i + k];
        n++;
      }
    }
    return t / n;
  });
  const lo = Math.min(...sm);
  const hi = Math.max(...sm);
  const top = rows * 0.12;
  const bot = rows * 0.78;
  const line = sm.map((x) => bot - ((x - lo) / (hi - lo)) * (bot - top));
  const max = step * 0.46;
  const jitter = rng(seed * 31 + 3);
  const dot = (x, y, r) => `M${(x - r).toFixed(1)} ${y}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
  let body = "";
  let crest = "";
  for (let i = 0; i < cols; i++) {
    const fade = Math.min(1, i / (cols * 0.45));
    const x = i * step + step / 2;
    for (let r = 0; r < rows; r++) {
      const y = r * step + step / 2;
      const d = r - line[i];
      const j = 0.85 + jitter() * 0.3;
      if (d < -0.6) continue;
      if (d < 0.6) {
        crest += dot(x, y, max * fade);
        continue;
      }
      const rad = max * Math.max(0.12, 1 - d / (rows * 0.75)) * j * fade;
      if (rad > 0.35) body += dot(x, y, rad);
    }
  }
  return `<path d="${body}" fill="#3b4a68"/><path d="${crest}" fill="#aab6cc"/>`;
}

const chrome =
  process.env.CHROME ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
    existsSync,
  );
if (!chrome) throw new Error("Chrome not found. Set CHROME to the browser binary.");

for (const c of CARDS) {
  const html = template
    .replace("{{chart}}", halftone(c.seed))
    .replace("{{chip}}", c.chip)
    .replace("{{h1}}", c.h1)
    .replace("{{sub}}", c.sub);
  // Written next to the template so the relative font paths resolve.
  const tmp = resolve(here, `.render-${c.file}.html`);
  writeFileSync(tmp, html);
  try {
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        "--force-device-scale-factor=1",
        "--window-size=1200,630",
        "--virtual-time-budget=4000",
        `--screenshot=${resolve(out, c.file)}`,
        pathToFileURL(tmp).href,
      ],
      { stdio: "ignore" },
    );
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`wrote public/${c.file}`);
}
