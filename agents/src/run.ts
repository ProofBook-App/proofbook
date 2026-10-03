// One run for one house agent: observe → ask Kimi → validate → quote → simulate → (live) sign and send
// → log. Every run writes one agent_decisions row, whatever happens, so the track record has no gaps.
import { getAddress, parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient } from "viem";
import { clientFor, observe, quoteNotional, revertReason, sendError, simulateExecute, type Observation } from "./chain.ts";
import { privySecrets, type Config, type HouseAgent } from "./config.ts";
import { json, logDecision, recordMark, type DecisionRow } from "./db.ts";
import {
  buyPrice,
  CLOSE_LONG,
  CLOSE_SHORT,
  executeCalldata,
  lotsFor,
  marginData,
  notionalOf,
  OPEN_LONG,
  OPEN_SHORT,
  orderData,
  sellPrice,
} from "./perpl.ts";
import { privySignTransaction } from "./privy.ts";
import { askKimi, context, momentum, ruleDecision } from "./strategy.ts";
import { checkOrder, checkProposal, checkQuote, dailyLossHeadroom, fmt, type Checked, type VaultView } from "./validate.ts";

const GAS_HEADROOM_PCT = 105n; // estimate + 5%: Monad charges the whole gas limit
const EXPIRY_BLOCKS = 1_000n;
/** Taker fee is 3.45 bps (docs/reference/perpl.md); keep 10 bps of free margin on top of the notional. */
const FEE_BUFFER_BPS = 10n;

type Planned = { action: string; size?: string; reason: string; data: Hex; intent: string };

