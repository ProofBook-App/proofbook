// The 1200x630 preview card for /agent/:id, rendered to PNG by routes/og.agent.tsx (satori + resvg).
// Same look as public/og.png (scripts/og/card.html): night ground, Newsreader over Geist, brass mono.
// Satori lays out with flexbox only: every element with more than one child needs display: flex.
import newsreader from "@fontsource/newsreader/files/newsreader-latin-400-normal.woff?inline";
import geist from "@fontsource/geist/files/geist-latin-400-normal.woff?inline";
import geistMedium from "@fontsource/geist/files/geist-latin-500-normal.woff?inline";
import geistMono from "@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff?inline";

const C = {
  night: "#141a26",
  night2: "#1d2535",
  paper: "#f8f7f4",
  mist: "#aab6cc",
  dot: "#3b4a68",
  brass: "#d8c27a",
  gainSoft: "#8fd1a8",
  limitSoft: "#f0a08f",
  limit: "#b23a26",
};

function bytes(dataUrl: string) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 500; style: "normal" }[] | undefined;
export function cardFonts() {
  fonts ??= [
    { name: "Newsreader", data: bytes(newsreader), weight: 400, style: "normal" },
    { name: "Geist", data: bytes(geist), weight: 400, style: "normal" },
    { name: "Geist", data: bytes(geistMedium), weight: 500, style: "normal" },
    { name: "Geist Mono", data: bytes(geistMono), weight: 400, style: "normal" },
  ];
  return fonts;
}

export type CardData = {
  name: string;
  agentId: string;
  house: boolean;
  frozen: boolean;
  network: string;
  returnText: string;
  returnSign: number;
  stats: { label: string; value: string }[];
  breaches: number;
  block: number | null;
};

function Mark() {
  const dots: [number, number][] = [[2, 14], [6, 14], [6, 10], [10, 14], [10, 10], [14, 14], [14, 10], [14, 6], [14, 2]];
  return (
    <svg width="26" height="26" viewBox="0 0 16 16">
      {dots.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.6} fill={C.paper} />
      ))}
    </svg>
  );
}

function Chip({ children, tone }: { children: string; tone: "house" | "ok" | "frozen" }) {
  const style =
    tone === "frozen"
      ? { background: C.limit, color: C.paper, border: `1px solid ${C.limit}` }
      : tone === "ok"
        ? { background: "rgba(143,209,168,0.12)", color: C.gainSoft, border: "1px solid rgba(143,209,168,0.35)" }
        : { background: "transparent", color: C.mist, border: `1px dashed ${C.mist}` };
  return (
    <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 22, borderRadius: 6, padding: "6px 14px", ...style }}>
      {children}
    </div>
  );
}

export function AgentCard({ d }: { d: CardData }) {
  const returnColor = d.returnSign > 0 ? C.gainSoft : d.returnSign < 0 ? C.limitSoft : C.paper;
  const status = d.frozen
    ? "Frozen"
    : d.breaches > 0
      ? `Active, ${d.breaches} loss-cap breach${d.breaches === 1 ? "" : "es"}`
      : "Inside its limits";
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        background: C.night,
        color: C.paper,
        fontFamily: "Geist",
        padding: "56px 72px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark />
          <div style={{ fontFamily: "Newsreader", fontSize: 36, letterSpacing: "-0.01em" }}>Proofbook</div>
        </div>
        <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 20, color: C.mist }}>{d.network}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 64 }}>
        {d.house && <Chip tone="house">House agent</Chip>}
        <Chip tone={d.frozen ? "frozen" : "ok"}>{status}</Chip>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
          <div style={{ fontFamily: "Newsreader", fontSize: 92, lineHeight: 1.02, letterSpacing: "-0.02em" }}>{d.name}</div>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 22, color: C.mist, marginTop: 10 }}>
            ERC-8004 #{d.agentId}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 20, color: C.mist }}>Return</div>
          <div style={{ fontFamily: "Newsreader", fontSize: 104, lineHeight: 1, color: returnColor, letterSpacing: "-0.02em" }}>
            {d.returnText}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          marginTop: "auto",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.1)",
          background: C.night2,
        }}
      >
        {d.stats.map((s, i) => (
          <div
            key={s.label}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              padding: "18px 24px",
              borderLeft: i === 0 ? "none" : "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 18, color: C.mist }}>{s.label}</div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 500, marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, fontSize: 20, color: C.mist }}>
        <div style={{ display: "flex", fontFamily: "Geist Mono", color: C.brass }}>proofbook.app/agent/{d.agentId}</div>
        <div style={{ display: "flex" }}>
          {d.block ? `From onchain events, block ${d.block.toLocaleString("en-US")}` : "From onchain events"}
        </div>
      </div>
    </div>
  );
}
