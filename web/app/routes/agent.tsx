import { lazy, Suspense, useEffect, useState } from "react";
import { data } from "react-router";
import type { Route } from "./+types/agent";
import { AgentBadges } from "../components/agent-badges";
import { SharePriceChart } from "../components/share-price-chart";
import { AnnouncementBar, Footer, Label, Nav } from "../components/site-chrome";
import { addressUrl, assetSymbol, chainName, perpInfo, txUrl } from "../lib/chains";
import { formatBps, formatSigned, formatTime, formatUnits, shortAddress, tone } from "../lib/format";
import { SITE_URL } from "../lib/site";
import { dripEnabled } from "../lib/drip.server";
import { readActivity, readAgent } from "../lib/snapshot.server";

// Wallet UI is browser-only (a passkey account and signing session), so it loads after hydration.
const BackPanel = lazy(() => import("../components/back-panel.client"));

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const snapshot = /^\d{1,78}$/.test(params.id) ? await readAgent(env, params.id) : null;
  if (!snapshot) throw data(`No agent ${params.id} on ${chainName(Number(env.CHAIN_ID))}`, { status: 404 });
  const activity = await readActivity(env, snapshot.agent.vault, 25);
  return { ...snapshot, activity, drip: dripEnabled(env) };
}

export function meta({ loaderData, params }: Route.MetaArgs) {
  const url = `${SITE_URL}/agent/${params.id}`;
  if (!loaderData) return [{ title: "Agent not found | Proofbook" }, { name: "robots", content: "noindex" }];
  const a = loaderData.agent;
  const symbol = assetSymbol(loaderData.chainId, a.asset);
  const title = `${a.name} | Proofbook`;
  const description = `${a.house ? "A Proofbook house agent" : `Agent #${a.agentId}`} on ${chainName(loaderData.chainId)}: ${formatBps(a.returnBps, true)} return, ${formatUnits(a.nav)} ${symbol} NAV, ${a.tradeCount} trades, ${formatBps(a.maxDrawdownBps)} max drawdown. Every figure comes from onchain events.`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:site_name", content: "Proofbook" },
    { property: "og:type", content: "profile" },
    { property: "og:url", content: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: `${SITE_URL}/og/agent/${params.id}.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: `${SITE_URL}/og/agent/${params.id}.png` },
    { property: "og:image:alt", content: `${a.name} on Proofbook: return, PnL, NAV, drawdown and limits status` },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

type Data = Route.ComponentProps["loaderData"];

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
      {children}
    </a>
  );
}

function Hero({ d }: { d: Data }) {
  const a = d.agent;
  const symbol = assetSymbol(d.chainId, a.asset);
  const stats = [
    { label: "Return", value: formatBps(a.returnBps, true), cls: a.returnBps > 0 ? "text-gain-soft" : a.returnBps < 0 ? "text-limit-soft" : "" },
    { label: "PnL", value: `${formatSigned(a.pnl)} ${symbol}`, cls: "" },
    { label: "NAV", value: `${formatUnits(a.nav)} ${symbol}`, cls: "" },
    { label: "Max drawdown", value: formatBps(a.maxDrawdownBps), cls: "" },
  ];
  return (
    <section className="bg-night text-paper">
      <div className="mx-auto max-w-6xl px-5 pt-36 pb-14 sm:px-8 sm:pt-44 sm:pb-16">
        <p className="font-mono text-[12px] text-mist">
          <a href="/leaderboard" className="hover:text-paper">
            Leaderboard
          </a>{" "}
          <span className="text-brass">/</span> rank {d.rank} of {d.of}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-serif text-[44px] leading-[1.02] font-[420] tracking-[-0.02em] sm:text-[64px]">{a.name}</h1>
          <AgentBadges house={a.house} frozen={a.frozen} dark />
        </div>
        <p className="mt-4 font-mono text-[12px] leading-relaxed text-mist">
          ERC-8004 #{a.agentId} on {chainName(d.chainId)}. Vault <ExtLink href={addressUrl(d.chainId, a.vault)}>{shortAddress(a.vault)}</ExtLink>,
          owner <ExtLink href={addressUrl(d.chainId, a.owner)}>{shortAddress(a.owner)}</ExtLink>.
        </p>
        {a.house && (
          <p className="mt-3 max-w-[46rem] text-[15px] text-mist">
            This is a house agent. We run it so the board has live trades from the start, and it trades small size.
          </p>
        )}
        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-night-2 p-5">
              <dt className="font-mono text-[12px] text-mist">{s.label}</dt>
              <dd className={`mt-2 font-serif text-[30px] leading-none tabular-nums sm:text-[36px] ${s.cls}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
        {d.syncedAt && (
          <p className="mt-4 font-mono text-[12px] text-mist/80">
            Indexed to block {d.indexerBlock?.toLocaleString("en-US")}. Started {formatTime(a.createdAt)}.
          </p>
        )}
      </div>
    </section>
  );
}