export async function runAgent(env: Env, cfg: Config, agent: HouseAgent) {
  const base = { chainId: cfg.chainId, agentId: agent.agentId, mode: cfg.mode };
  const log = async (r: Omit<DecisionRow, "chainId" | "agentId" | "mode">) => {
    const row = { ...base, ...r };
    const id = await logDecision(env.DB, row);
    const summary = { id, agent: agent.agentId, mode: cfg.mode, action: r.action, size: r.size, valid: r.valid, reason: r.reason, tx: r.txHash, error: r.error };
    console.log("decision", json(summary));
    return summary;
  };

  const client = clientFor(cfg.chainId, cfg.rpc);
  let obs: Observation;
  try {
    obs = await observe(client, cfg.chainId, agent);
  } catch (e) {
    return log({ model: "rule", action: "none", valid: false, error: `chain read failed: ${revertReason(e)}` });
  }

  const d = obs.decimals;
  const now = { at: Number(obs.blockTime), mark: obs.market.mark };
  const history = await recordMark(env.DB, cfg.chainId, agent.perpId, now, Number(obs.market.priceDecimals), agent.lookbackMinutes);
  const m = momentum(now, history, agent.lookbackMinutes);
  const view: VaultView = {
    frozen: obs.frozen,
    decimals: d,
    maxTradeNotional: obs.maxTradeNotional,
    nav: obs.nav,
    dayStartNav: obs.dayStartNav,
    dayRolled: obs.dayRolled,
    dailyLossCapBps: obs.dailyLossCapBps,
    position: { side: obs.position.side, lot: obs.position.lot },
    mark: obs.market.mark,
  };
  const headroom = dailyLossHeadroom(view);
  const snapshot = context(obs, m, headroom);
  const detail: Record<string, unknown> = {
    block: obs.block,
    sessionKey: obs.sessionKey,
    snapshot,
    momentum: m,
    rule: ruleDecision(m, obs.position.side, agent),
  };

  if (obs.frozen) {
    return log({ model: "rule", action: "stop", valid: false, reason: "The vault is frozen, so this agent does not trade.", error: "vault is frozen", detail });
  }

  // ---- decide
  let plan: Planned;
  let model = "rule";
  let prompt: unknown;
  let response: unknown;
  if (obs.accountId === 0n) {
    // No Perpl account yet: the first margin move opens it. A fixed step, not a model decision.
    const amount = obs.minOpen;
    if (amount > obs.idle || amount > obs.maxTradeNotional) {
      return log({ model, action: "deposit_margin", size: fmt(amount, d), valid: false, error: `opening a Perpl account needs ${fmt(amount, d)} AUSD; idle ${fmt(obs.idle, d)}, max trade ${fmt(obs.maxTradeNotional, d)}`, detail });
    }
    plan = {
      action: "deposit_margin",
      size: fmt(amount, d),
      reason: `No Perpl account yet, so ${fmt(amount, d)} AUSD of margin moves in to open one.`,
      data: marginData(amount),
      intent: `move ${fmt(amount, d)} AUSD margin into Perpl`,
    };
  } else {
    model = cfg.model;
    let kimi;
    try {
      kimi = await askKimi(env.AI, cfg.model, agent, snapshot);
    } catch (e) {
      return log({ model, action: "none", valid: false, error: `model call failed: ${e instanceof Error ? e.message : String(e)}`, detail });
    }
    prompt = kimi.messages;
    response = kimi.response;
    detail.modelMs = kimi.ms;
    detail.proposal = kimi.proposal;
    const p = kimi.proposal;
    const size = typeof p.sizeAusd === "number" || typeof p.sizeAusd === "string" ? String(p.sizeAusd) : null;
    const reason = typeof p.reason === "string" ? p.reason : null;
    const reject = (error: string) => log({ model, prompt, response, action: p.action, size, valid: false, reason, error, detail });

    const checked = checkProposal(p, view, { maxSizeAusd: agent.maxSizeAusd });
    if (!checked.ok) return reject(checked.error);
    if (checked.value.action === "hold") {
      return log({ model, prompt, response, action: "hold", valid: true, reason: checked.value.reason, detail });
    }

    const built = buildOrder(checked.value, obs, agent);
    if ("error" in built) return reject(built.error);
    const order = checkOrder(built.order, view);
    if (!order.ok) return reject(order.error);
    detail.order = order.value;

    const opens = built.order.orderType === OPEN_LONG || built.order.orderType === OPEN_SHORT;
    const need = built.order.notional + (built.order.notional * FEE_BUFFER_BPS) / 10_000n;
    if (opens && obs.freeMargin < need) {
      // Not enough free margin on Perpl for this open: this run moves the shortfall in instead
      // (rounded up to a whole AUSD); the next run can open if the signal still holds.
      const unit = 10n ** BigInt(d);
      const amount = ((need - obs.freeMargin + unit - 1n) / unit) * unit;
      if (amount > obs.idle || amount > obs.maxTradeNotional) {
        return reject(`free Perpl margin ${fmt(obs.freeMargin, d)} is short of ${fmt(need, d)} and the vault has ${fmt(obs.idle, d)} idle`);
      }
      detail.deferred = { action: p.action, size, reason };
      plan = {
        action: "deposit_margin",
        size: fmt(amount, d),
        reason: `Kimi proposed ${p.action} ${size} AUSD; free Perpl margin is ${fmt(obs.freeMargin, d)} AUSD, so ${fmt(amount, d)} AUSD moves in first.`,
        data: marginData(amount),
        intent: `move ${fmt(amount, d)} AUSD margin into Perpl`,
      };
    } else {
      plan = {
        action: p.action,
        size: checked.value.action === "close" ? undefined : fmt(checked.value.sizeCNS, d),
        reason: checked.value.reason,
        data: built.data,
        intent: built.intent,
      };
    }
  }

  detail.intent = plan.intent;
  const fail = (error: string) =>
    log({ model, prompt, response, action: plan.action, size: plan.size, valid: false, reason: plan.reason, error, detail });

  // ---- check against the adapter's own quote, then simulate from the signer
  let quoted: bigint;
  try {
    quoted = await quoteNotional(client, obs.adapter, plan.data);
  } catch (e) {
    return fail(`adapter quote reverted: ${revertReason(e)}`);
  }
  detail.quotedNotional = fmt(quoted, d);
  const q = checkQuote(quoted, view);
  if (!q.ok) return fail(q.error);

  let from: Address = obs.sessionKey;
  if (cfg.mode === "live") {
    if (!agent.privyWalletId || !agent.privyWalletAddress) return fail("live mode but no Privy wallet configured for this agent");
    if (agent.privyWalletAddress.toLowerCase() !== obs.sessionKey.toLowerCase()) {
      return fail(`Privy wallet ${agent.privyWalletAddress} is not the vault's session key ${obs.sessionKey}`);
    }
    from = agent.privyWalletAddress;
  }
  const revert = await simulateExecute(client, from, obs.vault, obs.adapter, plan.data);
  detail.simulatedFrom = from;
  detail.calldata = executeCalldata(obs.adapter, plan.data);
  if (revert) return fail(`simulation of vault.execute reverted: ${revert}`);
  detail.simulated = "ok";

  if (cfg.mode === "dry-run") {
    return log({ model, prompt, response, action: plan.action, size: plan.size, valid: true, reason: plan.reason, detail });
  }

  // ---- live: sign with Privy (its policy runs first), broadcast through our RPC
  try {
    const sent = await signAndSend(env, client, cfg, agent, from, obs.vault, detail.calldata as Hex);
    detail.gas = sent.gas;
    detail.status = sent.status;
    return log({
      model,
      prompt,
      response,
      action: plan.action,
      size: plan.size,
      valid: true,
      reason: plan.reason,
      txHash: sent.hash,
      error: sent.status === "success" ? null : `transaction ${sent.status} onchain`,
      detail,
    });
  } catch (e) {
    return fail(`send failed: ${sendError(e)}`);
  }
}

