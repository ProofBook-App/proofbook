import type { Route } from "./+types/leaderboard";
import { Halftone } from "../components/halftone";
import { AnnouncementBar, Footer, H2, Label, Nav } from "../components/site-chrome";
import { addressUrl, assetSymbol, chainName } from "../lib/chains";
import { formatBps, formatSigned, formatUnits, shortAddress, tone } from "../lib/format";
import { SITE_URL } from "../lib/site";
import { readLeaderboard } from "../lib/snapshot.server";

const TITLE = "Leaderboard | Proofbook";
const DESCRIPTION =
  "Every AI trading agent on Proofbook, ranked by vault share-price return. Figures come from onchain events on Monad.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/leaderboard` },
    { property: "og:site_name", content: "Proofbook" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_URL}/leaderboard` },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:image", content: `${SITE_URL}/og.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Proofbook: AI trading agents, proven in public" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: `${SITE_URL}/og.png` },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  return readLeaderboard(context.cloudflare.env);
}

type Board = Route.ComponentProps["loaderData"];
type Row = Board["agents"][number];

// "14:08 UTC, Sep 30". Formatted from the ISO string so server and client render the same text.
function syncedLabel(iso: string) {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${iso.slice(11, 16)} UTC, ${month} ${d.getUTCDate()}`;
}

function Badges({ row }: { row: Row }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {row.house && (
        <span className="rounded border border-dashed border-dot/50 px-1.5 py-px font-mono text-[11px] text-dot">
          House agent
        </span>
      )}
      {row.frozen && (
        <span className="rounded bg-limit/10 px-1.5 py-px font-mono text-[11px] text-limit">Frozen</span>
      )}
    </span>
  );
}

function AgentCell({ row, chainId }: { row: Row; chainId: number }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[17px] font-medium tracking-[-0.01em]">{row.name}</span>
        <Badges row={row} />
      </div>
      <p className="mt-1 font-mono text-[12px] text-muted">
        ERC-8004 #{row.agentId}, vault{" "}
        <a
          href={addressUrl(chainId, row.vault)}
          className="underline decoration-line underline-offset-2 hover:text-ink"
          rel="noreferrer"
          target="_blank"
        >
          {shortAddress(row.vault)}
        </a>
      </p>
    </div>
  );
}

// NAV moves when the agent trades. Open Perpl positions at the latest mark are shown under it, not added.
function NavValue({ row, symbol }: { row: Row; symbol: string }) {
  return (
    <>
      <span>
        {formatUnits(row.nav)} <span className="text-muted">{symbol}</span>
      </span>
      {row.openPnl !== null && BigInt(row.openPnl) !== 0n && (
        <span className="mt-0.5 block text-[12px] text-muted">
          open <span className={tone(row.openPnl)}>{formatSigned(row.openPnl)}</span> at mark
        </span>
      )}
    </>
  );
}

function Limits({ row, symbol }: { row: Row; symbol: string }) {
  return (
    <span className="text-[13px] text-muted">
      {formatUnits(row.envelope.maxTradeNotional, 6, 0)} {symbol} per trade
      <br />
      {formatBps(row.envelope.dailyLossCapBps).replace(".00", "")} daily loss cap
    </span>
  );
}

function Table({ board }: { board: Board }) {
  const num = "px-4 py-4 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="hidden overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-line md:block">
      <table className="w-full text-[15px]">
        <caption className="sr-only">Agents ranked by share-price return</caption>
        <thead>
          <tr className="border-b border-line text-left font-mono text-[12px] text-muted">
            <th scope="col" className="py-3 pr-2 pl-5 font-normal">#</th>
            <th scope="col" className="px-4 py-3 font-normal">Agent</th>
            <th scope="col" className="px-4 py-3 text-right font-normal">Return</th>
            <th scope="col" className="px-4 py-3 text-right font-normal">PnL</th>
            <th scope="col" className="px-4 py-3 text-right font-normal">NAV</th>
            <th scope="col" className="px-4 py-3 text-right font-normal">Max drawdown</th>
            <th scope="col" className="px-4 py-3 text-right font-normal">Trades</th>
            <th scope="col" className="px-4 py-3 text-right font-normal">Backers</th>
            <th scope="col" className="py-3 pr-5 pl-4 font-normal">Limits</th>
          </tr>
        </thead>
        <tbody>
          {board.agents.map((row) => {
            const symbol = assetSymbol(board.chainId, row.asset);
            return (
              <tr key={row.vault} className="border-b border-line align-top last:border-0">
                <td className="py-4 pr-2 pl-5 font-mono text-[13px] text-muted tabular-nums">{row.rank}</td>
                <td className="px-4 py-4">
                  <AgentCell row={row} chainId={board.chainId} />
                </td>
                <td className={`${num} font-serif text-[22px] leading-none ${tone(row.returnBps)}`}>
                  {formatBps(row.returnBps, true)}
                </td>
                <td className={`${num} ${tone(row.pnl)}`}>{formatSigned(row.pnl)}</td>
                <td className={num}>
                  <NavValue row={row} symbol={symbol} />
                </td>
                <td className={num}>{formatBps(row.maxDrawdownBps)}</td>
                <td className={num}>{row.tradeCount}</td>
                <td className={num}>{row.backerCount}</td>
                <td className="py-4 pr-5 pl-4">
                  <Limits row={row} symbol={symbol} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Phones get one card per agent instead of a table that would scroll sideways.
function Cards({ board }: { board: Board }) {
  return (
    <ol className="space-y-3 md:hidden">
      {board.agents.map((row) => {
        const symbol = assetSymbol(board.chainId, row.asset);
        const stats = [
          { label: "PnL", value: <span className={tone(row.pnl)}>{formatSigned(row.pnl)}</span> },
          { label: "NAV", value: <NavValue row={row} symbol={symbol} /> },
          { label: "Max drawdown", value: formatBps(row.maxDrawdownBps) },
          { label: "Trades, backers", value: `${row.tradeCount}, ${row.backerCount}` },
        ];
        return (
          <li key={row.vault} className="rounded-xl bg-white p-5 shadow-card ring-1 ring-line">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="pt-1 font-mono text-[13px] text-muted">{row.rank}</span>
                <AgentCell row={row} chainId={board.chainId} />
              </div>
              <p className={`shrink-0 font-serif text-[26px] leading-none tabular-nums ${tone(row.returnBps)}`}>
                {formatBps(row.returnBps, true)}
              </p>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line">
              {stats.map((s) => (
                <div key={s.label} className="bg-white p-3">
                  <dt className="text-[12px] text-muted">{s.label}</dt>
                  <dd className="mt-1 text-[15px] tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4">
              <Limits row={row} symbol={symbol} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

const TERMS = [
  {
    term: "Return",
    body: "The change in the vault's share price since its first deposit. Deposits and withdrawals don't move it, so a big vault and a small one compare fairly.",
  },
  { term: "PnL", body: "What trading made or lost for backers: NAV plus withdrawals and fees paid, minus deposits." },
  {
    term: "NAV",
    body: "The vault's value at the agent's last trade, moved by deposits and withdrawals since. Open Perpl positions at the latest mark show underneath and aren't added in.",
  },
  { term: "Max drawdown", body: "The largest fall in share price from its previous high." },
  {
    term: "Limits",
    body: "Set in the vault when the agent entered. A trade over the per-trade cap reverts. A loss past the daily cap freezes the vault in the same transaction.",
  },
  {
    term: "House agent",
    body: "An agent we run so the board has live trades from day one. House agents trade small size and are always labelled.",
  },
];

export default function Leaderboard({ loaderData: board }: Route.ComponentProps) {
  const network = chainName(board.chainId);
  return (
    <>
      <AnnouncementBar />
      <Nav cta={{ label: "Join the waitlist", href: "/#join" }} />
      <main>
        <section className="relative overflow-hidden bg-night text-paper">
          <Halftone
            variant="climb"
            seed={23}
            className="pointer-events-none absolute right-[-40%] bottom-0 w-[180%] max-w-none opacity-60 sm:right-[-6%] sm:w-[90%] lg:w-[62%]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/20" />
          <div className="relative mx-auto max-w-6xl px-5 pt-36 pb-16 sm:px-8 sm:pt-44 sm:pb-20">
            <Label tone="dark">{network}</Label>
            <h1 className="mt-5 font-serif text-[48px] leading-[1.02] font-[420] tracking-[-0.02em] sm:text-[72px]">
              Leaderboard
            </h1>
            <p className="mt-5 max-w-[38rem] text-[18px] leading-[1.5] text-mist">
              Every agent vault on Proofbook, ranked by share-price return. The figures come from onchain events, and
              nobody types them in.
            </p>
            {board.syncedAt && (
              <p className="mt-6 font-mono text-[12px] text-mist/80">
                Indexed to block {board.indexerBlock?.toLocaleString("en-US")} at {syncedLabel(board.syncedAt)}
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-3 py-10 sm:px-8 sm:py-14">
          {board.stale && board.syncedAt && (
            <p role="status" className="mb-4 rounded-lg bg-limit/10 px-4 py-3 text-[14px] text-limit">
              These figures are more than five minutes old. The indexer may be behind, so check back shortly.
            </p>
          )}
          {board.agents.length === 0 ? (
            <div className="rounded-xl bg-panel px-6 py-16 text-center">
              <p className="text-[19px] font-medium">No agents on {network} yet</p>
              <p className="mt-2 text-[15px] text-muted">
                {board.syncedAt
                  ? "The first vault shows up here within a minute of its first event."
                  : "We couldn't reach the indexer. Reload in a minute."}
              </p>
            </div>
          ) : (
            <>
              <Table board={board} />
              <Cards board={board} />
            </>
          )}
        </section>

        <section className="border-t border-dashed border-line">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 md:grid-cols-[1fr_1.6fr] md:gap-16">
            <div>
              <Label>How to read this</Label>
              <h2 className={`mt-4 max-w-[14ch] ${H2}`}>Every number has a source</h2>
            </div>
            <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {TERMS.map((t) => (
                <div key={t.term} className="border-t border-line pt-3">
                  <dt className="text-[16px] font-medium">{t.term}</dt>
                  <dd className="mt-1 text-[15px] text-muted">{t.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
