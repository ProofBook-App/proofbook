// Backer accounts: Mera passkeys, and a signing session scoped to backing this chain's agent vaults.
// Browser only. The `.client.ts` suffix keeps this module (Mera, @scure/*, viem signing) out of the
// Worker: React Router replaces its exports with `undefined` during SSR, so only call it after
// hydration. Spike findings: docs/reference/mera.md.
//
// What's stored on the device: the passkey's credential id and the derived address, nothing secret.
// The key is re-derived from the passkey on every login, so clearing storage or a new device gives
// back the same account (the stateless test).

import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeFunctionData,
  encodeFunctionData,
  http,
  maxUint256,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { chainFor } from "./chain";
import { ausdFaucet } from "./chains";

// ---- Chain -------------------------------------------------------------------

const clients = new Map<number, PublicClient>();
export function publicClient(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: chainFor(chainId), transport: http(), batch: { multicall: true } }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

// ---- ABIs --------------------------------------------------------------------

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function depositCapPerBacker() view returns (uint256)",
  "function frozen() view returns (bool)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "error VaultFrozen()",
  "error ExposureUnreliable()",
  "function venuesReliable() view returns (bool)",
  "error DepositCapExceeded(address backer, uint256 attempted, uint256 cap)",
  "error ERC4626ExceededMaxWithdraw(address owner, uint256 assets, uint256 max)",
  "error ERC4626ExceededMaxRedeem(address owner, uint256 shares, uint256 max)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

const faucetAbi = parseAbi(["function requestFunds(address recipient)"]);

// ---- Derivation ----------------------------------------------------------------
// Mera's documented mapping: PRF output -> BIP-39 entropy -> seed -> m/44'/60'/0'/0/0. The account
// stays importable into MetaMask. FROZEN: changing the salt, mapping or path changes every
// backer's address, so it must not change once anyone has deposited.
const EVM_PATH = "m/44'/60'/0'/0/0";

function deriveKey(prfOutput: Uint8Array): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(EVM_PATH);
  seed.fill(0);
  if (!node.privateKey) throw new Error("derivation produced no key");
  return node.privateKey;
}

// ---- Public-only device state --------------------------------------------------------

const STORAGE_KEY = "proofbook.backer";

export type Identity = { credential: PasskeyCredentialMetadata; address: Address };

export function loadIdentity(): Identity | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Identity> | null;
    if (typeof parsed?.credential?.credentialId === "string" && typeof parsed.address === "string") {
      return parsed as Identity;
    }
  } catch {
    // Storage blocked or corrupt: behave like a fresh device.
  }
  return undefined;
}

function saveIdentity(identity: Identity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Not fatal: the passkey rebuilds it.
  }
}

export function forgetDevice() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Passkeys are bound to the rpId. Every proofbook.app host shares one so www and the apex give the
// same account; anywhere else (localhost, a preview host) gets its own accounts.
function rpId() {
  const host = location.hostname;
  return host === "proofbook.app" || host.endsWith(".proofbook.app") ? "proofbook.app" : host;
}

// ---- Scoped signing session -------------------------------------------------------------
// A Mera session is only "a key in memory until end()". The time limit and the scope below are
// ours, checked in page JS before anything is signed. They stop the app from signing the wrong
// thing; they can't stop a script already running on the page, so sessions stay short.

export const SESSION_MINUTES = 15;

export type VaultRef = { vault: Address; asset: Address };
export type Scope = { chainId: number; vaults: VaultRef[] };

export type Session = {
  address: Address;
  expiresAt: number;
  live(): boolean;
  end(reason?: string): void;
  approve(vault: VaultRef, amount: bigint): Promise<Hash>;
  deposit(vault: VaultRef, amount: bigint): Promise<Hash>;
  withdraw(vault: VaultRef, amount: bigint): Promise<Hash>;
  redeemAll(vault: VaultRef): Promise<Hash>;
  requestAusd(): Promise<Hash>;
};

/** One passkey prompt: log in (or sign up) and start a session in the same ceremony. */
export async function unlock(
  mode: "create" | "login",
  scope: Scope,
  onEnd: (reason: string) => void,
): Promise<Session> {
  let prf: Uint8Array;
  let credential: PasskeyCredentialMetadata;
  if (mode === "create") {
    const created = await createPasskeyWithPrfOutput({
      rp: { id: rpId(), name: "Proofbook" },
      user: {
        name: `Proofbook backer ${new Date().toISOString().slice(0, 10)}`,
        displayName: "Proofbook backer",
      },
    });
    prf = created.prfOutput;
    credential = { credentialId: created.credentialId, ...(created.transports ? { transports: created.transports } : {}) };
  } else {
    // Without a stored credential the browser offers any passkey for this site: the stateless path.
    const stored = loadIdentity();
    const got = await getPasskeyPrfOutput({ rpId: rpId(), ...(stored ? { credential: stored.credential } : {}) });
    prf = got.prfOutput;
    credential = stored?.credential.credentialId === got.credentialId ? stored.credential : { credentialId: got.credentialId };
  }

  const privateKey = deriveKey(prf);
  prf.fill(0);
  const session = startSession(privateKey, scope, onEnd);
  saveIdentity({ credential, address: session.address });
  return session;
}

