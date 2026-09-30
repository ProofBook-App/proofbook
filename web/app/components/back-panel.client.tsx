// Deposit and withdraw on an agent's vault, with a Mera passkey account. Browser only: the agent page
// mounts it after hydration. One passkey prompt creates or unlocks the account and starts a
// 15-minute signing session scoped to this vault; inside it, approve, deposit and withdraw sign
// without prompts. Nothing secret is stored on the device.

import { useCallback, useEffect, useRef, useState } from "react";
import { parseUnits, type Address, type Hash } from "viem";
import {
  SESSION_MINUTES,
  TxFailed,
  assetDecimals,
  explain,
  forgetDevice,
  loadIdentity,
  readPosition,
  unlock,
  type Identity,
  type Position,
  type Scope,
  type Session,
} from "../lib/backer.client";
import { txUrl } from "../lib/chains";
import { formatUnits, shortAddress } from "../lib/format";

export type BackPanelProps = {
  chainId: number;
  agentId: string;
  vault: string;
  asset: string;
  symbol: string;
  drip: boolean;
};

type Receipt = { label: string; hash: Hash; ok: boolean };

const btn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-5 text-[15px] font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${btn} bg-brass text-ink hover:bg-brass-hover`;
const secondary = `${btn} bg-panel text-ink ring-1 ring-line hover:bg-panel-2`;
const quiet = "min-h-11 px-2 text-[14px] text-muted underline decoration-current/30 underline-offset-2 hover:text-ink";

export default function BackPanel(props: BackPanelProps) {
  const scope: Scope = { chainId: props.chainId, vault: props.vault as Address, asset: props.asset as Address };
  const [identity, setIdentity] = useState<Identity | undefined>(() => loadIdentity());
  const [session, setSession] = useState<Session | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [decimals, setDecimals] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [firstTx, setFirstTx] = useState<string | null>(null);
  const started = useRef<{ at: number; taps: number } | null>(null);
  const address = session?.address ?? identity?.address;

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setPosition(await readPosition(scope, address));
    } catch {
      // A slow RPC just leaves the last figures up; the next refresh tries again.
    }
  }, [address, props.vault]);

  useEffect(() => {
    assetDecimals(scope).then(setDecimals, () => setDecimals(6));
  }, [props.asset]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Lock when the page goes away, so the key doesn't outlive the tab's view of it.
  useEffect(() => () => session?.end("You left the page"), [session]);

  function tap() {
    if (started.current) started.current.taps += 1;
  }

  async function begin(mode: "create" | "login") {
    started.current ??= { at: Date.now(), taps: 0 };
    tap();
    setError(null);
    setEnded(null);
    setBusy(mode === "create" ? "Waiting for your passkey…" : "Waiting for your passkey…");
    try {
      const s = await unlock(mode, scope, (reason) => {
        setSession(null);
        setEnded(reason);
      });
      setSession(s);
      setIdentity(loadIdentity());
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function run(steps: { label: string; send: () => Promise<Hash> }[]) {
    tap();
    setError(null);
    try {
      for (const [i, step] of steps.entries()) {
        setBusy(steps.length > 1 ? `${step.label} (${i + 1} of ${steps.length})…` : `${step.label}…`);
        const hash = await step.send();
        setReceipts((r) => [{ label: step.label, hash, ok: true }, ...r].slice(0, 6));
      }
      if (!firstTx && started.current && steps.some((s) => s.label === "Deposit")) {
        const secs = Math.round((Date.now() - started.current.at) / 1000);
        setFirstTx(`First deposit: ${started.current.taps} taps, ${secs} s from the first tap.`);
      }
    } catch (e) {
      if (e instanceof TxFailed) setReceipts((r) => [{ label: "Reverted", hash: e.hash, ok: false }, ...r].slice(0, 6));
      setError(explain(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function getTestFunds() {
    tap();
    setError(null);
    setBusy("Sending test MON and AUSD…");
    try {
      const res = await fetch("/api/drip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, agentId: props.agentId }),
      });
      const body = (await res.json()) as { error?: string; notice?: string; monTx?: Hash | null; ausdTx?: Hash | null };
      if (!res.ok) throw new Error(body.error ?? "Test funds failed.");
      if (body.notice) setError(body.notice);
      const got: Receipt[] = [];
      if (body.ausdTx) got.push({ label: "Test AUSD", hash: body.ausdTx, ok: true });
      if (body.monTx) got.push({ label: "Test MON for gas", hash: body.monTx, ok: true });
      setReceipts((r) => [...got, ...r].slice(0, 6));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const d = decimals ?? 6;
  const sym = props.symbol;

  if (!address) {
    return (
      <Shell title="Back this agent">
        <p className="text-[15px] text-muted">
          Your account is a passkey: Face ID, Touch ID or your phone. No seed phrase and no extension. One prompt creates it
          and unlocks it for {SESSION_MINUTES} minutes.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button className={primary} disabled={!!busy} onClick={() => begin("create")}>
            Create an account
          </button>
          <button className={secondary} disabled={!!busy} onClick={() => begin("login")}>
            Log in with a passkey
          </button>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Made one before, here or on another device? Log in. The same passkey always gives the same account.
        </p>
        <Status busy={busy} error={error} />
      </Shell>
    );
  }

  const p = position;
  const lowGas = p !== null && p.mon < 100_000_000_000_000_000n; // 0.1 MON: a deposit and a withdrawal (~0.04 each on testnet)
  const needsFunds = p !== null && (lowGas || p.wallet === 0n);
  const atVenue = p !== null && p.value > p.maxWithdraw ? p.value - p.maxWithdraw : 0n;

  return (
    <Shell title={p && p.shares > 0n ? "Your position" : "Back this agent"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-[13px] text-muted">
          Account <span className="text-ink">{shortAddress(address)}</span>
        </p>
        {session ? <Countdown session={session} /> : <p className="font-mono text-[13px] text-muted">Locked</p>}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="In this vault" value={p ? `${formatUnits(p.value, d)}` : "…"} unit={sym} />
        <Stat label="In your wallet" value={p ? `${formatUnits(p.wallet, d)}` : "…"} unit={sym} />
        <Stat label="Gas" value={p ? formatUnits(p.mon, 18, 3) : "…"} unit="MON" />
      </dl>

      {!session ? (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button className={primary} disabled={!!busy} onClick={() => begin("login")}>
            Unlock for {SESSION_MINUTES} minutes
          </button>
          <button
            className={quiet}
            onClick={() => {
              forgetDevice();
              setIdentity(undefined);
              setPosition(null);
            }}
          >
            Forget this device
          </button>
          {ended && <p className="text-[13px] text-muted">Session over. {ended}.</p>}
        </div>
      ) : (
        <>
          {needsFunds && props.drip && (
            <div className="mt-5 rounded-lg bg-panel p-4">
              <p className="text-[14px] text-muted">
                This is Monad testnet. New accounts start empty, so get 10,000 test {sym} and 0.5 test MON for gas. They have
                no value.
              </p>
              <button className={`${secondary} mt-3`} disabled={!!busy} onClick={getTestFunds}>
                Get test funds
              </button>
            </div>
          )}
          {needsFunds && !props.drip && lowGas && (
            <p className="mt-5 rounded-lg bg-panel p-4 text-[14px] text-muted">
              Your account needs a little MON to pay gas. Send some to {shortAddress(address)}.
            </p>
          )}

          {p && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <AmountForm
                title="Deposit"
                symbol={sym}
                decimals={d}
                max={p.wallet < p.maxDeposit ? p.wallet : p.maxDeposit}
                disabled={!!busy || p.frozen || p.maxDeposit === 0n}
                note={
                  p.frozen
                    ? "The vault is frozen, so it takes no deposits. Withdrawals still work."
                    : `Cap per backer: ${formatUnits(p.cap, d)} ${sym}. You can add ${formatUnits(p.maxDeposit, d)} more.`
                }
                onSubmit={(amount) =>
                  run([
                    ...(p.allowance < amount
                      ? [{ label: "Approve", send: () => session.approve(amount) }]
                      : []),
                    { label: "Deposit", send: () => session.deposit(amount) },
                  ])
                }
              />
              <AmountForm
                title="Withdraw"
                symbol={sym}
                decimals={d}
                max={p.maxWithdraw}
                disabled={!!busy || p.shares === 0n}
                note={
                  atVenue > 0n
                    ? `${formatUnits(atVenue, d)} ${sym} of yours is at the venue right now. You can withdraw ${formatUnits(p.maxWithdraw, d)} now, and the rest once it's back in the vault.`
                    : "A 10% fee on profit above the vault's high-water mark goes to the agent's builder. Nothing else."
                }
                onSubmit={(amount) =>
                  run([
                    amount === p.maxWithdraw && p.maxWithdraw >= p.value
                      ? { label: "Withdraw", send: () => session.redeemAll() }
                      : { label: "Withdraw", send: () => session.withdraw(amount) },
                  ])
                }
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4">
            <button className={quiet} onClick={() => session.end()}>
              Lock now
            </button>
            <p className="text-[13px] text-muted">
              Unlocked for approve, deposit and withdraw on this vault only, to your own account.
            </p>
          </div>
        </>
      )}

      <Status busy={busy} error={error} />
      {firstTx && <p className="mt-3 font-mono text-[12px] text-muted">{firstTx}</p>}
      {receipts.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-line pt-3">
          {receipts.map((r) => (
            <li key={r.hash} className="flex justify-between gap-3 font-mono text-[13px]">
              <span className={r.ok ? "text-gain" : "text-limit"}>{r.label}</span>
              <a href={txUrl(props.chainId, r.hash)} target="_blank" rel="noreferrer" className="text-muted underline decoration-current/30 underline-offset-2 hover:text-ink">
                {shortAddress(r.hash)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id="back" className="scroll-mt-24 rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:p-7">
      <p className="font-mono text-[12px] tracking-tight text-muted">
        <span className="text-dot">[</span> Back this agent <span className="text-dot">]</span>
      </p>
      <h2 className="mt-3 text-[22px] font-medium tracking-[-0.01em]">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg bg-panel px-3 py-2.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] tabular-nums">
        {value} <span className="text-[12px] text-muted">{unit}</span>
      </dd>
    </div>
  );
}

function Status({ busy, error }: { busy: string | null; error: string | null }) {
  if (busy) return <p role="status" className="mt-4 text-[14px] text-muted">{busy}</p>;
  if (error) return <p role="alert" className="mt-4 rounded-lg bg-limit/10 px-4 py-3 text-[14px] text-limit">{error}</p>;
  return null;
}

function Countdown({ session }: { session: Session }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((session.expiresAt - now) / 1000));
  return (
    <p className="font-mono text-[13px] text-gain tabular-nums">
      Unlocked, {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
    </p>
  );
}

function AmountForm(props: {
  title: string;
  symbol: string;
  decimals: number;
  max: bigint;
  disabled: boolean;
  note: string;
  onSubmit: (amount: bigint) => void;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const id = `amount-${props.title.toLowerCase()}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let amount: bigint;
    try {
      amount = parseUnits(text.replace(/,/g, "").trim(), props.decimals);
    } catch {
      return setInvalid("Enter an amount, like 25 or 12.5.");
    }
    if (amount <= 0n) return setInvalid("Enter an amount above zero.");
    if (amount > props.max) return setInvalid(`The most you can ${props.title.toLowerCase()} now is ${formatUnits(props.max, props.decimals)}.`);
    setInvalid(null);
    props.onSubmit(amount);
    setText("");
  }

  return (
    <form onSubmit={submit} className="rounded-lg ring-1 ring-line p-4" noValidate>
      <label htmlFor={id} className="text-[14px] font-medium">
        {props.title}
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-md bg-paper px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-dot">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-12 w-full min-w-0 bg-transparent font-mono text-[16px] tabular-nums outline-none"
        />
        <span className="font-mono text-[13px] text-muted">{props.symbol}</span>
        <button
          type="button"
          className="min-h-11 px-1 font-mono text-[12px] text-dot hover:text-ink disabled:opacity-50"
          disabled={props.max === 0n}
          onClick={() => setText(formatUnits(props.max, props.decimals, props.decimals).replace(/,/g, ""))}
        >
          Max
        </button>
      </div>
      {invalid && <p className="mt-2 text-[13px] text-limit">{invalid}</p>}
      <button type="submit" disabled={props.disabled} className={`${primary} mt-3 w-full`}>
        {props.title}
      </button>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{props.note}</p>
    </form>
  );
}
