// Browser-only Mera wrapper. The `.client.ts` suffix keeps this module (and
// @category-labs/mera, @scure/*, viem signing) out of the Worker's server
// bundle: React Router replaces its exports with `undefined` during SSR, so it
// must only be called from event handlers.

import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  verifyMessage,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { monadTestnet } from "viem/chains";

// ---- Derivation -----------------------------------------------------------
// Same mapping as Mera's docs and web demo: PRF output -> BIP-39 entropy ->
// seed -> BIP-44 m/44'/60'/0'/0/0. Changing this changes every address, so it
// must be frozen before any mainnet account exists.
const EVM_PATH = "m/44'/60'/0'/0/0";

function deriveEvmPrivateKey(prfOutput: Uint8Array): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(EVM_PATH);
  seed.fill(0);
  if (node.privateKey === null) throw new Error("derivation produced no key");
  return node.privateKey;
}

// ---- Public-only local state -------------------------------------------------
// Only non-secret data is stored: the credential ID (to pin the passkey) and
// the derived address (to show identity before a ceremony). Clearing it is the
// "stateless test".
const STORAGE_KEY = "proofbook.spike.mera";

type StoredIdentity = {
  credential: PasskeyCredentialMetadata;
  address: Address;
};

function loadIdentity(): StoredIdentity | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredIdentity>;
    if (
      typeof parsed.credential?.credentialId === "string" &&
      typeof parsed.address === "string"
    ) {
      return parsed as StoredIdentity;
    }
  } catch {
    // storage blocked or corrupt: behave like a fresh device
  }
  return undefined;
}

function saveIdentity(identity: StoredIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // non-fatal: identity is reproducible from the passkey
  }
}

function forgetDevice(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.clear();
  } catch {
    // ignore
  }
}

// ---- Ceremonies ---------------------------------------------------------------

function rpId(): string {
  // Passkeys are bound to this hostname. A passkey made on `localhost` does
  // not exist on proofbook.app and vice versa.
  return location.hostname;
}

type Ceremony = { address: Address; privateKey: Uint8Array };

async function createPasskey(): Promise<Ceremony> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: "Proofbook (Mera spike)" },
    user: {
      name: `proofbook-spike-${new Date().toISOString().slice(0, 16)}`,
      displayName: "Proofbook spike account",
    },
  });
  return finishCeremony(created.prfOutput, {
    credentialId: created.credentialId,
    ...(created.transports ? { transports: created.transports } : {}),
  });
}

/**
 * One passkey prompt. `pinned` restricts the ceremony to the stored credential;
 * without it (fresh device / cleared storage) the browser offers any
 * discoverable passkey for this rpId.
 */
async function assertPasskey(pinned: boolean): Promise<Ceremony> {
  const stored = pinned ? loadIdentity() : undefined;
  const { prfOutput, credentialId } = await getPasskeyPrfOutput({
    rpId: rpId(),
    ...(stored ? { credential: stored.credential } : {}),
  });
  const credential =
    stored?.credential.credentialId === credentialId
      ? stored.credential
      : { credentialId };
  return finishCeremony(prfOutput, credential);
}

function finishCeremony(
  prfOutput: Uint8Array,
  credential: PasskeyCredentialMetadata,
): Ceremony {
  const privateKey = deriveEvmPrivateKey(prfOutput);
  prfOutput.fill(0);
  // A throwaway session just to read the public key.
  const probe = createSecp256k1SigningSession({ privateKey });
  const address = getEvmAddress(probe.publicKey) as Address;
  probe.end();
  saveIdentity({ credential, address });
  return { address, privateKey };
}

// ---- Bounded signing session ------------------------------------------------------
// Mera's session is just "a key in memory until end()". Time and scope bounds
// are ours, enforced here in page JS (not onchain).

const SESSION_TTL_MS = 5 * 60 * 1000;
const MESSAGE_PREFIX = "Proofbook spike:";

type BoundedSession = {
  address: Address;
  expiresAt: number;
  signMessage(message: string): Promise<{ signature: Hex; valid: boolean }>;
  sendZeroValueSelfTx(): Promise<Hex>;
  end(): void;
  isLive(): boolean;
};

function startBoundedSession(
  ceremony: Ceremony,
  onEnd: (reason: string) => void,
): BoundedSession {
  const session: Secp256k1SigningSession = createSecp256k1SigningSession({
    privateKey: ceremony.privateKey,
  });
  // The session copied the key; zero ours.
  ceremony.privateKey.fill(0);

  const account: LocalAccount = toViemAccount(session);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  let live = true;

  const end = (reason = "ended by user") => {
    if (!live) return;
    live = false;
    clearTimeout(timer);
    session.end(); // zeroes the key
    onEnd(reason);
  };
  const timer = setTimeout(() => end("expired (5 min TTL)"), SESSION_TTL_MS);

  const requireLive = () => {
    if (!live || Date.now() >= expiresAt) {
      end("expired (5 min TTL)");
      throw new Error("Signing session has ended; start a new one.");
    }
  };

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });

  return {
    address: account.address,
    expiresAt,
    isLive: () => live && Date.now() < expiresAt,
    end: () => end(),
    async signMessage(message) {
      requireLive();
      // Scope: only messages carrying the app prefix.
      if (!message.startsWith(MESSAGE_PREFIX)) {
        throw new Error(`Out of scope: message must start with "${MESSAGE_PREFIX}"`);
      }
      const signature = await account.signMessage!({ message });
      const valid = await verifyMessage({
        address: account.address,
        message,
        signature,
      });
      return { signature, valid };
    },
    async sendZeroValueSelfTx() {
      requireLive();
      // Scope: chain 10143, to == self, value == 0. Monad charges gas on the
      // limit, so pin it at 21000 instead of estimating.
      const chainId = await publicClient.getChainId();
      if (chainId !== monadTestnet.id) {
        throw new Error(`Out of scope: RPC reports chain ${chainId}, expected 10143`);
      }
      return walletClient.sendTransaction({
        to: account.address,
        value: 0n,
        gas: 21_000n,
      });
    },
  };
}

async function getTestnetBalance(address: Address): Promise<bigint> {
  const client = createPublicClient({ chain: monadTestnet, transport: http() });
  return client.getBalance({ address });
}

function describeError(error: unknown): string {
  if (isMeraError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

const EXPLORER = monadTestnet.blockExplorers.default.url;

export type { BoundedSession, Ceremony, StoredIdentity };
export {
  assertPasskey,
  createPasskey,
  describeError,
  EXPLORER,
  forgetDevice,
  getTestnetBalance,
  loadIdentity,
  MESSAGE_PREFIX,
  startBoundedSession,
};
