// Deposit and withdraw on an agent's vault, with a Mera passkey account. Browser only: the agent page
// mounts it after hydration. One passkey prompt creates or unlocks the account and starts a
// 15-minute signing session scoped to the agent vaults (lib/account.client.ts holds it for the tab,
// so the portfolio and other agent pages share it); inside it, approve, deposit and withdraw sign
// without prompts. Nothing secret is stored on the device.
//
// The panel on the page shows the position. The flow itself runs in a modal that picks up wherever
// the backer is: no account → create or log in; locked → unlock; empty on testnet → test funds
// (requested without a tap); then the amount, then a receipt. Any "#back" link opens it, and the page
// opens it on arrival at #deposit or #withdraw (the portfolio links there).

import { useCallback, useEffect, useRef, useState } from "react";
import { parseUnits, type Address, type Hash } from "viem";
import { Countdown, primary, quiet, secondary } from "./account-bits";
import { accountAddress, forgetAccount, lockAccount, unlockAccount, useAccount } from "../lib/account.client";
import {
  SESSION_MINUTES,
  TxFailed,
  assetDecimals,
  explain,
  readPosition,
  type Position,
  type Session,
  type VaultRef,
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
  /** Proofbook has checked this agent's adapters. Until the registry checks them onchain
   * (docs/security-review.md, C1), deposits are off for every other agent. Withdrawals stay open. */
  verified: boolean;
};

type Mode = "deposit" | "withdraw";
type Receipt = { label: string; hash: Hash; ok: boolean };
type Done = { mode: Mode; amount: bigint; hash: Hash };

