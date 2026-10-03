// Proofbook agent actions: create, fund, freeze, status and one step of the run loop.
// Every write is simulated first (eth_call from the signer's address), then sent with an explicit
// gas limit of estimate + 5%, because Monad charges the whole gas limit, not the gas used.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {
  adapterCallParams,
  erc20Abi,
  factoryAbi,
  faucetAbi,
  identityAbi,
  orderDescParams,
  perplAdapterAbi,
  perplExchangeAbi,
  registryAbi,
  vaultAbi,
} from "./abi.js";
import { perplAdapterBytecode } from "./artifacts/PerplAdapter.js";
import { chainOf, requireRegistry, txUrl, type Network } from "./networks.js";
import type { Signer } from "./signer.js";

export type LogFn = (event: Record<string, unknown>) => void;

export type Sent = { step: string; hash: Hash; url: string; gasLimit: string; gasUsed: string };

/** PerplAdapter actions (contracts/src/adapters/PerplAdapter.sol). */
export const DEPOSIT = 0;
export const WITHDRAW = 1;
export const ORDER = 2;
/** Perpl order types (docs/reference/perpl.md). */
export const OPEN_LONG = 0;
export const CLOSE_LONG = 2;

const GAS_HEADROOM_BPS = 10_500n; // estimate + 5%
const BAND_BPS = 300n; // PerplAdapter.BAND_BPS: limits must be within 3% of mark

export class Proofbook {
  readonly client: PublicClient;
  readonly registry: Address;

  constructor(
    readonly network: Network,
    readonly signer?: Signer,
    readonly log: LogFn = () => {},
    registry?: Address,
  ) {
    // Public RPCs rate-limit (testnet: 15 requests/s), so reads fold into Multicall3 and retry.
    this.client = createPublicClient({
      chain: chainOf(network),
      transport: http(network.rpc, { retryCount: 5, retryDelay: 400 }),
      batch: { multicall: true },
    }) as PublicClient;
    this.registry = registry ?? requireRegistry(network);
  }

  // ------------------------------------------------------------------ writes

