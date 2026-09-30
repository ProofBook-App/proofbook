# Mera reference

Mera is the backer account layer: passkey login, signing sessions and the stateless test. It is required by the Agora Mobile Trading ($10k) and Mera UX ($2.5k) bounties (see `hackathon.md`, spec §7). Day 0 spike, **2026-09-29**. Spike code is in `spikes/mera/`.

Legend: **[F]** = firsthand (read the source, ran it, or built it), **[D]** = from Mera's docs only, **[U]** = unverified, pending the human passkey test.

## Package facts

- **npm:** `@category-labs/mera` **0.2.0** (latest; published versions are 0.1.0 and 0.2.0; last modified 2026-08-12). [F]
- **Repo:** github.com/category-labs/mera, HEAD `a3102f4` (2026-08-31). Monorepo with `library/` (the package), `demos/` (web, Chrome extension, React Native, PRF model) and `docs/` (the Astro source of mera.category.xyz). [F]
- **Status:** "preview, API may change before 1.0". Category Labs did an internal security review; there is no external audit. Pin the exact version. [F]
- **Module format:** ESM only, `sideEffects: false`. Entry points: `.`, `./viem`, `./react-native-webauthn-client`. [F]
- **Runtime deps:** `@noble/curves` 2.3.0, `@noble/hashes` 2.3.0 and `@scure/base` 2.3.0, all pure JS. Optional peers: `viem ^2.28.0` (for `/viem`) and `react-native-passkey` 3.6.1. [F]
- **Platforms:** web browsers, Chrome extensions, and React Native on iOS 18+ / Android 9+. [D]

## What Mera is (and isn't)

A small library (about 1.8k lines of TS) that turns a passkey into 32 secret bytes via the WebAuthn **PRF** extension and signs with keys you derive from them. [F]

- **Chain-agnostic.** No chain IDs, RPCs, contracts, bundler, paymaster or backend. Accounts are plain **EOAs** (secp256k1) or Solana ed25519 keys. Chain 143 and 10143 work like any EVM chain. Mera's own web demo runs anvil with `--network monad`. [F]
- **No smart account, no custody service, no server.** Account derivation, storage, recovery and funding are all up to the app. [F]
- **Software keys.** The PRF output and the derived keys live in page JS memory. Any script on the page (XSS, a malicious dependency) can read them or sign with a live session. Only the passkey itself stays in the authenticator. [F, security-model doc]

## API (0.2.0) [F]

| Function | What it does | Prompts |
|---|---|---|
| `createPasskeyWithPrfOutput({ rp: {id, name}, user: {name, displayName}, timeout?, prfSalt? })` → `{ credentialId, transports?, prfSalt, prfOutput }` | New discoverable, UV-required passkey (ES256/RS256) with a random 32-byte `user.id` each call, then evaluates the PRF | 1, or **2** if the authenticator doesn't evaluate PRF at create (a fallback assertion) |
| `getPasskeyPrfOutput({ rpId, credential?, prfSalt?, timeout? })` → `{ credentialId, prfOutput }` | Assertion plus PRF. Without `credential`, any discoverable passkey for the rpId can answer | 1 |
| `createSecp256k1SigningSession({ privateKey })` → `{ publicKey, signDigest(d32), end(), [Symbol.dispose] }` | Copies the key into memory. `end()` zeroes it, and signing after that throws `SESSION_ENDED` | 0 |
| `createEd25519SigningSession`, `getSolanaAddress` | Solana equivalents | 0 |
| `getEvmAddress(publicKey)` | EIP-55 address | 0 |
| `toViemAccount(session, { nonceManager? })` (`@category-labs/mera/viem`) | viem `LocalAccount`: `signMessage`, `signTypedData`, `signTransaction`, `signAuthorization` (EIP-7702), `sign` | 0 |
| `createSecretVaultWithNewPasskey` / `…WithExistingPasskey` / `decryptSecretVaultWithPasskey` / `parseSecretVault` | AES-GCM-encrypt an existing secret under a PRF-derived key (random salt per secret) | 1 each |
| `MeraError` / `isMeraError` | codes: `PASSKEY_OPERATION_FAILED`, `CRYPTO_UNAVAILABLE`, `PRF_UNAVAILABLE`, `SESSION_ENDED`, `DECRYPT_FAILED`, `INPUT_INVALID`, `VAULT_FORMAT_INVALID` | |

