// The backer's portfolio. Browser only: the account is a passkey on this device. Balances and share
// values come straight from the chain every 15 s; cost basis, history and the agents' positions come
// from /api/backer (the indexer and the D1 snapshot). Deposits and withdrawals happen on the agent's
// page, in the same modal, under the same session: links go to /agent/:id#deposit or #withdraw.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Address, Hash } from "viem";
import { Countdown, primary, secondary } from "./account-bits";
import { AgentBadges } from "./agent-badges";
import { PortfolioHero } from "./portfolio-hero";
import { accountAddress, forgetAccount, lockAccount, unlockAccount, useAccount } from "../lib/account.client";
import { assetDecimals, erc20Abi, explain, publicClient, readHoldings, type Holding } from "../lib/backer.client";
import { assetSymbol, perpInfo, txUrl } from "../lib/chains";
import { formatBps, formatSigned, formatTime, formatUnits, shortAddress, tone } from "../lib/format";

type Agent = {
  agentId: string;
  name: string;
  house: boolean;
  vault: Address;
  asset: Address;
  frozen: boolean;
};
type Backer = {
  agents: Agent[];
  history: {
    Backer: { vault_id: string; shares: string; deposited: string; withdrawn: string; firstSeenAt: number }[];
    Flow: { id: string; kind: string; vault_id: string; assets: string; timestamp: number; txHash: string }[];
    Trade: { id: string; vault_id: string; kind: string; notional: string; timestamp: number; txHash: string }[];
  } | null;
  positions: {
    id: string;
    vault: string;
    perpId: string;
    side: string;
    lot: string;
    entryPrice: string;
    markPrice: string | null;
    notional: string | null;
    unrealisedPnl: string | null;
  }[];
};
type Wallet = { mon: bigint; asset: bigint };

