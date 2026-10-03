// Testnet start-up funds for a new backer account. A Mera passkey account is a fresh EOA with no
// MON, so it can't pay gas for its first approve and deposit (docs/open-questions.md, "Backer gas").
// On testnet the drip wallet sends a little MON and asks Agora's faucet for 10,000 AUSD on the
// backer's behalf, so the first deposit needs no other site.
//
// Testnet only: it refuses on any other chain, and it's off unless the DRIP_PK secret is set.
// The key is a throwaway testnet wallet, never the deployer or a mainnet key.

import { createPublicClient, createWalletClient, fallback, getAddress, http, isAddress, parseAbi, parseEther, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ausdAddress, ausdFaucet } from "./chains";
import { chainFor } from "./chain";

const TESTNET = 10143;
const MON_DRIP = parseEther("0.5"); // about 10 deposit-and-withdraw rounds at testnet gas prices
const MON_ENOUGH = parseEther("0.2"); // skip the MON if the account already has this much
const AUSD_ENOUGH = 1_000_000_000n; // 1,000 AUSD (6 dp): skip the faucet above this
const DRIP_RESERVE = parseEther("11"); // Monad keeps 10 MON in every EOA; stop before that
const PER_ADDRESS_PER_DAY = 1;
const PER_IP_PER_DAY = 5;

const STOCK_TARGET = 30_000_000_000n; // AUSD the drip wallet keeps for when the faucet is busy
const AUSD_DRIP = 10_000_000_000n; // 10,000 AUSD: what the faucet gives, and the fallback transfer

const abi = parseAbi([
  "function requestFunds(address recipient)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "error MaxFrequencyExceeded()", // Agora's faucet: one claim a minute across all callers
]);

export type DripResult =
  | { ok: true; address: string; monTx: Hash | null; ausdTx: Hash | null; notice?: string }
  | { ok: false; status: number; error: string };

export function dripEnabled(env: Env) {
  return Number(env.CHAIN_ID) === TESTNET && Boolean((env as DripEnv).DRIP_PK);
}

type DripEnv = Env & { DRIP_PK?: string; ALCHEMY_RPC_URL?: string };

// Alchemy first when its secret is set, then the chain's public RPC.
function transport(env: Env) {
  const alchemy = (env as DripEnv).ALCHEMY_RPC_URL;
  return alchemy ? fallback([http(alchemy), http()]) : http();
}

