// Share-price history as a step line: the price only changes at an event (a trade, a fee), so it
// holds flat between points. Dots mark each event, in the halftone style of the rest of the site.
// Pure SVG from props, so the server and client render the same markup.

import { formatTime } from "../lib/format";

type Point = { sharePrice: string; timestamp: number };

const W = 640;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 16, left: 12 };

export function SharePriceChart({ points, className = "" }: { points: Point[]; className?: string }) {
  if (points.length < 2) {
    return (
      <div className={`grid h-[220px] place-items-center rounded-lg bg-panel text-[14px] text-muted ${className}`}>
        The chart starts after the vault's second NAV change
      </div>
    );
  }

  // Share price as a multiple of 1.0 (WAD). Float precision is plenty for drawing.
  const ys = points.map((p) => Number(BigInt(p.sharePrice) / 10n ** 10n) / 1e8);
  const t0 = points[0].timestamp;
  const t1 = points.at(-1)!.timestamp;
  let lo = Math.min(...ys, 1);
  let hi = Math.max(...ys, 1);
  const pad = Math.max((hi - lo) * 0.15, 0.0005);
  lo -= pad;
  hi += pad;

  const x = (t: number) => PAD.left + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  let d = `M${x(points[0].timestamp).toFixed(1)} ${y(ys[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += `H${x(points[i].timestamp).toFixed(1)}V${y(ys[i]).toFixed(1)}`;
  }
  const last = ys.at(-1)!;

  return (
    <figure className={`m-0 ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Share price from ${ys[0].toFixed(4)} to ${last.toFixed(4)} over ${points.length} events`}
      >
        {/* 1.0 is where every vault starts */}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(1)} y2={y(1)} className="stroke-line" strokeDasharray="3 5" />
        <path d={d} fill="none" strokeWidth={2} className={last >= 1 ? "stroke-gain" : "stroke-limit"} />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.timestamp)} cy={y(ys[i])} r={3.2} className="fill-dot" />
        ))}
      </svg>
      <figcaption className="mt-2 flex justify-between font-mono text-[12px] text-muted tabular-nums">
        <span>
          {ys[0].toFixed(4)} on {formatTime(t0)}
        </span>
        <span className={last > ys[0] ? "text-gain" : last < ys[0] ? "text-limit" : ""}>
          {last.toFixed(4)} on {formatTime(t1)}
        </span>
      </figcaption>
    </figure>
  );
}