const onDark = "min-h-11 px-2 text-[13px] text-mist underline decoration-current/40 underline-offset-2 hover:text-paper";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export default function PortfolioView({ chainId, drip }: { chainId: number; drip: boolean }) {
  const account = useAccount();
  const { session, ended } = account;
  const address = accountAddress(account);
  const [data, setData] = useState<Backer | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [decimals, setDecimals] = useState(6);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<{ label: string; hash: Hash }[]>([]);

  // Every vault on this chain is in the same asset today (AUSD), so totals add up in one unit.
  const asset = data?.agents[0]?.asset;
  const sym = asset ? assetSymbol(chainId, asset) : "AUSD";

  const loadHistory = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/backer/${address}`);
      if (res.ok) setData((await res.json()) as Backer);
    } catch {
      // Keep what's on screen; the next tick tries again.
    }
  }, [address]);

  const loadChain = useCallback(async () => {
    if (!address || !data) return;
    const client = publicClient(chainId);
    try {
      const [h, mon, bal] = await Promise.all([
        readHoldings(chainId, data.agents.map((a) => a.vault), address),
        client.getBalance({ address }),
        asset ? client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [address] }) : 0n,
      ]);
      setHoldings(h);
      setWallet({ mon, asset: bal });
    } catch {
      // A slow RPC leaves the last figures up.
    }
  }, [address, data, chainId, asset]);

  useEffect(() => {
    setData(null);
    setHoldings(null);
    setWallet(null);
    loadHistory();
    const t = setInterval(loadHistory, 30_000);
    return () => clearInterval(t);
  }, [loadHistory]);

  useEffect(() => {
    loadChain();
    const t = setInterval(loadChain, 15_000);
    return () => clearInterval(t);
  }, [loadChain]);

  useEffect(() => {
    if (asset) assetDecimals(chainId, asset).then(setDecimals, () => setDecimals(6));
  }, [chainId, asset]);

  async function login() {
    setError(null);
    setBusy("Waiting for your passkey…");
    try {
      await unlockAccount("login", chainId);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function getTestFunds() {
    if (!data?.agents[0]) return;
    setError(null);
    setBusy(`Sending 10,000 test ${sym} and 0.5 test MON for gas…`);
    try {
      const res = await fetch("/api/drip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, agentId: data.agents[0].agentId }),
      });
      const body = (await res.json()) as { error?: string; notice?: string; monTx?: Hash | null; ausdTx?: Hash | null };
      if (!res.ok) throw new Error(body.error ?? "Test funds failed.");
      if (body.notice) setError(body.notice);
      const got = [
        ...(body.ausdTx ? [{ label: `Test ${sym}`, hash: body.ausdTx }] : []),
        ...(body.monTx ? [{ label: "Test MON for gas", hash: body.monTx }] : []),
      ];
      setReceipts((r) => [...got, ...r].slice(0, 4));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
      loadChain();
    }
  }

  // ---- No account on this device -------------------------------------------------------
  if (!address) {
    return (
      <>
        <PortfolioHero>
          <p className="mt-4 max-w-[40rem] text-[15px] text-mist">
            Your account is a passkey: log in once on this device and your holdings show up here. The same passkey gives
            the same account on any device.
          </p>
        </PortfolioHero>
        <div className="mx-auto max-w-6xl px-3 py-10 sm:px-8 sm:py-14">
          <section className="rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7">
            <h2 className="text-[22px] font-medium tracking-[-0.01em]">Log in to see your portfolio</h2>
            <p className="mt-3 text-[15px] text-muted">One passkey prompt. It also unlocks deposits and withdrawals for 15 minutes.</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button className={primary} disabled={!!busy} onClick={login}>
                Log in with your passkey
              </button>
              <Link to="/leaderboard" className={secondary}>
                New here? Pick an agent
              </Link>
            </div>
            <Status busy={busy} error={error} />
          </section>
        </div>
      </>
    );
  }

  // ---- The portfolio -------------------------------------------------------------------
  const rows = (data?.agents ?? [])
    .map((agent) => {
      const h = holdings?.find((x) => same(x.vault, agent.vault));
      const indexed = data?.history?.Backer.find((b) => same(b.vault_id, agent.vault));
      return { agent, h, indexed };
    })
    .filter((r) => (r.h && r.h.shares > 0n) || (r.indexed && BigInt(r.indexed.deposited) > 0n));
  const held = rows.filter((r) => r.h && r.h.shares > 0n);
  const past = rows.filter((r) => !(r.h && r.h.shares > 0n));

  // Profit needs the indexer's cost basis to match the chain; right after a deposit it can lag.
  const netOf = (r: (typeof rows)[number]) =>
    r.h && r.indexed && BigInt(r.indexed.shares) === r.h.shares ? BigInt(r.indexed.deposited) - BigInt(r.indexed.withdrawn) : null;
  const pnlOf = (r: (typeof rows)[number]) => {
    const net = netOf(r);
    return net === null ? null : r.h!.value - net;
  };
  const invested = held.reduce((s, r) => s + (r.h?.value ?? 0n), 0n);
  const pnls = rows.map(pnlOf);
  const totalPnl = pnls.some((p) => p === null) ? null : pnls.reduce<bigint>((s, p) => s + (p ?? 0n), 0n);
  const loading = holdings === null || wallet === null;
  const needsFunds = wallet !== null && (wallet.asset === 0n || wallet.mon < 100_000_000_000_000_000n);

  const stats = [
    { label: "Total", value: loading ? "…" : formatUnits(invested + wallet!.asset, decimals), unit: sym, cls: "" },
    { label: "Backing agents", value: loading ? "…" : formatUnits(invested, decimals), unit: sym, cls: "" },
    {
      label: "Profit",
      value: loading ? "…" : totalPnl === null ? "updating" : formatSigned(totalPnl, decimals),
      unit: totalPnl === null ? "" : sym,
      cls: totalPnl === null ? "" : totalPnl > 0n ? "text-gain-soft" : totalPnl < 0n ? "text-limit-soft" : "",
    },
    { label: "In your wallet", value: loading ? "…" : formatUnits(wallet!.asset, decimals), unit: sym, cls: "" },
  ];

  return (
    <>
      <PortfolioHero>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[13px] text-mist">
          <span>
            Account <span className="text-paper">{shortAddress(address)}</span>
          </span>
          {session ? <Countdown session={session} className="text-gain-soft" /> : <span>Locked</span>}
          {session ? (
            <button className={onDark} onClick={lockAccount}>
              Lock now
            </button>
          ) : (
            <button className={onDark} onClick={forgetAccount}>
              Forget this device
            </button>
          )}
        </div>
        {!session && ended && <p className="mt-2 text-[13px] text-mist">Session over. {ended}.</p>}
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-night-2 p-5">
              <dt className="font-mono text-[12px] text-mist">{s.label}</dt>
              <dd className={`mt-2 font-serif text-[28px] leading-none tabular-nums sm:text-[34px] ${s.cls}`}>
                {s.value} {s.unit && <span className="font-sans text-[13px] text-mist">{s.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 font-mono text-[12px] text-mist/80">
          Gas: {wallet ? formatUnits(wallet.mon, 18, 3) : "…"} MON. Balances are read from the chain every 15 seconds.
        </p>
      </PortfolioHero>

      <div className="mx-auto max-w-6xl space-y-4 px-3 py-10 sm:px-8 sm:py-14">
        {drip && needsFunds && (
          <section className="rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7">
            <h2 className="text-[22px] font-medium tracking-[-0.01em]">Test funds</h2>
            <p className="mt-3 text-[15px] text-muted">
              This is Monad testnet. We send 10,000 test {sym} and 0.5 test MON for gas. They have no value.
            </p>
            <button className={`${secondary} mt-5`} disabled={!!busy} onClick={getTestFunds}>
              Get test funds
            </button>
          </section>
        )}
        <Status busy={busy} error={error} />
        {receipts.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-white p-5 shadow-card ring-1 ring-line">
            {receipts.map((r) => (
              <li key={r.hash} className="flex justify-between gap-3 font-mono text-[13px]">
                <span className="text-gain">{r.label}</span>
                <a href={txUrl(chainId, r.hash)} target="_blank" rel="noreferrer" className="text-muted underline decoration-current/30 underline-offset-2 hover:text-ink">
                  {shortAddress(r.hash)}
                </a>
              </li>
            ))}
          </ul>
        )}

        <section className="rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7">
          <p className="font-mono text-[12px] tracking-tight text-muted">
            <span className="text-dot">[</span> Holdings <span className="text-dot">]</span>
          </p>
          <h2 className="mt-3 text-[22px] font-medium tracking-[-0.01em]">
            {loading ? "Reading the chain…" : held.length === 0 ? "You don't back an agent yet" : `${held.length} ${held.length === 1 ? "agent" : "agents"}`}
          </h2>
          {!loading && held.length === 0 && (
            <div className="mt-5">
              <p className="text-[15px] text-muted">Pick one on the leaderboard. Every figure there comes from onchain events.</p>
              <Link to="/leaderboard" className={`${primary} mt-5`}>
                See the leaderboard
              </Link>
            </div>
          )}
          {held.length > 0 && (
            <ul className="mt-5 space-y-4">
              {held.map((r) => (
                <HoldingRow
                  key={r.agent.vault}
                  chainId={chainId}
                  agent={r.agent}
                  h={r.h!}
                  pnl={pnlOf(r)}
                  net={netOf(r)}
                  decimals={decimals}
                  positions={data?.positions.filter((p) => same(p.vault, r.agent.vault)) ?? []}
                />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <p className="mt-5 text-[13px] text-muted">
              You've withdrawn everything from{" "}
              {past.map((r, i) => (
                <span key={r.agent.vault}>
                  {i > 0 && ", "}
                  <Link to={`/agent/${r.agent.agentId}`} className="underline decoration-current/30 underline-offset-2 hover:text-ink">
                    {r.agent.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
        </section>

        <Activity chainId={chainId} data={data} decimals={decimals} sym={sym} />
      </div>
    </>
  );
}

function HoldingRow(props: {
  chainId: number;
  agent: Agent;
  h: Holding;
  pnl: bigint | null;
  net: bigint | null;
  decimals: number;
  positions: Backer["positions"];
}) {
  const { agent: a, h, decimals: d } = props;
  const sym = assetSymbol(props.chainId, a.asset);
  const ownBps = h.totalShares === 0n ? 0 : Number((h.shares * 10_000n) / h.totalShares);
  const atVenue = h.value > h.maxWithdraw ? h.value - h.maxWithdraw : 0n;
  // Value is live (the vault's NAV at the latest mark); the leaderboard's return is as of the last
  // trade, so it isn't shown here next to it.
  const cells = [
    { label: "Value now", value: `${formatUnits(h.value, d)} ${sym}`, cls: "" },
    { label: "Put in, net", value: props.net === null ? "updating" : `${formatUnits(props.net, d)} ${sym}`, cls: props.net === null ? "text-muted" : "" },
    { label: "Profit", value: props.pnl === null ? "updating" : `${formatSigned(props.pnl, d)} ${sym}`, cls: props.pnl === null ? "text-muted" : tone(props.pnl) },
    { label: "Your share of the vault", value: ownBps < 1 && h.shares > 0n ? "<0.01%" : formatBps(ownBps), cls: "" },
  ];
  return (
    <li className="rounded-lg ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/agent/${a.agentId}`} className="text-[17px] font-medium underline decoration-line underline-offset-4 hover:decoration-ink">
            {a.name}
          </Link>
          <AgentBadges house={a.house} frozen={a.frozen} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <dt className="text-[12px] text-muted">{c.label}</dt>
            <dd className={`mt-0.5 font-mono text-[15px] tabular-nums ${c.cls}`}>{c.value}</dd>
          </div>
        ))}
      </dl>
      {props.positions.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="text-[12px] text-muted">The agent's open Perpl positions, paid for in part by your stake</p>
          <ul className="mt-2 space-y-1">
            {props.positions.map((p) => {
              const perp = perpInfo(props.chainId, p.perpId);
              const size = perp ? `${formatUnits(p.lot, perp.lotDecimals, perp.lotDecimals)} ${perp.name}` : `${p.lot} lots`;
              return (
                <li key={p.id} className="flex flex-wrap justify-between gap-x-3 font-mono text-[13px]">
                  <span>
                    {p.side} {size}
                    {p.notional && <span className="text-muted"> · {formatUnits(p.notional)} {sym}</span>}
                  </span>
                  {p.unrealisedPnl !== null && <span className={tone(p.unrealisedPnl)}>{formatSigned(p.unrealisedPnl)} at mark</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {atVenue > 0n && (
        <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
          {formatUnits(atVenue, d)} {sym} of yours is at the venue right now. You can withdraw {formatUnits(h.maxWithdraw, d)} now.
        </p>
      )}
      <div className="flex gap-2 border-t border-line px-4 py-3">
        <Link to={`/agent/${a.agentId}#deposit`} className={`${secondary} min-h-11 flex-1 sm:flex-none`}>
          Deposit
        </Link>
        <Link to={`/agent/${a.agentId}#withdraw`} className={`${secondary} min-h-11 flex-1 sm:flex-none`}>
          Withdraw
        </Link>
      </div>
    </li>
  );
}

function Activity({ chainId, data, decimals, sym }: { chainId: number; data: Backer | null; decimals: number; sym: string }) {
  const name = (vault: string) => data?.agents.find((a) => same(a.vault, vault))?.name ?? shortAddress(vault);
  const items = data?.history
    ? [
        ...data.history.Flow.map((f) => ({
          id: `f-${f.id}`,
          timestamp: f.timestamp,
          txHash: f.txHash,
          title: f.kind === "Deposit" ? `You deposited into ${name(f.vault_id)}` : `You withdrew from ${name(f.vault_id)}`,
          amount: f.kind === "Deposit" ? f.assets : `-${f.assets}`,
        })),
        ...data.history.Trade.filter((t) => t.kind !== "Cancel").map((t) => ({
          id: `t-${t.id}`,
          timestamp: t.timestamp,
          txHash: t.txHash,
          title: `${name(t.vault_id)}: ${
            t.kind === "MarginIn"
              ? "margin to Perpl"
              : t.kind === "MarginOut"
                ? "margin back from Perpl"
                : t.kind === "Buy"
                  ? "bought"
                  : t.kind === "Sell"
                    ? "sold"
                    : "traded"
          } ${formatUnits(t.notional, decimals)} ${sym}`,
          amount: null,
        })),
      ]
        .sort((x, y) => y.timestamp - x.timestamp)
        .slice(0, 15)
    : null;
  return (
    <section className="rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7">
      <p className="font-mono text-[12px] tracking-tight text-muted">
        <span className="text-dot">[</span> Record <span className="text-dot">]</span>
      </p>
      <h2 className="mt-3 text-[22px] font-medium tracking-[-0.01em]">Your activity and your agents' trades</h2>
      <div className="mt-5">
        {data === null ? (
          <p className="text-[15px] text-muted">Loading…</p>
        ) : items === null ? (
          <p className="text-[15px] text-muted">We couldn't reach the indexer for your history. Balances above are still live.</p>
        ) : items.length === 0 ? (
          <p className="text-[15px] text-muted">Nothing yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="grid grid-cols-[1fr_auto] gap-x-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium">{i.title}</p>
                  <p className="text-[13px] text-muted">
                    {formatTime(i.timestamp)}.{" "}
                    <a href={txUrl(chainId, i.txHash)} target="_blank" rel="noreferrer" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
                      Transaction
                    </a>
                  </p>
                </div>
                {i.amount && <p className={`text-[15px] tabular-nums ${tone(i.amount)}`}>{formatSigned(i.amount, decimals)}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Status({ busy, error }: { busy: string | null; error: string | null }) {
  if (busy) return <p role="status" className="mt-4 text-[14px] text-muted">{busy}</p>;
  if (error) return <p role="alert" className="mt-4 rounded-lg bg-limit/10 px-4 py-3 text-[14px] text-limit">{error}</p>;
  return null;
}
