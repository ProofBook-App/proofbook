// Halftone price charts, drawn as dots on a grid the way agora.finance prints its photos.
// "climb": a noisy price path that trends up. "freeze": a path that falls to a floor
// and goes flat, which is what a vault does when it breaches its loss cap.
// Deterministic, so server and client render the same markup.

type Variant = "climb" | "freeze";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Price per column, as a row index from the top (0 = top edge).
function pricePath(variant: Variant, cols: number, rows: number, seed: number) {
  const rand = rng(seed);
  const raw: number[] = [];
  let v = 0;
  for (let c = 0; c < cols; c++) {
    const t = c / (cols - 1);
    const noise = (rand() - 0.5) * 2.4 + Math.sin(c * 0.45) * 0.6;
    if (variant === "climb") {
      v += noise + 0.34;
      raw.push(v);
    } else {
      v += noise - (t < 0.62 ? 0.3 : 0);
      raw.push(t < 0.64 ? v : NaN);
    }
  }
  // Smooth, then fit into the frame.
  const smooth = raw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const x = raw[i + k];
      if (x !== undefined && !Number.isNaN(x)) {
        sum += x;
        n++;
      }
    }
    return n ? sum / n : NaN;
  });
  const valid = smooth.filter((x) => !Number.isNaN(x));
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const top = rows * (variant === "climb" ? 0.12 : 0.18);
  const bottom = rows * (variant === "climb" ? 0.78 : 0.7);
  const fitted = smooth.map((x) => (Number.isNaN(x) ? NaN : bottom - ((x - lo) / (hi - lo)) * (bottom - top)));
  if (variant === "freeze") {
    const floor = Math.max(...fitted.filter((x) => !Number.isNaN(x)));
    return { line: fitted.map((x) => (Number.isNaN(x) ? floor : x)), floor };
  }
  return { line: fitted, floor: null };
}

const dot = (x: number, y: number, r: number) =>
  `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;

export function Halftone({
  variant = "climb",
  width = 960,
  height = 560,
  step = 11,
  seed = 7,
  fadeLeft = 0.45,
  className = "",
  bodyClass = "fill-dot",
  crestClass = "fill-mist",
  floorClass = "fill-limit",
}: {
  variant?: Variant;
  width?: number;
  height?: number;
  step?: number;
  seed?: number;
  fadeLeft?: number;
  className?: string;
  bodyClass?: string;
  crestClass?: string;
  floorClass?: string;
}) {
  const cols = Math.floor(width / step);
  const rows = Math.floor(height / step);
  const { line, floor } = pricePath(variant, cols, rows, seed);
  const max = step * 0.46;
  const rand = rng(seed * 31 + 3);

  let body = "";
  let crest = "";
  let floorDots = "";
  for (let c = 0; c < cols; c++) {
    const fade = fadeLeft > 0 ? Math.min(1, c / (cols * fadeLeft)) : 1;
    const x = c * step + step / 2;
    for (let r = 0; r < rows; r++) {
      const y = r * step + step / 2;
      const d = r - line[c];
      const jitter = 0.85 + rand() * 0.3;
      if (floor !== null && Math.abs(r - floor) < 0.5 && c % 2 === 0) {
        floorDots += dot(x, y, max * 0.5);
        continue;
      }
      if (d < -0.6) continue;
      if (d < 0.6) {
        crest += dot(x, y, max * fade);
        continue;
      }
      const depth = 1 - d / (rows * 0.75);
      const radius = max * Math.max(0.12, depth) * jitter * fade;
      if (radius > 0.35) body += dot(x, y, radius);
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden focusable="false">
      <path d={body} className={bodyClass} />
      <path d={crest} className={crestClass} />
      {floorDots && <path d={floorDots} className={floorClass} />}
    </svg>
  );
}

// The logo: four columns of dots stepping up, a halftone chart at 16px.
export function Mark({ className = "" }: { className?: string }) {
  const heights = [1, 2, 2, 4];
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden focusable="false">
      {heights.flatMap((h, c) =>
        Array.from({ length: h }, (_, i) => (
          <circle key={`${c}-${i}`} cx={2 + c * 4} cy={14 - i * 4} r={1.6} fill="currentColor" />
        )),
      )}
    </svg>
  );
}