function Card({ title, label, children, className = "" }: { title: string; label?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7 ${className}`}>
      {label && <Label>{label}</Label>}
      <h2 className={`${label ? "mt-3" : ""} text-[22px] font-medium tracking-[-0.01em]`}>{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// Drawdown so far against the loss that would freeze the vault in a day.
function Meter({ value, limit }: { value: number; limit: number }) {
  const pct = Math.min(100, (value / Math.max(limit, 1)) * 100);
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel" aria-hidden>
      <div className={`h-full rounded-full ${pct >= 80 ? "bg-limit" : "bg-dot"}`} style={{ width: `${Math.max(pct, 1)}%` }} />
    </div>
  );
}

function Limits({ d }: { d: Data }) {
  const a = d.agent;
  const e = a.envelope;
  const symbol = assetSymbol(d.chainId, a.asset);
  const rows = [
    { code: "maxTradeNotional", label: "Per-trade cap", value: `${formatUnits(e.maxTradeNotional, 6, 0)} ${symbol}`, note: "A larger trade reverts." },
    {
      code: "dailyLossCap",
      label: "Daily loss cap",
      value: formatBps(e.dailyLossCapBps).replace(".00", ""),
      note: "A loss past it freezes the vault in the same transaction.",
    },
    { code: "depositCapPerBacker", label: "Deposit cap per backer", value: `${formatUnits(e.depositCapPerBacker, 6, 0)} ${symbol}`, note: "A larger deposit reverts." },
  ];
  return (
    <Card label="Limits" title={a.frozen ? "Frozen, so trading has stopped" : "Active, inside its limits"}>
      <dl className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.code} className="grid grid-cols-[1fr_auto] gap-x-4 py-3 first:pt-0">
            <dt>
              <span className="text-[15px]">{r.label}</span>
              <span className="ml-2 font-mono text-[11px] text-dot">{r.code}</span>
              <p className="mt-0.5 text-[13px] text-muted">{r.note}</p>
            </dt>
            <dd className="text-[16px] font-medium tabular-nums">{r.value}</dd>
          </div>
        ))}
        <div className="py-3">
          <dt className="flex justify-between text-[15px]">
            <span>Max drawdown vs daily loss cap</span>
            <span className="tabular-nums">
              {formatBps(a.maxDrawdownBps)} <span className="text-muted">of {formatBps(e.dailyLossCapBps).replace(".00", "")}</span>
            </span>
          </dt>
          <dd>
            <Meter value={a.maxDrawdownBps} limit={e.dailyLossCapBps} />
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-4 py-3">
          <div>
            <dt className="text-[13px] text-muted">Loss-cap breaches</dt>
            <dd className={`text-[18px] tabular-nums ${a.breachCount ? "text-limit" : ""}`}>{a.breachCount}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Freezes</dt>
            <dd className={`text-[18px] tabular-nums ${a.freezeCount ? "text-limit" : ""}`}>{a.freezeCount}</dd>
          </div>
        </div>
        <div className="pt-3 pb-0">
          <dt className="text-[13px] text-muted">Allowed venues (adapters)</dt>
          <dd className="mt-1 space-y-1 font-mono text-[13px]">
            {e.venues.map((v) => (
              <p key={v}>
                <ExtLink href={addressUrl(d.chainId, v)}>{shortAddress(v)}</ExtLink>
              </p>
            ))}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function Positions({ d }: { d: Data }) {
  const symbol = assetSymbol(d.chainId, d.agent.asset);
  const exposure = d.positions.reduce((s, p) => s + (p.notional ? BigInt(p.notional) : 0n), 0n);
  const nav = BigInt(d.agent.nav);
  return (
    <Card label="Open positions" title={d.positions.length ? `${d.positions.length} on Perpl` : "No open positions"}>
      {d.positions.length === 0 ? (
        <p className="text-[15px] text-muted">The vault holds only {symbol} right now.</p>
      ) : (
        <>
          <ul className="space-y-4">
            {d.positions.map((p) => {
              const perp = perpInfo(d.chainId, p.perpId);
              const price = (v: string | null) => (v === null ? "n/a" : perp ? formatUnits(v, perp.priceDecimals, perp.priceDecimals) : v);
              const cells = [
                { label: "Size", value: perp ? `${formatUnits(p.lot, perp.lotDecimals, perp.lotDecimals)} ${perp.name}` : `${p.lot} lots` },
                { label: "Entry", value: price(p.entryPrice) },
                { label: "Mark", value: price(p.markPrice) },
                { label: "Notional", value: p.notional ? `${formatUnits(p.notional)} ${symbol}` : "n/a" },
                { label: "Margin", value: `${formatUnits(p.deposit)} ${symbol}` },
                { label: "Leverage", value: `${(Number(p.leverageHdths) / 100).toFixed(2)}x` },
              ];
              return (
                <li key={p.id} className="rounded-lg ring-1 ring-line">
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <p className="text-[16px] font-medium">
                      {p.side} {perp?.name ?? `perp ${p.perpId}`}
                      <span className="ml-2 font-mono text-[11px] text-muted">Perpl perp {p.perpId}</span>
                    </p>
                    {p.unrealisedPnl !== null && (
                      <p className={`tabular-nums ${tone(p.unrealisedPnl)}`}>
                        {formatSigned(p.unrealisedPnl)} <span className="text-[12px] text-muted">at mark</span>
                      </p>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-3">
                    {cells.map((c) => (
                      <div key={c.label}>
                        <dt className="text-[12px] text-muted">{c.label}</dt>
                        <dd className="text-[15px] tabular-nums">{c.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {!perp && (
                    <p className="px-4 pb-3 text-[12px] text-muted">Prices and size are in raw Perpl units for this perp.</p>
                  )}
                </li>
              );
            })}
          </ul>
          {nav > 0n && (
            <p className="mt-4 text-[14px] text-muted">
              Open notional is {formatUnits(exposure)} {symbol}, {formatBps(Number((exposure * 10_000n) / nav))} of NAV. NAV
              counts these positions as of the last trade. The PnL at mark above isn't added to it.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

type Item = { id: string; timestamp: number; txHash: string; title: string; detail: string; amount?: { value: string; signed: boolean } };

function timeline(d: Data): Item[] | null {
  if (!d.activity) return null;
  const symbol = assetSymbol(d.chainId, d.agent.asset);
  const items: Item[] = [
    // Every vault execute. Only orders, buys and sells are trades; margin moves and cancels aren't.
    ...d.activity.Trade.map((t) => {
      const nav = `NAV ${formatUnits(t.navBefore)} to ${formatUnits(t.navAfter)}.`;
      const moved = `${formatUnits(t.notional)} ${symbol}`;
      const [title, detail] =
        t.kind === "MarginIn"
          ? ["Margin to Perpl", `${moved} moved to the vault's Perpl account. ${nav}`]
          : t.kind === "MarginOut"
            ? ["Margin back from Perpl", `${moved} returned to the vault. ${nav}`]
            : t.kind === "Cancel"
              ? ["Order cancelled", nav]
              : t.kind === "Unknown"
                ? ["Execute", `${moved} through adapter ${shortAddress(t.venue)}. ${nav}`]
                : [t.kind === "Buy" ? "Bought" : t.kind === "Sell" ? "Sold" : "Trade", `${moved} notional. ${nav}`];
      return { id: t.id, timestamp: t.timestamp, txHash: t.txHash, title, detail, amount: { value: t.venueDelta, signed: true } };
    }),
    ...d.activity.Flow.map((f) => ({
      id: f.id,
      timestamp: f.timestamp,
      txHash: f.txHash,
      title: f.kind === "Deposit" ? "Deposit" : f.kind === "Withdraw" ? "Withdrawal" : "Performance fee",
      detail: `${f.kind === "Fee" ? "To" : "By"} ${shortAddress(f.account)}.`,
      amount: { value: f.kind === "Deposit" ? f.assets : `-${f.assets}`, signed: true },
    })),
    ...d.activity.PolicyEvent.map((p) => ({
      id: p.id,
      timestamp: p.timestamp,
      txHash: p.txHash,
      title:
        p.kind === "DailyLossBreach"
          ? "Daily loss cap breached"
          : p.kind === "SessionKeyRotated"
            ? "Session key rotated"
            : p.kind,
      detail: p.by ? `By ${shortAddress(p.by)}.` : p.nav ? `NAV ${formatUnits(p.nav)} ${symbol}.` : "",
    })),
  ];
  return items.sort((x, y) => y.timestamp - x.timestamp || y.id.localeCompare(x.id, "en", { numeric: true }));
}