  #signer(): Signer {
    if (!this.signer) throw new Error("This command sends transactions: pass --signer mm or --signer env.");
    return this.signer;
  }

  /** Simulate, estimate, send with estimate + 5%, wait for the receipt. Reverts never reach the chain. */
  async write(
    step: string,
    call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] },
    intent: string,
  ): Promise<{ sent: Sent; receipt: TransactionReceipt }> {
    const signer = this.#signer();
    const from = await signer.address();
    const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] });
    try {
      await this.client.simulateContract({ account: from, ...call, args: call.args ?? [] } as never);
    } catch (e) {
      throw new Error(`${step}: simulation reverted, nothing sent. ${revertReason(e)}`);
    }
    const estimate = await this.client.estimateGas({ account: from, to: call.address, data });
    return this.#send(step, { to: call.address, data, value: 0n, gas: (estimate * GAS_HEADROOM_BPS) / 10_000n }, intent);
  }

  async deploy(step: string, data: Hex, intent: string) {
    const signer = this.#signer();
    if (!signer.canDeploy) {
      throw new Error(
        `${step}: the ${signer.kind} signer cannot send contract-creation transactions. See the plugin README ("Known gaps").`,
      );
    }
    const from = await signer.address();
    try {
      await this.client.call({ account: from, data });
    } catch (e) {
      throw new Error(`${step}: simulation reverted, nothing sent. ${revertReason(e)}`);
    }
    const estimate = await this.client.estimateGas({ account: from, data });
    return this.#send(step, { data, value: 0n, gas: (estimate * GAS_HEADROOM_BPS) / 10_000n }, intent);
  }

  async #send(step: string, tx: { to?: Address; data: Hex; value: bigint; gas: bigint }, intent: string) {
    // Fees come from our RPC for every signer, so mm never needs its own gas-fee API for the chain.
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.client.estimateFeesPerGas();
    this.log({ event: "send", step, to: tx.to ?? null, gasLimit: tx.gas.toString(), intent });
    const hash = await this.#signer().send({ ...tx, maxFeePerGas, maxPriorityFeePerGas }, intent);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    const sent: Sent = {
      step,
      hash,
      url: txUrl(this.network, hash),
      gasLimit: tx.gas.toString(),
      gasUsed: receipt.gasUsed.toString(),
    };
    this.log({ event: "mined", ...sent, status: receipt.status });
    if (receipt.status !== "success") throw new Error(`${step}: transaction reverted onchain (${sent.url})`);
    return { sent, receipt };
  }

  // ------------------------------------------------------------------ reads

  async vaultOf(agentId: bigint): Promise<Address> {
    const vault = await this.client.readContract({
      address: this.registry,
      abi: registryAbi,
      functionName: "vaultOf",
      args: [agentId],
    });
    if (vault === zeroAddress) throw new Error(`Agent #${agentId} has not entered Proofbook on ${this.network.name}.`);
    return vault;
  }

  async token(address: Address) {
    const [decimals, symbol] = await Promise.all([
      this.client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      this.client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => "tokens"),
    ]);
    return { address, decimals, symbol };
  }

  async status(agentId: bigint) {
    const vault = await this.vaultOf(agentId);
    const v = { address: vault, abi: vaultAbi } as const;
    const read = <T>(functionName: string) =>
      this.client.readContract({ ...v, functionName } as never) as Promise<T>;
    const [asset, owner, agentURI, sessionKey, guardian, frozen, nav, totalAssets, totalSupply, venues] =
      await Promise.all([
        read<Address>("asset"),
        this.client.readContract({ address: this.registry, abi: registryAbi, functionName: "ownerOf", args: [agentId] }),
        this.client
          .readContract({ address: this.network.identity, abi: identityAbi, functionName: "tokenURI", args: [agentId] })
          .catch(() => ""),
        read<Address>("sessionKey"),
        read<Address>("guardian"),
        read<boolean>("frozen"),
        read<bigint>("nav"),
        read<bigint>("totalAssets"),
        read<bigint>("totalSupply"),
        read<readonly Address[]>("venues"),
      ]);
    const [token, maxTrade, lossBps, cap, idle, dayStartNav] = await Promise.all([
      this.token(asset),
      read<bigint>("maxTradeNotional"),
      read<number>("dailyLossCapBps"),
      read<bigint>("depositCapPerBacker"),
      this.client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
      read<bigint>("dayStartNav"),
    ]);
    const fmt = (x: bigint) => formatUnits(x, token.decimals);
    const venueInfo = await Promise.all(venues.map((a) => this.#perplVenue(a, vault, fmt)));
    return {
      network: this.network.name,
      chainId: this.network.chainId,
      agentId: agentId.toString(),
      agentURI,
      owner,
      vault,
      asset: { address: asset, symbol: token.symbol, decimals: token.decimals },
      sessionKey,
      guardian,
      frozen,
      nav: fmt(nav),
      totalAssets: fmt(totalAssets),
      idle: fmt(idle),
      dayStartNav: fmt(dayStartNav),
      shares: totalSupply.toString(),
      envelope: { maxTradeNotional: fmt(maxTrade), dailyLossCapBps: lossBps, depositCapPerBacker: fmt(cap) },
      venues: venueInfo,
    };
  }

  /** Venue details when the venue is a PerplAdapter; just the address otherwise. */
  async #perplVenue(adapter: Address, vault: Address, fmt: (x: bigint) => string) {
    try {
      const a = { address: adapter, abi: perplAdapterAbi } as const;
      const [accountId, exposure, bound] = await Promise.all([
        this.client.readContract({ ...a, functionName: "accountId" }),
        this.client.readContract({ ...a, functionName: "exposure", args: [vault] }),
        this.client.readContract({ ...a, functionName: "vault" }),
      ]);
      const position = accountId === 0n ? undefined : await this.perplPosition(accountId);
      return {
        adapter,
        kind: "PerplAdapter",
        bound: bound === vault,
        perplAccount: accountId.toString(),
        exposure: fmt(exposure),
        monPosition: position && {
          side: position.lot === 0n ? "flat" : position.type === 0 ? "long" : "short",
          lots: position.lot.toString(),
          margin: fmt(position.deposit),
          pnlAtMark: fmt(position.pnl),
        },
      };
    } catch {
      return { adapter, kind: "unknown" };
    }
  }

  async perplPosition(accountId: bigint) {
    const [p] = await this.client.readContract({
      address: this.network.perplExchange,
      abi: perplExchangeAbi,
      functionName: "getPosition",
      args: [this.network.monPerpId, accountId],
    });
    return { type: p.positionType, lot: p.lotLNS, deposit: p.depositCNS, pnl: p.pnlCNS };
  }

  async perplMarket() {
    const p = await this.client.readContract({
      address: this.network.perplExchange,
      abi: perplExchangeAbi,
      functionName: "getPerpetualInfo",
      args: [this.network.monPerpId],
    });
    const bid = p.maxBidPriceONS > 0n ? p.basePricePNS + p.maxBidPriceONS : 0n;
    const ask = p.minAskPriceONS > 0n ? p.basePricePNS + p.minAskPriceONS : 0n;
    return { mark: p.markPNS, bid, ask, priceDecimals: p.priceDecimals, lotDecimals: p.lotDecimals, status: p.status };
  }

  // ------------------------------------------------------------------ create

  /** The registry's AdapterFactory, or undefined for a registry from before the C1 fix. */
  async adapterFactory(): Promise<Address | undefined> {
    try {
      const f = await this.client.readContract({ address: this.registry, abi: registryAbi, functionName: "adapters" });
      return f === zeroAddress ? undefined : f;
    } catch {
      return undefined;
    }
  }

  /**
   * Mirrors contracts/script/HouseAgent.s.sol: register an ERC-8004 identity (minted to the signer),
   * get a PerplAdapter, enter the agent with its risk envelope.
   * With an AdapterFactory registry the adapter comes from factory.deployPerpl() and enter() binds
   * it, so every step is a plain contract call (the mm signer can run all of it). Older registries
   * (no factory) take the adapter deployed from bytecode and a separate bind.
   * `agentId` / `adapter` resume a run that stopped part-way.
   */
  async create(o: {
    agentURI: string;
    sessionKey?: Address;
    maxTrade: string;
    dailyLossBps: number;
    depositCap: string;
    asset?: Address;
    agentId?: bigint;
    adapter?: Address;
  }) {
    const signer = this.#signer();
    const me = await signer.address();
    const asset = o.asset ?? this.network.ausd;
    const token = await this.token(asset);
    const sessionKey = o.sessionKey ?? me;
    const envelope = {
      maxTradeNotional: parseUnits(o.maxTrade, token.decimals),
      dailyLossCapBps: o.dailyLossBps,
      depositCapPerBacker: parseUnits(o.depositCap, token.decimals),
      venues: [] as Address[],
    };

    // Everything that can be checked before the first transaction.
    const factory = await this.adapterFactory();
    if (!factory && !o.adapter && !signer.canDeploy) {
      throw new Error(
        `The ${signer.kind} signer cannot deploy the PerplAdapter (contract creation). Nothing was sent. See the plugin README ("Known gaps").`,
      );
    }
    const allowed = await this.client.readContract({
      address: this.registry,
      abi: registryAbi,
      functionName: "isAllowedAsset",
      args: [asset],
    });
    if (!allowed) throw new Error(`Asset ${asset} is not allowed by the registry.`);
    if (envelope.maxTradeNotional === 0n || envelope.depositCapPerBacker === 0n) throw new Error("Limits must be above 0.");
    if (o.dailyLossBps <= 0 || o.dailyLossBps > 10_000) throw new Error("--daily-loss-bps must be in 1..10000.");

    const sent: Sent[] = [];
    let agentId = o.agentId;
    if (agentId === undefined) {
      const r = await this.write(
        "register",
        { address: this.network.identity, abi: identityAbi, functionName: "register", args: [o.agentURI] },
        `Register ERC-8004 agent identity (${o.agentURI})`,
      );
      sent.push(r.sent);
      const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: r.receipt.logs });
      if (!ev) throw new Error("register: no Registered event in the receipt.");
      agentId = ev.args.agentId;
      this.log({ event: "registered", agentId: agentId.toString() });
    }

    let adapter = o.adapter;
    if (factory && !adapter) {
      const r = await this.write(
        "deployPerpl",
        { address: factory, abi: factoryAbi, functionName: "deployPerpl", args: [] },
        `Deploy a Proofbook PerplAdapter for agent #${agentId} from the AdapterFactory`,
      );
      sent.push(r.sent);
      const [ev] = parseEventLogs({ abi: factoryAbi, eventName: "AdapterDeployed", logs: r.receipt.logs });
      if (!ev) throw new Error("deployPerpl: no AdapterDeployed event in the receipt.");
      adapter = getAddress(ev.args.adapter);
      this.log({ event: "deployed", adapter });
    } else if (factory && adapter) {
      const canonical = await this.client.readContract({ address: factory, abi: factoryAbi, functionName: "isCanonical", args: [adapter] });
      if (!canonical) throw new Error(`Adapter ${adapter} was not deployed by the registry's AdapterFactory ${factory}.`);
    } else if (!adapter) {
      const data = encodeDeployData({
        abi: perplAdapterAbi,
        bytecode: perplAdapterBytecode,
        args: [this.network.perplExchange, asset],
      });
      const r = await this.deploy("deploy PerplAdapter", data, `Deploy Proofbook PerplAdapter for agent #${agentId}`);
      sent.push(r.sent);
      if (!r.receipt.contractAddress) throw new Error("deploy: no contract address in the receipt.");
      adapter = getAddress(r.receipt.contractAddress);
      this.log({ event: "deployed", adapter });
    } else {
      // Older registry, adapter given: only its deployer can bind it.
      const binder = await this.client.readContract({ address: adapter, abi: perplAdapterAbi, functionName: "binder" });
      if (binder.toLowerCase() !== me.toLowerCase()) {
        throw new Error(`Adapter ${adapter} was deployed by ${binder}; only that address can bind it.`);
      }
    }
    envelope.venues = [adapter];

    let vault = await this.client.readContract({
      address: this.registry,
      abi: registryAbi,
      functionName: "vaultOf",
      args: [agentId],
    });
    if (vault === zeroAddress) {
      const r = await this.write(
        "enter",
        { address: this.registry, abi: registryAbi, functionName: "enter", args: [agentId, envelope, sessionKey, asset] },
        `Enter agent #${agentId} into Proofbook: max trade ${o.maxTrade}, daily loss ${o.dailyLossBps} bps, cap ${o.depositCap} per backer`,
      );
      sent.push(r.sent);
      const [ev] = parseEventLogs({ abi: registryAbi, eventName: "VaultLinked", logs: r.receipt.logs });
      if (!ev) throw new Error("enter: no VaultLinked event in the receipt.");
      vault = ev.args.vault;
      this.log({ event: "entered", vault });
    }

    // A factory registry binds inside enter(); an older one needs the deployer to bind.
    const bound = await this.client.readContract({ address: adapter, abi: perplAdapterAbi, functionName: "vault" });
    if (!factory && bound === zeroAddress) {
      const r = await this.write(
        "bind",
        { address: adapter, abi: perplAdapterAbi, functionName: "bind", args: [vault] },
        `Bind PerplAdapter to agent #${agentId}'s vault`,
      );
      sent.push(r.sent);
    }

    return {
      network: this.network.name,
      agentId: agentId.toString(),
      owner: me,
      vault,
      adapter,
      sessionKey,
      asset,
      envelope: { maxTradeNotional: o.maxTrade, dailyLossCapBps: o.dailyLossBps, depositCapPerBacker: o.depositCap },
      transactions: sent,
    };
  }

  // ------------------------------------------------------------------ fund

  /** Back an agent: approve exactly `amount`, then deposit it to the signer's own position. */
  async fund(agentId: bigint, amount: string) {
    const me = await this.#signer().address();
    const vault = await this.vaultOf(agentId);
    const asset = await this.client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" });
    const token = await this.token(asset);
    const assets = parseUnits(amount, token.decimals);
    if (assets <= 0n) throw new Error("Amount must be above 0.");

    const [balance, room, allowance] = await Promise.all([
      this.client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxDeposit", args: [me] }),
      this.client.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [me, vault] }),
    ]);
    if (balance < assets) {
      throw new Error(`${me} holds ${formatUnits(balance, token.decimals)} ${token.symbol}, less than ${amount}.`);
    }
    if (assets > room) {
      throw new Error(`The vault takes at most ${formatUnits(room, token.decimals)} ${token.symbol} more from ${me} (frozen or at the per-backer cap).`);
    }

    const sent: Sent[] = [];
    if (allowance < assets) {
      const r = await this.write(
        "approve",
        { address: asset, abi: erc20Abi, functionName: "approve", args: [vault, assets] },
        `Approve exactly ${amount} ${token.symbol} for Proofbook agent #${agentId}'s vault`,
      );
      sent.push(r.sent);
    }
    const r = await this.write(
      "deposit",
      { address: vault, abi: vaultAbi, functionName: "deposit", args: [assets, me] },
      `Deposit ${amount} ${token.symbol} into Proofbook agent #${agentId}'s vault`,
    );
    sent.push(r.sent);
    const shares = await this.client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [me] });
    const position = await this.client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "convertToAssets",
      args: [shares],
    });
    return {
      network: this.network.name,
      agentId: agentId.toString(),
      vault,
      backer: me,
      deposited: `${amount} ${token.symbol}`,
      position: `${formatUnits(position, token.decimals)} ${token.symbol}`,
      transactions: sent,
    };
  }

  // ------------------------------------------------------------------ freeze

  /** Kill switch: the agent's owner or the protocol guardian freezes the vault. */
  async freeze(agentId: bigint) {
    const me = await this.#signer().address();
    const vault = await this.vaultOf(agentId);
    const [frozen, guardian, owner] = await Promise.all([
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "frozen" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "guardian" }),
      this.client.readContract({ address: this.registry, abi: registryAbi, functionName: "ownerOf", args: [agentId] }),
    ]);
    if (frozen) return { network: this.network.name, agentId: agentId.toString(), vault, frozen: true, transactions: [] };
    const lc = me.toLowerCase();
    if (lc !== guardian.toLowerCase() && lc !== owner.toLowerCase()) {
      throw new Error(`${me} is neither the agent owner (${owner}) nor the guardian (${guardian}).`);
    }
    const r = await this.write(
      "freeze",
      { address: vault, abi: vaultAbi, functionName: "freeze" },
      `Freeze Proofbook agent #${agentId}'s vault (kill switch)`,
    );
    return { network: this.network.name, agentId: agentId.toString(), vault, frozen: true, transactions: [r.sent] };
  }

  // ------------------------------------------------------------------ faucet

  /** Testnet only: Agora's AUSD faucet (10,000 test AUSD, one claim a minute across everyone). */
  async faucet(recipient?: Address) {
    if (!this.network.ausdFaucet) throw new Error(`No AUSD faucet on ${this.network.name}.`);
    const to = recipient ?? (await this.#signer().address());
    const r = await this.write(
      "faucet",
      { address: this.network.ausdFaucet, abi: faucetAbi, functionName: "requestFunds", args: [to] },
      `Request 10,000 test AUSD from Agora's testnet faucet for ${to}`,
    );
    return { network: this.network.name, recipient: to, transactions: [r.sent] };
  }

  // ------------------------------------------------------------------ run

  /** Reads everything one run-loop step needs. */
  async observe(agentId: bigint) {
    const vault = await this.vaultOf(agentId);
    const [frozen, sessionKey, venues, maxTrade, asset] = await Promise.all([
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "frozen" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "sessionKey" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "venues" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxTradeNotional" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
    ]);
    const adapter = venues[0];
    if (!adapter) throw new Error(`Agent #${agentId}'s vault has no venues.`);
    const [accountId, idle, decimals, market, minOpen, block] = await Promise.all([
      this.client.readContract({ address: adapter, abi: perplAdapterAbi, functionName: "accountId" }),
      this.client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
      this.client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
      this.perplMarket(),
      this.client.readContract({
        address: this.network.perplExchange,
        abi: perplExchangeAbi,
        functionName: "getMinAccountOpenCNS",
      }),
      this.client.getBlockNumber(),
    ]);
    const position = accountId === 0n ? undefined : await this.perplPosition(accountId);
    return { vault, frozen, sessionKey, adapter, maxTrade, asset, decimals, accountId, idle, market, minOpen, block, position };
  }

  /** Adapter calldata for a margin deposit. */
  static marginData(amount: bigint): Hex {
    return encodeAbiParameters(adapterCallParams, [DEPOSIT, encodeAbiParameters([{ type: "uint256" }], [amount])]);
  }

  /** Adapter calldata for an IOC Perpl order, priced inside the adapter's 3% band around mark. */
  static orderData(o: { perpId: bigint; orderType: number; pricePNS: bigint; lotLNS: bigint; expiryBlock: bigint }): Hex {
    const desc = {
      orderDescId: 0n,
      perpId: o.perpId,
      orderType: o.orderType,
      orderId: 0n,
      pricePNS: o.pricePNS,
      lotLNS: o.lotLNS,
      expiryBlock: o.expiryBlock,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: true,
      maxMatches: 0n,
      leverageHdths: 100n, // 1x
      lastExecutionBlock: 0n,
      amountCNS: 0n, // the adapter forces 0
      maxNegPnlCollatBPS: 300n, // 0 onchain refuses every taker fill (docs/reference/perpl.md)
    };
    return encodeAbiParameters(adapterCallParams, [ORDER, encodeAbiParameters(orderDescParams, [desc])]);
  }

  /** Long limit: best ask + 0.5%, capped at mark + 2.5% so it stays inside the adapter's band. */
  static longPrice(m: { mark: bigint; ask: bigint }) {
    const cap = (m.mark * (10_000n + BAND_BPS - 50n)) / 10_000n;
    const want = m.ask > 0n ? (m.ask * 1005n) / 1000n : cap;
    return want < cap ? want : cap;
  }

  /** Close-long limit: best bid - 0.5%, floored at mark - 2.5%. */
  static closePrice(m: { mark: bigint; bid: bigint }) {
    const floor = (m.mark * (10_000n - BAND_BPS + 50n) + 9_999n) / 10_000n;
    const want = m.bid > 0n ? (m.bid * 995n) / 1000n : floor;
    return want > floor ? want : floor;
  }

  /** Quote what the vault will count against maxTradeNotional (the adapter's own view). */
  async quote(adapter: Address, data: Hex) {
    return this.client.readContract({ address: adapter, abi: perplAdapterAbi, functionName: "quoteNotional", args: [data] });
  }

  /** Simulates vault.execute from the session key; returns the revert reason, or undefined if it would succeed. */
  async simulateExecute(vault: Address, sessionKey: Address, adapter: Address, data: Hex) {
    try {
      await this.client.simulateContract({
        account: sessionKey,
        address: vault,
        abi: [...vaultAbi, ...perplAdapterAbi],
        functionName: "execute",
        args: [adapter, data],
      });
      return undefined;
    } catch (e) {
      return revertReason(e);
    }
  }

  async execute(agentId: bigint, vault: Address, adapter: Address, data: Hex, intent: string) {
    const r = await this.write(
      "execute",
      { address: vault, abi: [...vaultAbi, ...perplAdapterAbi], functionName: "execute", args: [adapter, data] },
      intent,
    );
    const [ev] = parseEventLogs({ abi: vaultAbi, eventName: "Executed", logs: r.receipt.logs });
    const froze = parseEventLogs({ abi: vaultAbi, eventName: "Frozen", logs: r.receipt.logs }).length > 0;
    return {
      sent: r.sent,
      notional: ev?.args.notional,
      navBefore: ev?.args.navBefore,
      navAfter: ev?.args.navAfter,
      froze,
      agentId,
    };
  }
}

export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const d = revert.data;
      if (d?.errorName) {
        const args = (d.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
        return `${d.errorName}(${args.join(", ")})`;
      }
      if (revert.reason) return revert.reason;
      if (revert.signature) return `unknown error ${revert.signature}`;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
