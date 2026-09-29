import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/home";
import {
  assertPasskey,
  createPasskey,
  describeError,
  EXPLORER,
  forgetDevice,
  getTestnetBalance,
  loadIdentity,
  MESSAGE_PREFIX,
  startBoundedSession,
  type BoundedSession,
} from "../lib/mera.client";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Mera spike · Proofbook" },
    { name: "description", content: "Mera passkey + signing session spike (Monad testnet 10143)" },
  ];
}

type Identity = { address: `0x${string}`; source: "storage" | "passkey" };
type LogLine = { at: string; text: string };

export default function Home() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [session, setSession] = useState<BoundedSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const signCount = useRef(0);

  const note = (text: string) =>
    setLog((l) => [{ at: new Date().toLocaleTimeString(), text }, ...l].slice(0, 30));

  // Client-only: read the public identity cached on this device, if any.
  useEffect(() => {
    const stored = loadIdentity();
    if (stored) setIdentity({ address: stored.address, source: "storage" });
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      note(`${label} failed: ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const onCreate = () =>
    run("Create passkey", async () => {
      const c = await createPasskey();
      c.privateKey.fill(0);
      setIdentity({ address: c.address, source: "passkey" });
      note(`Passkey created. Account ${c.address}`);
    });

  const onLogin = (pinned: boolean) =>
    run("Log in", async () => {
      const c = await assertPasskey(pinned);
      c.privateKey.fill(0);
      if (identity && identity.address !== c.address) {
        note(`WARNING: passkey gave ${c.address}, device had cached ${identity.address}`);
      }
      setIdentity({ address: c.address, source: "passkey" });
      note(`Logged in (${pinned ? "pinned credential" : "any passkey"}). Account ${c.address}`);
    });

  const onStartSession = () =>
    run("Start session", async () => {
      session?.end();
      const c = await assertPasskey(true);
      const s = startBoundedSession(c, (reason) => {
        note(`Session ${reason}`);
        setSession(null);
      });
      setIdentity({ address: s.address, source: "passkey" });
      setSession(s);
      signCount.current = 0;
      note(`Signing session started for ${s.address} (5 min, prefix-scoped messages, 0-value self tx on 10143)`);
    });

  const onSign = () =>
    run("Sign", async () => {
      if (!session) throw new Error("no session");
      signCount.current += 1;
      const message = `${MESSAGE_PREFIX} harmless message #${signCount.current} at ${new Date().toISOString()}`;
      const { signature, valid } = await session.signMessage(message);
      note(`Signed without prompt: "${message}" -> ${signature.slice(0, 18)}… (verifies: ${valid})`);
    });

  const onOutOfScope = () =>
    run("Out-of-scope sign", async () => {
      if (!session) throw new Error("no session");
      await session.signMessage("Transfer everything to 0xdead");
      note("UNEXPECTED: out-of-scope message was signed");
    });

  const onBalance = () =>
    run("Balance", async () => {
      if (!identity) throw new Error("no account");
      const b = await getTestnetBalance(identity.address);
      setBalance(b);
      note(`Testnet balance: ${Number(b) / 1e18} MON`);
    });

  const onTx = () =>
    run("Send tx", async () => {
      if (!session) throw new Error("no session");
      const hash = await session.sendZeroValueSelfTx();
      note(`0-value self tx sent without prompt: ${EXPLORER}/tx/${hash}`);
    });

  const onForget = () => {
    session?.end();
    forgetDevice();
    setIdentity(null);
    setBalance(null);
    note("Device forgotten: storage cleared, session ended. Now 'Log in with any passkey'.");
  };

  const secondsLeft = session ? Math.max(0, Math.round((session.expiresAt - now) / 1000)) : 0;
  const btn =
    "rounded-md px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40";
  const primary =
    "rounded-md px-3 py-2 text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40";

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Mera spike</h1>
        <p className="text-sm text-gray-500">
          Passkey account + bounded signing session on Monad testnet (10143). Spike only: no real funds.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-medium">1. Account</h2>
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={busy} onClick={onCreate}>
            Create passkey
          </button>
          <button className={btn} disabled={busy} onClick={() => onLogin(true)}>
            Log in
          </button>
          <button className={btn} disabled={busy} onClick={() => onLogin(false)}>
            Log in with any passkey
          </button>
        </div>
        <p className="text-sm font-mono break-all" data-testid="address">
          {identity ? (
            <>
              {identity.address}{" "}
              <span className="text-gray-500">
                ({identity.source === "storage" ? "cached on this device, not yet re-derived" : "derived from passkey"})
              </span>
            </>
          ) : (
            <span className="text-gray-500">No account on this device.</span>
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">2. Signing session</h2>
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={busy} onClick={onStartSession}>
            {session ? "Restart session (1 prompt)" : "Start signing session (1 prompt)"}
          </button>
          <button className={btn} disabled={!session} onClick={() => session?.end()}>
            End session
          </button>
        </div>
        <p className="text-sm text-gray-500">
          {session ? `Live, ${secondsLeft}s left. Key is in page memory only.` : "No live session."}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">3. Prompt-free signing</h2>
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={busy || !session} onClick={onSign}>
            Sign harmless message
          </button>
          <button className={btn} disabled={busy || !session} onClick={onOutOfScope}>
            Try out-of-scope message
          </button>
          <button className={btn} disabled={busy || !identity} onClick={onBalance}>
            Check testnet MON
          </button>
          <button className={btn} disabled={busy || !session || !balance} onClick={onTx}>
            Send 0-value self tx
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">4. Stateless test</h2>
        <button className={btn} onClick={onForget}>
          Forget this device (clear storage + end session)
        </button>
      </section>

      <section>
        <h2 className="font-medium mb-2">Log</h2>
        <ol className="text-xs font-mono space-y-1 break-all">
          {log.map((l, i) => (
            <li key={i}>
              <span className="text-gray-500">{l.at}</span> {l.text}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