type Built = { error: string } | { order: { orderType: number; pricePNS: bigint; lotLNS: bigint; notional: bigint }; data: Hex; intent: string };

function buildOrder(c: Exclude<Checked, { action: "hold" }>, obs: Observation, agent: HouseAgent): Built {
  const m = obs.market;
  const d = obs.decimals;
  let orderType: number;
  let lot: bigint;
  if (c.action === "close") {
    orderType = obs.position.side === "long" ? CLOSE_LONG : CLOSE_SHORT;
    lot = obs.position.lot;
  } else {
    orderType = c.action === "open_long" ? OPEN_LONG : OPEN_SHORT;
    lot = lotsFor(c.sizeCNS, m, d);
    if (lot === 0n) return { error: `${fmt(c.sizeCNS, d)} AUSD buys less than one lot` };
  }
  const isBuy = orderType === OPEN_LONG || orderType === CLOSE_SHORT;
  const price = isBuy ? buyPrice(m) : sellPrice(m);
  const notional = notionalOf(lot, price > m.mark ? price : m.mark, m, d);
  const data = orderData({ perpId: agent.perpId, orderType, pricePNS: price, lotLNS: lot, expiryBlock: obs.block + EXPIRY_BLOCKS });
  const verb = ["open a long", "open a short", "close the long", "close the short"][orderType] ?? "order";
  return { order: { orderType, pricePNS: price, lotLNS: lot, notional }, data, intent: `${verb} of ${lot} lots (IOC, 1x)` };
}

async function signAndSend(env: Env, client: PublicClient, cfg: Config, agent: HouseAgent, from: Address, vault: Address, data: Hex) {
  const secrets = privySecrets(env);
  const estimate = await client.estimateGas({ account: from, to: vault, data, value: 0n });
  const gas = (estimate * GAS_HEADROOM_PCT) / 100n;
  const [fees, nonce] = await Promise.all([client.estimateFeesPerGas(), client.getTransactionCount({ address: from, blockTag: "pending" })]);
  const signed = await privySignTransaction(secrets, agent.privyWalletId!, {
    type: 2,
    chain_id: cfg.chainId,
    to: vault,
    value: "0x0",
    data,
    nonce,
    gas_limit: Number(gas),
    max_fee_per_gas: `0x${fees.maxFeePerGas.toString(16)}`,
    max_priority_fee_per_gas: `0x${fees.maxPriorityFeePerGas.toString(16)}`,
  });

  // Check what Privy signed before it goes out: same signer, target, data, chain, value and gas.
  const tx = parseTransaction(signed);
  const signer = await recoverTransactionAddress({ serializedTransaction: signed as never });
  const problems = [
    getAddress(signer) !== getAddress(from) && `signer ${signer}`,
    (!tx.to || getAddress(tx.to) !== getAddress(vault)) && `to ${tx.to}`,
    tx.data?.toLowerCase() !== data.toLowerCase() && "data",
    tx.chainId !== cfg.chainId && `chain ${tx.chainId}`,
    (tx.value ?? 0n) !== 0n && `value ${tx.value}`,
    tx.gas !== gas && `gas ${tx.gas}`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`Privy returned a different transaction (${problems.join(", ")}); not broadcast`);

  const hash = await client.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
  return { hash, status: receipt.status, gas: { estimate: estimate.toString(), limit: gas.toString(), used: receipt.gasUsed.toString() } };
}
