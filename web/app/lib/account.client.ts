// The backer's account for the whole tab: who they are on this device, and the signing session if
// it's unlocked. Browser only. One unlock covers every agent page and the portfolio as long as the
// app navigates client-side; a reload or leaving the site ends it, because the key lives only in
// memory.

import { useSyncExternalStore } from "react";
import type { Address } from "viem";
import { forgetDevice, loadIdentity, unlock, type Identity, type Session, type VaultRef } from "./backer.client";

export type Account = {
  identity: Identity | undefined;
  session: Session | null;
  ended: string | null; // why the last session ended, until the next unlock
};

const SERVER: Account = { identity: undefined, session: null, ended: null };
let state: Account | null = null;
const listeners = new Set<() => void>();

function current(): Account {
  state ??= { identity: loadIdentity(), session: null, ended: null };
  return state;
}

function set(patch: Partial<Account>) {
  state = { ...current(), ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAccount(): Account {
  return useSyncExternalStore(subscribe, current, () => SERVER);
}

export function accountAddress(a: Account): Address | undefined {
  return a.session?.address ?? a.identity?.address;
}

let leaveHooked = false;

/**
 * One passkey prompt: create or log in, and start a session that can sign for every agent vault on
 * this chain. `known` adds vaults the page already has, in case the list can't be fetched.
 */
export async function unlockAccount(how: "create" | "login", chainId: number, known: VaultRef[] = []) {
  const vaults = new Map(known.map((r) => [r.vault.toLowerCase(), r]));
  try {
    const res = await fetch("/api/leaderboard");
    const board = (await res.json()) as { chainId: number; agents: { vault: Address; asset: Address }[] };
    if (board.chainId === chainId) for (const a of board.agents) vaults.set(a.vault.toLowerCase(), { vault: a.vault, asset: a.asset });
  } catch {
    // The page's own vault still works.
  }
  if (vaults.size === 0) throw new Error("Couldn't load the agent list. Try again.");

  current().session?.end("You unlocked again");
  const session = await unlock(how, { chainId, vaults: [...vaults.values()] }, (reason) => {
    if (current().session === session) set({ session: null, ended: reason });
  });
  set({ session, identity: loadIdentity(), ended: null });

  if (!leaveHooked) {
    leaveHooked = true;
    window.addEventListener("pagehide", () => current().session?.end("You left the page"));
  }
  return session;
}

export function lockAccount() {
  current().session?.end();
}

export function forgetAccount() {
  current().session?.end();
  forgetDevice();
  set({ identity: undefined, session: null, ended: null });
}
