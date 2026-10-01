// The run loop: a deliberately simple, explainable agent that trades its vault through the session key.
//
// Strategy (momentum on Perpl's MON mark, 1x, long-only):
//   - no Perpl account yet           -> move margin into Perpl (DEPOSIT; the first one opens the account)
//   - flat and mark rose >= threshold -> open a long of --size
//   - long and mark fell >= threshold -> close the whole long
//   - otherwise                       -> hold
// The first tick has no previous mark, so it only records one. `--action` forces a single action
// (deposit | long | close) for demos and tests; it goes through the same checks.
//
// Every proposed action is checked off-chain before signing: the vault must not be frozen, the
// signer must be the session key, the adapter's own quote must fit maxTradeNotional, and an
// eth_call of vault.execute must succeed. The vault enforces the same rules again onchain.
// Every step is logged (observation, decision, reason, tx hash): that log is the track record.
import { formatUnits, parseUnits, type Address } from "viem";
import { CLOSE_LONG, OPEN_LONG, Proofbook } from "./proofbook.js";

export type Action = "auto" | "deposit" | "long" | "close";

export type RunOptions = {
  agentId: bigint;
  dryRun: boolean;
  action: Action;
  /** Long size in vault asset units (decimal string), e.g. "10". */
  size: string;
  /** Margin to move into Perpl when there is no account yet; raised to Perpl's minimum account open. */
  margin?: string;
  /** Momentum threshold in basis points of mark. */
  thresholdBps: number;
};

export type StepState = { lastMark?: bigint };

export async function runStep(pb: Proofbook, o: RunOptions, state: StepState) {
  const obs = await pb.observe(o.agentId);
  const fmt = (x: bigint) => formatUnits(x, obs.decimals);
  const m = obs.market;
  const price = (x: bigint) => formatUnits(x, Number(m.priceDecimals));
  const observation = {
    vault: obs.vault,
    frozen: obs.frozen,
    idle: fmt(obs.idle),
    perplAccount: obs.accountId.toString(),
    mark: price(m.mark),
    bid: price(m.bid),
    ask: price(m.ask),
    position: obs.position
      ? { side: obs.position.lot === 0n ? "flat" : obs.position.type === 0 ? "long" : "short", lots: obs.position.lot.toString() }
      : { side: "flat", lots: "0" },
  };
  const result = (decision: string, reason: string, extra: Record<string, unknown> = {}) => ({
    agentId: o.agentId.toString(),
    block: obs.block.toString(),
    dryRun: o.dryRun,
    observation,
    decision,
    reason,
    ...extra,
  });

  if (obs.frozen) return { ...result("stop", "vault is frozen"), stop: true };

  const prev = state.lastMark;
  state.lastMark = m.mark;
  const changeBps = prev && prev > 0n ? Number(((m.mark - prev) * 10_000n) / prev) : undefined;
  const long = obs.position && obs.position.lot > 0n && obs.position.type === 0 ? obs.position.lot : 0n;
  const short = obs.position && obs.position.lot > 0n && obs.position.type === 1;

  // ---- decide
  let decision: "deposit" | "long" | "close" | "hold" = "hold";
  let reason = "";
  if (o.action !== "auto") {
    decision = o.action;
    reason = `forced with --action ${o.action}`;
  } else if (obs.accountId === 0n) {
    decision = "deposit";
    reason = "no Perpl account yet: move margin in first";
  } else if (short) {
    reason = "holding a short this agent did not open: leave it to the owner";
  } else if (changeBps === undefined) {
    reason = "first observation: recording the mark";
  } else if (long === 0n && changeBps >= o.thresholdBps) {
    decision = "long";
    reason = `mark up ${changeBps} bps since the last tick (threshold ${o.thresholdBps})`;
  } else if (long > 0n && changeBps <= -o.thresholdBps) {
    decision = "close";
    reason = `mark down ${-changeBps} bps since the last tick (threshold ${o.thresholdBps})`;
  } else {
    reason = `mark moved ${changeBps} bps: below the ${o.thresholdBps} bps threshold or no matching position`;
  }
  if (decision === "hold") return result("hold", reason, { changeBps });

  // ---- build
  let data;
  let intent;
  if (decision === "deposit") {
    const want = o.margin ? parseUnits(o.margin, obs.decimals) : obs.minOpen;
    const amount = obs.accountId === 0n && want < obs.minOpen ? obs.minOpen : want;
    if (amount > obs.idle) return result("hold", `${reason}, but the vault holds only ${fmt(obs.idle)} idle (need ${fmt(amount)})`);
    data = Proofbook.marginData(amount);
    intent = `Proofbook agent #${o.agentId}: move ${fmt(amount)} margin into Perpl`;
  } else if (decision === "long") {
    const sizeCNS = parseUnits(o.size, obs.decimals);
    const scale = 10n ** (m.priceDecimals + m.lotDecimals);
    const lot = (sizeCNS * scale) / (m.mark * 10n ** BigInt(obs.decimals));
    if (lot === 0n) return result("hold", `${reason}, but ${o.size} buys less than one lot`);
    data = Proofbook.orderData({
      perpId: pb.network.monPerpId,
      orderType: OPEN_LONG,
      pricePNS: Proofbook.longPrice(m),
      lotLNS: lot,
      expiryBlock: obs.block + 1_000n,
    });
    intent = `Proofbook agent #${o.agentId}: open a ${lot}-lot MON long on Perpl (IOC, 1x)`;
  } else {
    if (long === 0n) return result("hold", `${reason}, but there is no long to close`);
    data = Proofbook.orderData({
      perpId: pb.network.monPerpId,
      orderType: CLOSE_LONG,
      pricePNS: Proofbook.closePrice(m),
      lotLNS: long,
      expiryBlock: obs.block + 1_000n,
    });
    intent = `Proofbook agent #${o.agentId}: close the ${long}-lot MON long on Perpl (IOC)`;
  }

  // ---- check
  const notional = await pb.quote(obs.adapter, data);
  const checks = { notional: fmt(notional), maxTradeNotional: fmt(obs.maxTrade) };
  if (notional > obs.maxTrade) {
    return result("rejected", `${reason}; notional ${fmt(notional)} is above maxTradeNotional ${fmt(obs.maxTrade)}`, { checks });
  }
  if (!o.dryRun) {
    const me = (await pb.signer!.address()) as Address;
    if (me.toLowerCase() !== obs.sessionKey.toLowerCase()) {
      return result("rejected", `${reason}; signer ${me} is not the session key ${obs.sessionKey}`, { checks });
    }
  }
  const revert = await pb.simulateExecute(obs.vault, obs.sessionKey, obs.adapter, data);
  if (revert) return result("rejected", `${reason}; simulation of vault.execute reverted: ${revert}`, { checks, intent });

  if (o.dryRun) return result(decision, reason, { checks, intent, calldata: data, simulated: "ok", sent: false });

  // ---- act
  const r = await pb.execute(o.agentId, obs.vault, obs.adapter, data, intent);
  return result(decision, reason, {
    checks,
    intent,
    simulated: "ok",
    sent: true,
    tx: r.sent,
    navBefore: r.navBefore !== undefined ? fmt(r.navBefore) : undefined,
    navAfter: r.navAfter !== undefined ? fmt(r.navAfter) : undefined,
    froze: r.froze,
    stop: r.froze,
  });
}