**Default PRF salt:** `sha256("mera.prf.salt.v1")`. It is documented as never changing across versions. The PRF output is a deterministic function of (credential, rpId, salt). [F]

**Derivation (app-owned):** Mera's docs and demo map the PRF output to BIP-39 entropy, then a seed, then BIP-32 `m/44'/60'/0'/0/i`. The spike uses the same mapping. Checked firsthand in Node with a fixed stand-in PRF value: the derivation is deterministic, the address equals viem `mnemonicToAccount(entropyToMnemonic(prf))`, so it is **importable into MetaMask**, `signMessage` verifies, and signing after `end()` throws `SESSION_ENDED`. [F]

## The three spike questions

### (a) Passkey login: yes [F build, U ceremony]

`createPasskeyWithPrfOutput` handles sign-up and `getPasskeyPrfOutput` handles login. Store only `{credentialId, transports}` (to pin the passkey) and the public address. The ceremony itself has not been run yet (the human does that).

### (b) Signing session: yes, but the bounds are ours [F]

A Mera "signing session" is **only** "a private key in memory until `end()`". **It has no built-in TTL, scope, spend limit or onchain enforcement.** The time and scope bounds the Mera UX bounty judges ("session design") have to be built by the app:

- The spike wraps the session in a bounded session: a 5-minute TTL (auto `end()`), messages must start with an app prefix, and txs are limited to chain 10143, `to == self` and `value == 0`. The scope checks are in **page JS**. They stop honest-app mistakes, not an attacker who already runs code on the page.
- Once the session is live, signing is prompt-free. Only starting it costs a prompt.
- **Built 2026-09-30** (`web/app/lib/backer.client.ts`): login and session start share one ceremony, TTL 15 minutes, scope as below minus the chain-143 part (the page's `CHAIN_ID`), plus the testnet AUSD faucet. Approvals are for the exact amount. rpId is `proofbook.app` on every proofbook.app host, otherwise the hostname.
- **Original design suggestion:** scope a backer session to `{AUSD.approve(vault, ≤cap), vault.deposit(≤cap), vault.redeem/withdraw(own shares)}` on chain 143, with the TTL shown in the UI. For onchain enforcement we'd need EIP-7702 delegation to a session-key contract (`toViemAccount` supports `signAuthorization`). On Monad, 7702-delegated EOAs must keep 10 MON and cannot CREATE (see `monad.md`). That's out of scope unless it's cheap.

### (c) Stateless test: yes by construction [F code, U live]

Clear storage or use a new device, click "Log in with any passkey", and `getPasskeyPrfOutput({ rpId })` without a credential returns the same PRF output, so the same seed and the same address. Nothing secret is stored. The app only needs to re-derive. The prerequisite is that the passkey syncs (iCloud Keychain, GPM, 1Password) and the **rpId is the same**.

## Cloudflare Workers + React Router v7 [F]

- **Mera never runs in the Worker.** It needs `navigator.credentials` (browser only) and `globalThis.crypto` (`getRandomValues`, plus `subtle` for vaults). It has no Node APIs and no WASM. The spike imports it only from `app/lib/mera.client.ts`. `grep` finds **no Mera code in `build/server`**, only in the client `home` chunk.
- `pnpm build` works. `wrangler deploy --dry-run` reports Worker modules at **699.63 KiB (146.70 KiB gzip)**, with no bindings. The client route chunk with Mera, viem and scure is 311 KB (107.8 KB gzip).
- `pnpm dev` (workerd via `@cloudflare/vite-plugin`) SSRs the page and it hydrates. Checked in a browser: the client module loads, and `PublicKeyCredential.getClientCapabilities()` reports `extension:prf: true` in the desktop app's Chromium pane (that's capability only, not a ceremony).
- The public testnet RPC `https://testnet-rpc.monad.xyz` allows browser CORS (it echoes the Origin) and returns chain `0x279f` (10143).