/** A scoped session from a derived key. Zeroes `privateKey`. Exported for the Node flow test. */
export function startSession(privateKey: Uint8Array, scope: Scope, onEnd: (reason: string) => void): Session {
  const mera = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0); // the session holds its own copy
  const address = getEvmAddress(mera.publicKey) as Address;

  const account = toViemAccount(mera);
  const chain = chainFor(scope.chainId);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const client = publicClient(scope.chainId);
  const faucet = ausdFaucet(scope.chainId)?.toLowerCase();
  // vault -> its asset, both lowercase
  const vaults = new Map(scope.vaults.map((r) => [r.vault.toLowerCase(), r.asset.toLowerCase()]));
  const assets = new Set(vaults.values());
  const self = address.toLowerCase();

  const expiresAt = Date.now() + SESSION_MINUTES * 60_000;
  let isLive = true;
  const end = (reason = "You locked it") => {
    if (!isLive) return;
    isLive = false;
    clearTimeout(timer);
    mera.end(); // zeroes the key
    onEnd(reason);
  };
  const timer = setTimeout(() => end(`It ended after ${SESSION_MINUTES} minutes`), SESSION_MINUTES * 60_000);

  // The only calls this session will sign: approve one of these vaults for an exact amount of its own
  // asset, deposit to self, withdraw or redeem own shares to self, and the testnet AUSD faucet for
  // self. No native value, ever.
  function inScope(to: string, data: Hex) {
    if (assets.has(to)) {
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
      return functionName === "approve" && vaults.get(args[0].toLowerCase()) === to && args[1] !== maxUint256;
    }
    if (vaults.has(to)) {
      const { functionName, args } = decodeFunctionData({ abi: vaultAbi, data });
      if (functionName === "deposit") return args[1].toLowerCase() === self;
      if (functionName === "withdraw" || functionName === "redeem") {
        return args[1].toLowerCase() === self && args[2].toLowerCase() === self;
      }
      return false;
    }
    if (faucet && to === faucet) {
      const { functionName, args } = decodeFunctionData({ abi: faucetAbi, data });
      return functionName === "requestFunds" && args[0].toLowerCase() === self;
    }
    return false;
  }

  async function send(to: Address, data: Hex): Promise<Hash> {
    if (!isLive || Date.now() >= expiresAt) {
      end(`It ended after ${SESSION_MINUTES} minutes`);
      throw new Error("Your session has ended. Unlock again to continue.");
    }
    if (!inScope(to.toLowerCase(), data)) throw new Error("Outside this session's scope, so it wasn't signed.");
    // Simulate first so a revert shows as a reason, not a failed tx that still pays gas.
    try {
      await client.call({ account: address, to, data });
    } catch (err) {
      throw revertOf(err) ?? err;
    }
    // Monad charges gas on the limit, not on gas used: send the estimate with a small margin for
    // state that moves between estimate and inclusion (a fee taken, a mark price), never a blanket pad.
    const estimate = await client.estimateGas({ account: address, to, data });
    const hash = await wallet.sendTransaction({ to, data, value: 0n, gas: estimate + estimate / 20n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new TxFailed(hash);
    return hash;
  }

  return {
    address,
    expiresAt,
    live: () => isLive && Date.now() < expiresAt,
    end,
    approve: ({ vault, asset }, amount) =>
      send(asset, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, amount] })),
    deposit: ({ vault }, amount) =>
      send(vault, encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [amount, address] })),
    withdraw: ({ vault }, amount) =>
      send(vault, encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [amount, address, address] })),
    async redeemAll({ vault }) {
      const shares = await client.readContract({ address: vault, abi: vaultAbi, functionName: "maxRedeem", args: [address] });
      return send(vault, encodeFunctionData({ abi: vaultAbi, functionName: "redeem", args: [shares, address, address] }));
    },
    async requestAusd() {
      if (!faucet) throw new Error("There is no AUSD faucet on this network.");
      return send(faucet as Address, encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [address] }));
    },
  };
}

// ---- Reads ---------------------------------------------------------------------------

export type Position = {
  mon: bigint;
  wallet: bigint; // vault asset in the backer's wallet
  allowance: bigint;
  shares: bigint;
  value: bigint; // shares at the current share price, net of the pending fee
  maxDeposit: bigint;
  maxWithdraw: bigint;
  cap: bigint;
  frozen: boolean;
  /** False while a venue can't be priced (stale price, failed read): the vault pauses deposits. */
  reliable: boolean;
};