export default function BackPanel(props: BackPanelProps) {
  const ref: VaultRef = { vault: props.vault as Address, asset: props.asset as Address };
  const account = useAccount();
  const { session, ended } = account;
  const [position, setPosition] = useState<Position | null>(null);
  const [decimals, setDecimals] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [firstTx, setFirstTx] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("deposit");
  const [done, setDone] = useState<Done | null>(null);
  const started = useRef<{ at: number; taps: number } | null>(null);
  const dripTried = useRef<Session | null>(null);
  const address = accountAddress(account);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setPosition(await readPosition(props.chainId, ref, address));
    } catch {
      // A slow RPC just leaves the last figures up; the next refresh tries again.
    }
  }, [address, props.vault]);

  useEffect(() => {
    assetDecimals(props.chainId, ref.asset).then(setDecimals, () => setDecimals(6));
  }, [props.asset]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!address) setPosition(null);
  }, [address]);

  // Arriving at #deposit or #withdraw (from the portfolio) opens the flow there.
  useEffect(() => {
    const m = location.hash.slice(1);
    if (m !== "deposit" && m !== "withdraw") return;
    history.replaceState(null, "", location.pathname + location.search);
    openFlow(m);
  }, []);

  // "Back this agent" in the nav (and any other #back link) opens the flow instead of scrolling.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as Element | null)?.closest?.('a[href="#back"]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openFlow("deposit");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  });

  const p = position;
  const lowGas = p !== null && p.mon < 100_000_000_000_000_000n; // 0.1 MON: a deposit and a withdrawal (~0.04 each on testnet)
  const needsFunds = p !== null && (lowGas || p.wallet === 0n);

  // On testnet an empty account gets its test funds as soon as it's unlocked: no tap, one request
  // per session. If that fails the modal shows a button to try again.
  useEffect(() => {
    if (session && needsFunds && props.drip && dripTried.current !== session && !busy) {
      dripTried.current = session;
      getTestFunds(false);
    }
  }, [session, needsFunds, props.drip, busy]);

  function tap() {
    started.current ??= { at: Date.now(), taps: 0 };
    started.current.taps += 1;
  }

  function openFlow(next: Mode) {
    tap();
    setMode(next);
    setDone(null);
    setError(null);
    setOpen(true);
  }

  async function begin(how: "create" | "login") {
    tap();
    setError(null);
    setBusy(how === "create" ? "Creating your account. Confirm with your passkey…" : "Waiting for your passkey…");
    try {
      await unlockAccount(how, props.chainId, [ref]);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function run(action: Mode, amount: bigint, steps: { label: string; send: () => Promise<Hash> }[]) {
    tap();
    setError(null);
    try {
      let last: Hash | undefined;
      for (const [i, step] of steps.entries()) {
        setBusy(steps.length > 1 ? `${step.label} (${i + 1} of ${steps.length})…` : `${step.label}…`);
        last = await step.send();
        setReceipts((r) => [{ label: step.label, hash: last!, ok: true }, ...r].slice(0, 6));
      }
      if (last) setDone({ mode: action, amount, hash: last });
      if (!firstTx && started.current && action === "deposit") {
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

  async function getTestFunds(byHand: boolean) {
    if (byHand) tap();
    setError(null);
    setBusy(`Sending 10,000 test ${props.symbol} and 0.5 test MON for gas…`);
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
      if (body.ausdTx) got.push({ label: `Test ${props.symbol}`, hash: body.ausdTx, ok: true });
      if (body.monTx) got.push({ label: "Test MON for gas", hash: body.monTx, ok: true });
      setReceipts((r) => [...got, ...r].slice(0, 6));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  const d = decimals ?? 6;
  const sym = props.symbol;
  const atVenue = p !== null && p.value > p.maxWithdraw ? p.value - p.maxWithdraw : 0n;

  const flow = (
    <Modal open={open} onClose={() => setOpen(false)}>
      {(() => {
        if (mode === "deposit" && !props.verified) {
          return (
            <Step title="Deposits are off for this agent">
              <p className="text-[15px] text-muted">
                A vault trusts the adapters its builder listed, and the contracts don't check them yet. A dishonest
                adapter could take deposits while the vault reports nothing wrong. Until the registry checks adapters
                onchain, Proofbook takes deposits only for agents whose adapters it deployed itself.
              </p>
              <p className="mt-3 text-[13px] text-muted">If you already hold shares here, withdrawing still works.</p>
            </Step>
          );
        }
        if (!address) {
          return (
            <Step title="Back this agent">
              <p className="text-[15px] text-muted">
                Your account is a passkey: Face ID, Touch ID or your phone. No seed phrase and no extension. One prompt
                creates it and unlocks it for {SESSION_MINUTES} minutes.
              </p>
              <button className={`${primary} mt-5 w-full`} disabled={!!busy} onClick={() => begin("create")}>
                Create an account
              </button>
              <p className="mt-3 text-[13px] text-muted">
                Made one before, here or on another device?{" "}
                <button className="text-ink underline decoration-current/30 underline-offset-2 hover:decoration-current disabled:opacity-50" disabled={!!busy} onClick={() => begin("login")}>
                  Log in with your passkey
                </button>
                {". "}The same passkey always gives the same account.
              </p>
            </Step>
          );
        }
        if (!session) {
          return (
            <Step title="Unlock your account">
              <p className="text-[15px] text-muted">
                One passkey prompt unlocks <span className="font-mono text-ink">{shortAddress(address)}</span> for{" "}
                {SESSION_MINUTES} minutes, across every page here. It can only approve, deposit and withdraw on Proofbook agent
                vaults, to and from your own account.
              </p>
              <button className={`${primary} mt-5 w-full`} disabled={!!busy} onClick={() => begin("login")}>
                Unlock for {SESSION_MINUTES} minutes
              </button>
              {ended && <p className="mt-3 text-[13px] text-muted">Session over. {ended}.</p>}
            </Step>
          );
        }
        if (!p) {
          return (
            <Step title="Your account">
              <p role="status" className="text-[15px] text-muted">
                Reading your balances…
              </p>
            </Step>
          );
        }
        if (done) {
          const verb = done.mode === "deposit" ? "Deposited" : "Withdrew";
          return (
            <Step title={`${verb} ${formatUnits(done.amount, d)} ${sym}`}>
              <p className="text-[15px] text-muted">
                {done.mode === "deposit"
                  ? `You now hold ${formatUnits(p.value, d)} ${sym} in this vault. It moves with the agent's trades, and you can withdraw any time the vault isn't mid-trade.`
                  : `${formatUnits(p.wallet, d)} ${sym} is in your wallet. ${formatUnits(p.value, d)} ${sym} is still in this vault.`}
              </p>
              <a
                href={txUrl(props.chainId, done.hash)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block font-mono text-[13px] text-muted underline decoration-current/30 underline-offset-2 hover:text-ink"
              >
                {shortAddress(done.hash)} on the explorer
              </a>
              {firstTx && done.mode === "deposit" && <p className="mt-3 font-mono text-[12px] text-muted">{firstTx}</p>}
              <div className="mt-5 flex flex-col gap-2">
                <button className={primary} onClick={() => setOpen(false)}>
                  Done
                </button>
                <button className={secondary} onClick={() => setDone(null)}>
                  {done.mode === "deposit" ? "Deposit more" : "Withdraw more"}
                </button>
              </div>
            </Step>
          );
        }
        if (mode === "deposit" && needsFunds && props.drip) {
          return (
            <Step title="Test funds">
              <p className="text-[15px] text-muted">
                This is Monad testnet. New accounts start empty, so we send 10,000 test {sym} and 0.5 test MON for gas.
                They have no value.
              </p>
              {!busy && (
                <button className={`${secondary} mt-5 w-full`} onClick={() => getTestFunds(true)}>
                  Get test funds
                </button>
              )}
            </Step>
          );
        }
        return (
          <Step title={mode === "deposit" ? "Deposit" : "Withdraw"}>
            <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-panel p-1">
              {(["deposit", "withdraw"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`min-h-10 rounded text-[14px] font-medium capitalize ${mode === m ? "bg-white text-ink shadow-card" : "text-muted hover:text-ink"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <dl className="mb-4 grid grid-cols-2 gap-2">
              <Stat label="In your wallet" value={formatUnits(p.wallet, d)} unit={sym} />
              <Stat label="In this vault" value={formatUnits(p.value, d)} unit={sym} />
            </dl>
            {!props.drip && lowGas && (
              <p className="mb-4 rounded-lg bg-panel p-4 text-[14px] text-muted">
                Your account needs a little MON to pay gas. Send some to {shortAddress(address)}.
              </p>
            )}
            {mode === "deposit" ? (
              <AmountForm
                key="deposit"
                title="Deposit"
                symbol={sym}
                decimals={d}
                max={p.wallet < p.maxDeposit ? p.wallet : p.maxDeposit}
                disabled={!!busy || p.frozen || p.maxDeposit === 0n}
                note={
                  p.frozen
                    ? "The vault is frozen, so it takes no deposits. Withdrawals still work."
                    : !p.reliable
                      ? "Deposits are paused while one of the agent's venues can't be priced (a stale price or a failed read), so the vault's value is understated. Withdrawals still work."
                    : `Cap per backer: ${formatUnits(p.cap, d)} ${sym}. You can add ${formatUnits(p.maxDeposit, d)} more.`
                }
                onSubmit={(amount) =>
                  run("deposit", amount, [
                    ...(p.allowance < amount ? [{ label: "Approve", send: () => session.approve(ref, amount) }] : []),
                    { label: "Deposit", send: () => session.deposit(ref, amount) },
                  ])
                }
              />
            ) : (
              <AmountForm
                key="withdraw"
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
                  run("withdraw", amount, [
                    amount === p.maxWithdraw && p.maxWithdraw >= p.value
                      ? { label: "Withdraw", send: () => session.redeemAll(ref) }
                      : { label: "Withdraw", send: () => session.withdraw(ref, amount) },
                  ])
                }
              />
            )}
          </Step>
        );
      })()}
      <Status busy={busy} error={error} />
      {session && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 border-t border-line pt-3">
          <Countdown session={session} />
          <button className={quiet} onClick={lockAccount}>
            Lock now
          </button>
        </div>
      )}
    </Modal>
  );

  if (!address) {
    return (
      <Shell title="Back this agent">
        {!props.verified && (
          <p className="mb-4 rounded-lg bg-limit/10 px-4 py-3 text-[14px] text-limit">
            Deposits are off. For now the app takes deposits only for Proofbook's house agents.
          </p>
        )}
        <p className="text-[15px] text-muted">
          Your account is a passkey: Face ID, Touch ID or your phone. No seed phrase and no extension.
        </p>
        <button className={`${primary} mt-5`} onClick={() => openFlow("deposit")}>
          Back this agent
        </button>
        {flow}
      </Shell>
    );
  }

  return (
    <Shell title={p && p.shares > 0n ? "Your position" : "Back this agent"}>
      {!props.verified && (
          <p className="mb-4 rounded-lg bg-limit/10 px-4 py-3 text-[14px] text-limit">
            Deposits are off. For now the app takes deposits only for Proofbook's house agents.
          </p>
        )}
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

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button className={primary} disabled={!props.verified} onClick={() => openFlow("deposit")}>
          Deposit
        </button>
        <button className={secondary} disabled={!p || p.shares === 0n} onClick={() => openFlow("withdraw")}>
          Withdraw
        </button>
        {session ? (
          <button className={quiet} onClick={lockAccount}>
            Lock now
          </button>
        ) : (
          <button
            className={quiet}
            onClick={forgetAccount}
          >
            Forget this device
          </button>
        )}
      </div>
      {!session && ended && <p className="mt-3 text-[13px] text-muted">Session over. {ended}.</p>}

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
      {flow}
    </Shell>
  );
}

// A native <dialog>: focus trap, Escape and the top layer come from the browser. A bottom sheet on
// phones, a centred card from sm up. Clicking the backdrop closes it; work in flight carries on.
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label="Back this agent"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-white p-0 text-ink shadow-card transition-[opacity,translate] duration-200 ease-(--ease-out-soft) backdrop:bg-night/50 starting:translate-y-6 starting:opacity-0 motion-reduce:transition-none sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      <div className="relative px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:pt-6 sm:pb-7">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-md text-[22px] leading-none text-muted hover:bg-panel hover:text-ink"
        >
          ×
        </button>
        {children}
      </div>
    </dialog>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <p className="font-mono text-[12px] tracking-tight text-muted">
        <span className="text-dot">[</span> Back this agent <span className="text-dot">]</span>
      </p>
      <h2 className="mt-2 mb-4 pr-10 text-[22px] font-medium tracking-[-0.01em]">{title}</h2>
      {children}
    </>
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
    <form onSubmit={submit} noValidate>
      <label htmlFor={id} className="sr-only">
        {props.title} amount
      </label>
      <div className="flex items-center gap-2 rounded-md bg-paper px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-dot">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
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
