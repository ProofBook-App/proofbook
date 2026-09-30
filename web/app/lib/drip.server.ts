// Testnet start-up funds for a new backer account. A Mera passkey account is a fresh EOA with no
// MON, so it can't pay gas for its first approve and deposit (docs/open-questions.md, "Backer gas").
// On testnet the drip wallet sends a little MON and asks Agora's faucet for 10,000 AUSD on the
// backer's behalf, so the first deposit needs no other site.
//
// Testnet only: it refuses on any other chain, and it's off unless the DRIP_PK secret is set.
// The key is a throwaway testnet wallet, never the deployer or a mainnet key.

import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseAbi, parseEther, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ausdFaucet } from "./chains";
import { chainFor } from "./chain";

const TESTNET = 10143;
const MON_DRIP = parseEther("0.5"); // about 10 deposit-and-withdraw rounds at testnet gas prices
const MON_ENOUGH = parseEther("0.2"); // skip the MON if the account already has this much
const AUSD_ENOUGH = 1_000_000_000n; // 1,000 AUSD (6 dp): skip the faucet above this
const DRIP_RESERVE = parseEther("11"); // Monad keeps 10 MON in every EOA; stop before that
const PER_ADDRESS_PER_DAY = 1;
const PER_IP_PER_DAY = 5;

const abi = parseAbi(["function requestFunds(address recipient)", "function balanceOf(address) view returns (uint256)"]);

export type DripResult =
  | { ok: true; address: string; monTx: Hash | null; ausdTx: Hash | null }
  | { ok: false; status: number; error: string };

export function dripEnabled(env: Env) {
  return Number(env.CHAIN_ID) === TESTNET && Boolean((env as DripEnv).DRIP_PK);
}

type DripEnv = Env & { DRIP_PK?: string };

export async function drip(env: Env, rawAddress: unknown, ip: string | null, asset: string): Promise<DripResult> {
  const chainId = Number(env.CHAIN_ID);
  const pk = (env as DripEnv).DRIP_PK;
  if (chainId !== TESTNET || !pk) return { ok: false, status: 404, error: "Test funds are only available on Monad testnet." };
  if (typeof rawAddress !== "string" || !isAddress(rawAddress)) {
    return { ok: false, status: 400, error: "That isn't an account address." };
  }
  const address = getAddress(rawAddress);

  const dayAgo = Math.floor(Date.now() / 1000) - 86_400;
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM drips WHERE chain_id = ?1 AND address = ?2 AND at > ?3) AS by_address,
       (SELECT COUNT(*) FROM drips WHERE ip = ?4 AND at > ?3) AS by_ip`,
  )
    .bind(chainId, address.toLowerCase(), dayAgo, ip)
    .first<{ by_address: number; by_ip: number }>();
  if ((counts?.by_address ?? 0) >= PER_ADDRESS_PER_DAY) {
    return { ok: false, status: 429, error: "This account already got test funds today." };
  }
  if (ip && (counts?.by_ip ?? 0) >= PER_IP_PER_DAY) {
    return { ok: false, status: 429, error: "Too many test-fund requests from this network today." };
  }

  const chain = chainFor(chainId);
  const client = createPublicClient({ chain, transport: http() });
  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const faucet = ausdFaucet(chainId) as `0x${string}`;

  const [mon, ausd, dripBalance] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: asset as `0x${string}`, abi, functionName: "balanceOf", args: [address] }),
    client.getBalance({ address: account.address }),
  ]);
  const needMon = mon < MON_ENOUGH;
  const needAusd = ausd < AUSD_ENOUGH;
  if (!needMon && !needAusd) return { ok: true, address, monTx: null, ausdTx: null };
  if (needMon && dripBalance < DRIP_RESERVE + MON_DRIP) {
    console.error("drip wallet low", account.address, dripBalance.toString());
    return { ok: false, status: 503, error: "The test-funds wallet is empty. Use the Monad faucet for now." };
  }

  // Record first, so two quick requests can't both pass the limit check.
  const row = await env.DB.prepare(`INSERT INTO drips (chain_id, address, ip) VALUES (?1, ?2, ?3) RETURNING id`)
    .bind(chainId, address.toLowerCase(), ip)
    .first<{ id: number }>();

  let monTx: Hash | null = null;
  let ausdTx: Hash | null = null;
  try {
    // Explicit gas limits: Monad charges the limit, and these two calls have fixed costs.
    if (needMon) monTx = await wallet.sendTransaction({ to: address, value: MON_DRIP, gas: 21_000n });
    if (needAusd) {
      const gas = await client.estimateContractGas({ account, address: faucet, abi, functionName: "requestFunds", args: [address] });
      ausdTx = await wallet.writeContract({ address: faucet, abi, functionName: "requestFunds", args: [address], gas: gas + gas / 20n });
    }
    const receipts = await Promise.all(
      [monTx, ausdTx].filter((h): h is Hash => h !== null).map((hash) => client.waitForTransactionReceipt({ hash })),
    );
    if (receipts.some((r) => r.status !== "success")) throw new Error("drip tx reverted");
  } catch (err) {
    console.error("drip failed", address, err);
    // Nothing landed: free the slot so the backer can try again.
    if (!monTx && !ausdTx) await env.DB.prepare(`DELETE FROM drips WHERE id = ?1`).bind(row?.id).run();
    return { ok: false, status: 502, error: "Sending test funds failed. Try again in a minute." };
  } finally {
    if (monTx || ausdTx) {
      await env.DB.prepare(`UPDATE drips SET mon_tx = ?2, ausd_tx = ?3 WHERE id = ?1`).bind(row?.id, monTx, ausdTx).run();
    }
  }
  return { ok: true, address, monTx, ausdTx };
}