export async function readPosition(chainId: number, ref: VaultRef, who: Address): Promise<Position> {
  const client = publicClient(chainId);
  const v = { address: ref.vault, abi: vaultAbi } as const;
  const a = { address: ref.asset, abi: erc20Abi } as const;
  const [mon, wallet, allowance, shares, maxDeposit, maxWithdraw, cap, frozen] = await Promise.all([
    client.getBalance({ address: who }),
    client.readContract({ ...a, functionName: "balanceOf", args: [who] }),
    client.readContract({ ...a, functionName: "allowance", args: [who, ref.vault] }),
    client.readContract({ ...v, functionName: "balanceOf", args: [who] }),
    client.readContract({ ...v, functionName: "maxDeposit", args: [who] }),
    client.readContract({ ...v, functionName: "maxWithdraw", args: [who] }),
    client.readContract({ ...v, functionName: "depositCapPerBacker" }),
    client.readContract({ ...v, functionName: "frozen" }),
  ]);
  const value = shares === 0n ? 0n : await client.readContract({ ...v, functionName: "convertToAssets", args: [shares] });
  // Vaults from before the H1 fix have no venuesReliable(); they never pause deposits.
  const reliable = await client.readContract({ ...v, functionName: "venuesReliable" }).catch(() => true);
  return { mon, wallet, allowance, shares, value, maxDeposit, maxWithdraw, cap, frozen, reliable };
}

export async function assetDecimals(chainId: number, asset: Address) {
  return publicClient(chainId).readContract({ address: asset, abi: erc20Abi, functionName: "decimals" });
}

export type Holding = { vault: Address; shares: bigint; totalShares: bigint; value: bigint; maxWithdraw: bigint };

/** Shares and their value in every vault, for the portfolio. One multicall batch. */
export async function readHoldings(chainId: number, vaults: Address[], who: Address): Promise<Holding[]> {
  const client = publicClient(chainId);
  return Promise.all(
    vaults.map(async (vault) => {
      const v = { address: vault, abi: vaultAbi } as const;
      const [shares, totalShares, maxWithdraw] = await Promise.all([
        client.readContract({ ...v, functionName: "balanceOf", args: [who] }),
        client.readContract({ ...v, functionName: "totalSupply" }),
        client.readContract({ ...v, functionName: "maxWithdraw", args: [who] }),
      ]);
      const value = shares === 0n ? 0n : await client.readContract({ ...v, functionName: "convertToAssets", args: [shares] });
      return { vault, shares, totalShares, value, maxWithdraw };
    }),
  );
}

// ---- Errors ---------------------------------------------------------------------------

export class Reverted extends Error {
  constructor(readonly errorName: string) {
    super(`reverted: ${errorName}`);
  }
}

// A raw eth_call revert carries only the error bytes; decode them against the vault and token ABIs.
function revertOf(err: unknown): Reverted | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const raw = err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null;
  if (!raw?.data || raw.data.length < 10) return undefined;
  try {
    return new Reverted(decodeErrorResult({ abi: [...vaultAbi, ...erc20Abi], data: raw.data }).errorName);
  } catch {
    return undefined;
  }
}

export class TxFailed extends Error {
  constructor(readonly hash: Hash) {
    super("The transaction was included but reverted.");
  }
}

/** A sentence a backer can act on. */
export function explain(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This passkey provider can't derive an account. Use iCloud Keychain, Google Password Manager or 1Password.";
      case "PASSKEY_OPERATION_FAILED":
        return "The passkey prompt was cancelled or timed out. Try again.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser doesn't support the cryptography passkey accounts need.";
      default:
        return error.message;
    }
  }
  const name =
    error instanceof Reverted
      ? error.errorName
      : error instanceof BaseError
        ? (error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null)?.data?.errorName
        : undefined;
  switch (name) {
    case "VaultFrozen":
      return "The vault is frozen, so it takes no new deposits. Withdrawals still work.";
    case "ExposureUnreliable":
      return "Deposits are paused while one of the agent's venues can't be priced. Withdrawals still work. Try again in a few minutes.";
    case "DepositCapExceeded":
      return "That would take you over the per-backer deposit cap.";
    case "ERC4626ExceededMaxWithdraw":
    case "ERC4626ExceededMaxRedeem":
      return "That's more than is idle in the vault right now. The rest is at the venue.";
    case "ERC20InsufficientBalance":
      return "Your wallet doesn't hold that much.";
    case "ERC20InsufficientAllowance":
      return "The vault isn't approved for that amount yet. Try again.";
  }
  if (error instanceof BaseError) {
    if (/insufficient funds|gas required exceeds/i.test(error.message)) {
      return "Your account needs a little MON to pay gas.";
    }
    if (/reverted/i.test(error.message)) return "The network rejected it. Nothing was sent.";
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