export async function drip(env: Env, rawAddress: unknown, ip: string | null, asset: string): Promise<DripResult> {
  const chainId = Number(env.CHAIN_ID);
  const pk = (env as DripEnv).DRIP_PK;
  if (chainId !== TESTNET || !pk) return { ok: false, status: 404, error: "Test funds are only available on Monad testnet." };
  if (typeof rawAddress !== "string" || !isAddress(rawAddress)) {
    return { ok: false, status: 400, error: "That isn't an account address." };
  }
  const address = getAddress(rawAddress);

  // Limits are per part: a backer whose AUSD claim failed can come back for it without getting MON
  // twice. A part counts once it's claimed ('pending'), so two quick requests can't both pass.
  const dayAgo = Math.floor(Date.now() / 1000) - 86_400;
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM drips WHERE chain_id = ?1 AND address = ?2 AND at > ?3 AND mon_tx IS NOT NULL) AS mon,
       (SELECT COUNT(*) FROM drips WHERE chain_id = ?1 AND address = ?2 AND at > ?3 AND ausd_tx IS NOT NULL) AS ausd,
       (SELECT COUNT(*) FROM drips WHERE ip = ?4 AND at > ?3) AS by_ip`,
  )
    .bind(chainId, address.toLowerCase(), dayAgo, ip)
    .first<{ mon: number; ausd: number; by_ip: number }>();
  if (ip && (counts?.by_ip ?? 0) >= PER_IP_PER_DAY) {
    return { ok: false, status: 429, error: "Too many test-fund requests from this network today." };
  }

  const chain = chainFor(chainId);
  const client = createPublicClient({ chain, transport: transport(env) });
  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: transport(env) });
  const faucet = ausdFaucet(chainId) as `0x${string}`;

  const [mon, ausd, dripBalance] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: asset as `0x${string}`, abi, functionName: "balanceOf", args: [address] }),
    client.getBalance({ address: account.address }),
  ]);
  const lowMon = mon < MON_ENOUGH;
  const lowAusd = ausd < AUSD_ENOUGH;
  const needMon = lowMon && (counts?.mon ?? 0) < PER_ADDRESS_PER_DAY;
  const needAusd = lowAusd && (counts?.ausd ?? 0) < PER_ADDRESS_PER_DAY;
  if (!needMon && !needAusd) {
    if (lowMon || lowAusd) return { ok: false, status: 429, error: "This account already got test funds today." };
    return { ok: true, address, monTx: null, ausdTx: null };
  }
  if (needMon && dripBalance < DRIP_RESERVE + MON_DRIP) {
    console.error("drip wallet low", account.address, dripBalance.toString());
    return { ok: false, status: 503, error: "The test-funds wallet is empty. Use the Monad faucet for now." };
  }

  const row = await env.DB.prepare(`INSERT INTO drips (chain_id, address, ip, mon_tx, ausd_tx) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
    .bind(chainId, address.toLowerCase(), ip, needMon ? "pending" : null, needAusd ? "pending" : null)
    .first<{ id: number }>();

  // Each part on its own, so a busy faucet doesn't cost the backer their gas. Explicit gas limits:
  // Monad charges the limit, not the gas used.
  let monTx: Hash | null = null;
  let ausdTx: Hash | null = null;
  let notice: string | undefined;
  if (needMon) {
    try {
      monTx = await wallet.sendTransaction({ to: address, value: MON_DRIP, gas: 21_000n });
      if ((await client.waitForTransactionReceipt({ hash: monTx })).status !== "success") throw new Error("MON drip reverted");
    } catch (err) {
      console.error("drip MON failed", address, err);
      monTx = null;
    }
  }
  if (needAusd) {
    try {
      const gas = await client.estimateContractGas({ account, address: faucet, abi, functionName: "requestFunds", args: [address] });
      ausdTx = await wallet.writeContract({ address: faucet, abi, functionName: "requestFunds", args: [address], gas: gas + gas / 20n });
      if ((await client.waitForTransactionReceipt({ hash: ausdTx })).status !== "success") throw new Error("faucet reverted");
    } catch (err) {
      // Agora's faucet allows one claim a minute across everyone, so it's usually just busy. Fall
      // back to the drip wallet's own AUSD stock (topped up from the same faucet).
      console.error("drip AUSD from faucet failed", address, err);
      ausdTx = null;
      try {
        const token = asset as `0x${string}`;
        const stock = await client.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address] });
        if (stock < AUSD_DRIP) throw new Error(`drip wallet AUSD stock low: ${stock}`);
        const gas = await client.estimateContractGas({ account, address: token, abi, functionName: "transfer", args: [address, AUSD_DRIP] });
        ausdTx = await wallet.writeContract({ address: token, abi, functionName: "transfer", args: [address, AUSD_DRIP], gas: gas + gas / 20n });
        if ((await client.waitForTransactionReceipt({ hash: ausdTx })).status !== "success") throw new Error("AUSD transfer reverted");
      } catch (err2) {
        console.error("drip AUSD fallback failed", address, err2);
        ausdTx = null;
        notice = "The AUSD faucet allows one claim a minute across everyone. Try again in a minute for the AUSD.";
      }
    }
  }

  if (!monTx && !ausdTx) {
    await env.DB.prepare(`DELETE FROM drips WHERE id = ?1`).bind(row?.id).run();
    return { ok: false, status: 502, error: notice ?? "Sending test funds failed. Try again in a minute." };
  }
  await env.DB.prepare(`UPDATE drips SET mon_tx = ?2, ausd_tx = ?3 WHERE id = ?1`).bind(row?.id, monTx, ausdTx).run();
  return { ok: true, address, monTx, ausdTx, ...(notice ? { notice } : {}) };
}

/** Cron: top the drip wallet's AUSD stock back up, one faucet claim per run (the faucet's limit). */
export async function restockDrip(env: Env) {
  const chainId = Number(env.CHAIN_ID);
  const pk = (env as DripEnv).DRIP_PK;
  const token = ausdAddress(chainId) as `0x${string}` | undefined;
  if (chainId !== TESTNET || !pk || !token) return null;
  const chain = chainFor(chainId);
  const client = createPublicClient({ chain, transport: transport(env) });
  const account = privateKeyToAccount(pk as `0x${string}`);
  const stock = await client.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address] });
  if (stock >= STOCK_TARGET) return { stock: stock.toString(), claimed: null };
  const faucet = ausdFaucet(chainId) as `0x${string}`;
  const wallet = createWalletClient({ account, chain, transport: transport(env) });
  try {
    const gas = await client.estimateContractGas({ account, address: faucet, abi, functionName: "requestFunds", args: [account.address] });
    const hash = await wallet.writeContract({ address: faucet, abi, functionName: "requestFunds", args: [account.address], gas: gas + gas / 20n });
    return { stock: stock.toString(), claimed: hash };
  } catch {
    return { stock: stock.toString(), claimed: null }; // faucet busy: next minute
  }
}