## Gotchas

1. **Spec conflict: React Router version.** Spec §3 says v7. `create-cloudflare --framework=react-router` now installs **v8.4.0**, and `remix-run/react-router-templates/cloudflare` has been removed. The spike pins **7.18.4**, which needs (i) a hand-written Web-streams `app/entry.server.tsx` and (ii) `future.v8_viteEnvironmentApi: true`. v8 needs neither. Decide v7 or v8 before scaffolding `web/`.
2. **rpId binds the accounts.** Passkeys and derived accounts exist only under the rpId they were created for: `localhost` ≠ `proofbook.app`. Changing domains later loses every backer account unless they export first. Fix the rpId as `proofbook.app` (it covers subdomains) before any real backer signs up.
3. **Authenticator support.** Local Chrome-profile passkeys, Bitwarden and Dashlane return no PRF, so you get `PRF_UNAVAILABLE` (Mera's table as of 2026-06). Chrome on desktop needs Google Password Manager with "Offer to save passwords and passkeys" turned on. The UI needs a clear message for this. [D]
4. **"Create" twice means two accounts.** Each create uses a random `user.id`, so it adds a passkey and a different account. Returning users should be steered to "Log in" (discoverable).
5. **Time-to-first-tx vs gas.** A new Mera account is an EOA with 0 MON, so it can't pay gas for `approve`/`deposit`. The Agora demo (passkey → AUSD → Perpl trade) needs a funding story: faucet or drip, a sponsored relayer, or 7702 plus a paymaster. Mera provides none of these. Also: gas is charged on the **limit**, so set tight limits. The 10 MON reserve applies to the backer EOA's *native value* spends. Token transfers with value 0 are fine.
6. **"No seed phrase" rule.** The Mera UX bounty requires no seed phrase. The BIP-39 mnemonic is an internal derivation step. Don't show it. Only offer it (if at all) as an explicit "export backup". Note that the PRF output is equivalent to a seed phrase.
7. **Freeze the derivation before mainnet.** Changing the salt, the BIP-39 mapping or the path changes every address.
8. **Page-JS trust boundary.** A live session can be used by any script on the origin. Keep sessions short, keep dependencies minimal, and add a CSP on the Worker responses.
9. **Vite dev first load** can fail to hydrate with "504 Outdated Optimize Dep". Fixed with `optimizeDeps.include` for Mera, scure and viem (see `spikes/mera/vite.config.ts`).
10. **Session start costs a prompt.** In the spike, "Log in" and "Start session" are separate ceremonies (two prompts in total). The real app should start the session from the login ceremony (one prompt to first signature).

## Verified in production (2026-09-30, human test on https://proofbook.app/agent/1951)

- [x] Create an account with a passkey (rpId `proofbook.app`), which also starts the signing session in the same ceremony.
- [x] Test funds, then approve and deposit with no further prompts: 200 AUSD into house agent #1's vault from `0x3Bd5…0D0E` (`0x92d5227d3311c4bcf6623409708ebbbc41cf8e975336d5b7448f2f836142c2c4`). The indexer, the site's activity feed and the backer count (2) all picked it up.
- [x] **Stateless test:** clear site data, then "Log in with a passkey" gives the **same address**.
- [ ] Not yet recorded: browser and authenticator used, prompt count, the taps and seconds to the first deposit, a withdrawal from the UI, and a true second device.

## Pending human verification for the spike (run `spikes/mera/README.md` → "Manual test script")

- [ ] Create a passkey on localhost (browser, authenticator, number of prompts).
- [ ] Reload shows the cached address. `localStorage` holds only `credentialId`, transports and address.
- [ ] Start a session: 1 prompt. Then 3 or more prompt-free signatures, each `verifies: true`.
- [ ] Out-of-scope message is refused. End or expire stops signing.
- [ ] Optional: 0-value self tx on 10143 lands (needs faucet MON).
- [ ] Stateless: "Forget this device", then "Log in with any passkey" gives the **same address**.
- [ ] Fresh profile or another browser on the same passkey provider gives the same address.
- [ ] True second device: needs an HTTPS host (preview deploy or tunnel). Human approval needed before any deploy.
