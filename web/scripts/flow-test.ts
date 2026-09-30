// Node check of the backer flow (app/lib/backer.client.ts) against Monad testnet, with a raw test key
// standing in for the passkey-derived one. TESTNET ONLY. Usage:
//   FLOW_TEST_KEY_FILE=path/to/key npx tsx scripts/flow-test.ts
// The key file holds a throwaway testnet key with a little MON. It deposits 25 AUSD into house
// agent #1's vault, withdraws 5, redeems the rest, and checks the session refuses out-of-scope calls.
import { readFileSync } from "node:fs";
import { maxUint256 } from "viem";
import { explain, readPosition, startSession, type Scope } from "../app/lib/backer.client";

const scope: Scope = {
  chainId: 10143,
  vault: "0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53",
  asset: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
};
const hex = readFileSync(process.env.FLOW_TEST_KEY_FILE!, "utf8").trim().replace(/^0x/, "");
const key = Uint8Array.from(Buffer.from(hex, "hex"));
const s = startSession(key, scope, (reason) => console.log("ended:", reason));
const show = async (label: string) => {
  const p = await readPosition(scope, s.address);
  console.log(label, { mon: p.mon, wallet: p.wallet, allowance: p.allowance, shares: p.shares, value: p.value, maxWithdraw: p.maxWithdraw, maxDeposit: p.maxDeposit });
  return p;
};
const step = async (label: string, f: () => Promise<string>) => console.log(label, await f());

console.log("key zeroed:", key.every((b) => b === 0), "address", s.address);
let p = await show("start");
if (p.wallet < 25_000_000n) await step("faucet", () => s.requestAusd());
await step("approve", () => s.approve(25_000_000n));
await step("deposit", () => s.deposit(25_000_000n));
await show("after deposit");
await step("withdraw 5", () => s.withdraw(5_000_000n));
await show("after withdraw");
await step("redeem all", () => s.redeemAll());
p = await show("after redeem");
if (p.shares !== 0n) throw new Error("shares left after redeemAll");

// Scope: an unlimited approval must be refused before signing.
try {
  await s.approve(maxUint256);
  throw new Error("unlimited approve was signed");
} catch (e) {
  console.log("unlimited approve refused:", explain(e));
}
// Over the cap: the simulation catches it and nothing is sent.
try {
  await s.deposit(10_000_000_000n);
  throw new Error("over-cap deposit went through");
} catch (e) {
  console.log("over-cap deposit:", explain(e));
}
s.end();
try {
  await s.deposit(1n);
  throw new Error("signed after end");
} catch (e) {
  console.log("after end:", explain(e));
}