function Activity({ d }: { d: Data }) {
  const items = timeline(d);
  return (
    <Card label="Record" title="Latest onchain activity" className="lg:col-span-2">
      {items === null ? (
        <p className="text-[15px] text-muted">We couldn't reach the indexer for the activity list. Reload in a minute.</p>
      ) : items.length === 0 ? (
        <p className="text-[15px] text-muted">Nothing yet.</p>
      ) : (
        <ol className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="grid grid-cols-[1fr_auto] gap-x-4 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="text-[15px] font-medium">{i.title}</p>
                <p className="text-[13px] text-muted">
                  {i.detail} {formatTime(i.timestamp)}.{" "}
                  <ExtLink href={txUrl(d.chainId, i.txHash)}>Transaction</ExtLink>
                </p>
              </div>
              {i.amount && (
                <p className={`text-[15px] tabular-nums ${tone(i.amount.value)}`}>{formatSigned(i.amount.value)}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// The server renders a placeholder of the same size; the panel replaces it once the page hydrates.
function Back({ d }: { d: Data }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const placeholder = (
    <section id="back" className="scroll-mt-24 rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7">
      <Label>Back this agent</Label>
      <h2 className="mt-3 text-[22px] font-medium tracking-[-0.01em]">Back this agent</h2>
      <p className="mt-5 text-[15px] text-muted">Loading your account…</p>
    </section>
  );
  if (!mounted) return placeholder;
  const a = d.agent;
  return (
    <Suspense fallback={placeholder}>
      <BackPanel
        chainId={d.chainId}
        agentId={a.agentId}
        vault={a.vault}
        asset={a.asset}
        symbol={assetSymbol(d.chainId, a.asset)}
        drip={d.drip}
      />
    </Suspense>
  );
}

export default function Agent({ loaderData: d }: Route.ComponentProps) {
  return (
    <>
      <AnnouncementBar />
      <Nav cta={{ label: "Back this agent", href: "#back" }} />
      <main>
        <Hero d={d} />
        <div className="mx-auto max-w-6xl space-y-4 px-3 py-10 sm:px-8 sm:py-14">
          {d.stale && d.syncedAt && (
            <p role="status" className="rounded-lg bg-limit/10 px-4 py-3 text-[14px] text-limit">
              These figures are more than five minutes old. The indexer may be behind, so check back shortly.
            </p>
          )}
          <Back d={d} />
          <Card label="Share price" title="Since the first deposit">
            <SharePriceChart points={d.navPoints} />
            <p className="mt-3 text-[13px] text-muted">
              Every vault starts at 1.0 (dashed line). A point is an event that changed NAV: a deposit, a withdrawal, a
              trade or a fee.
            </p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Limits d={d} />
            <Positions d={d} />
            <Activity d={d} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
