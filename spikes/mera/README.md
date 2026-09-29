# Mera spike (Day 0)

Throwaway spike: can the Mera SDK give backers (a) passkey login, (b) a prompt-free signing session with a time and scope bound, and (c) identity that rebuilds from the passkey alone, inside a React Router v7 app on Cloudflare Workers? Findings are in [`docs/reference/mera.md`](../../docs/reference/mera.md).

This folder is **not** part of the root pnpm workspace. It has its own `pnpm-workspace.yaml` (created by `create-cloudflare`, only to pre-approve `esbuild`/`workerd` build scripts) and its own lockfile.

Target is **Monad testnet (10143) only**. No real funds are involved. The `deploy` script was removed on purpose. `pnpm check:bundle` runs `wrangler deploy --dry-run`, which builds and validates the Worker bundle without uploading anything.

## Run

```bash
source ~/.nvm/nvm.sh && nvm use 24
cd spikes/mera
pnpm install
pnpm dev --port 5174        # http://localhost:5174
pnpm build                  # build/server (Worker) + build/client (assets)
pnpm check:bundle           # build + wrangler dry-run; no upload
```

Use `http://localhost:5174`, not `127.0.0.1` or a LAN IP. WebAuthn needs a secure context, and `localhost` is the only non-HTTPS host that counts. The passkey is bound to the hostname (rpId), so a passkey made here does not work on `proofbook.app`.

## What is where

- `app/lib/mera.client.ts`: every Mera, `@scure/*` and viem call. The `.client.ts` suffix keeps it out of the Worker bundle, so the Worker never runs Mera.
- `app/routes/home.tsx`: the single page.
- `app/entry.server.tsx`: Web-streams SSR entry. React Router v7 needs it on Workers. v8 infers it, and the `create-cloudflare` template now ships v8.
- `react-router.config.ts`: `future.v8_viteEnvironmentApi: true`, which v7 needs for `@cloudflare/vite-plugin`.

## Scaffold

`pnpm create cloudflare@latest mera --framework=react-router --platform=workers --no-deploy --no-git` (C3, 2026-09-29), then pinned from v8 down to React Router 7.18.4 to match spec §3. The `remix-run/react-router-templates/cloudflare` template no longer exists. The welcome page and the C3 `.agents/` skill file were removed.

## Dependencies (one line each)

| Package | Version | Why |
| --- | --- | --- |
| `@category-labs/mera` | 0.2.0 (exact) | The thing under test: passkey PRF ceremonies, secp256k1 signing session, `toViemAccount` adapter. Pinned exactly because it is pre-1.0 and the API may change. |
| `@scure/bip39` | ^2.4.0 | Maps the 32-byte PRF output to BIP-39 entropy and a seed. This is Mera's documented derivation, and it keeps the account importable into MetaMask. |
| `@scure/bip32` | ^2.4.0 | Derives the BIP-44 EVM key `m/44'/60'/0'/0/0` from the seed (Mera's documented path). |
| `viem` | ^2.57.1 | Mera's optional peer dep for `@category-labs/mera/viem`. Also used for message verification, the `monadTestnet` chain definition and the 0-value testnet tx. |
| `react-router`, `@react-router/dev` | 7.18.4 | Pinned to v7 (spec §3). The C3 template installs v8. |
| everything else | from C3 | `create-cloudflare` React Router template: vite 8, `@cloudflare/vite-plugin`, wrangler 4, Tailwind 4, isbot. |

## Manual test script (human only)

The agent did not create any passkey. Use a PRF-capable authenticator: iCloud Keychain (Safari or Chrome on macOS 15+), Google Password Manager (Chrome desktop signed in, or Android), or 1Password. **Not** the local Chrome profile, Bitwarden or Dashlane: they return no PRF and you get `PRF_UNAVAILABLE`.

1. `pnpm dev --port 5174` and open `http://localhost:5174`.
2. **Create.** Click **Create passkey** and complete the prompt. Some authenticators show two prompts. Write down the address shown and its label ("derived from passkey").
3. **Reload.** The address shows as "cached on this device, not yet re-derived", with no prompt. Only the public address and credential ID are in `localStorage` (check DevTools → Application → Local Storage → `proofbook.spike.mera`). There should be no key or PRF bytes.
4. **Session.** Click **Start signing session (1 prompt)** and complete one prompt. The countdown starts at about 300s.
5. **Prompt-free signing.** Click **Sign harmless message** 3 or more times. You should get **no** OS or browser prompt, and each log line should say `verifies: true`.
6. **Scope.** Click **Try out-of-scope message**. It must fail with `Out of scope: message must start with "Proofbook spike:"`.
7. **Optional tx.** Fund the address from https://testnet.monad.xyz, click **Check testnet MON**, then **Send 0-value self tx**. There should be no prompt, and the log shows a `testnet.monadexplorer.com/tx/…` link. Gas limit is pinned at 21000. Value 0 means the 10 MON reserve rule doesn't come into play.
8. **Expiry.** Click **End session** (or wait 5 min). Signing buttons disable and a sign attempt needs a new session.
9. **Stateless test, same browser.** Click **Forget this device**. The address disappears. Click **Log in with any passkey**, pick the passkey, and the **same address** from step 2 should come back.
10. **Stateless test, fresh profile.** Open a private window, or a different browser or profile that shares the same passkey provider (for example iCloud Keychain on Safari). Go to `http://localhost:5174` and click **Log in with any passkey**. You should get the same address. For a true second device you need an HTTPS host (a preview deploy or a tunnel), because the rpId must match. That is out of scope for this spike and needs approval before any deploy.
11. Record results (browser, authenticator, number of prompts at create/login/session, pass or fail per step) in `docs/reference/mera.md` under "Pending human verification".
