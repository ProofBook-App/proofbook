# Privy reference (server wallets and policies)

Last verified **2026-09-29**. "Firsthand" means we observed it against the live API with `spikes/privy/spike.mjs`. "Docs" means docs.privy.io claims it and we did not test it.

- **Use in Proofbook:** each house agent's session key is a Privy server wallet. A Privy policy limits it to `AgentVault.execute(address,bytes)` on its own vault. This is for the Privy bounty ($5k, all tracks, "beyond login"). Backers use Mera, not Privy. See `docs/open-questions.md`.
- **API:** REST at `https://api.privy.io`. Auth is Basic `app_id:app_secret` plus the `privy-app-id` header. Wallet actions go to `POST /v1/wallets/{id}/rpc`.

## Firsthand results (2026-09-29, sign-only on chain 143)

**Verdict: yes.** A Privy server wallet can be a house-agent session key on `eip155:143`, and the policy engine enforces "only `execute` on this vault" before signing. Nothing was broadcast, and the wallet holds 0 MON.

| Resource | ID |
|---|---|
| Policy `proofbook-house-agent: AgentVault.execute only` | `mf16tutkqae6us5p5anpbi9b` |
| Server wallet | `rpl0pqwarqch5idnfka2lrfx`, address `0xb3d11BABa5CB53E6B784A0C0C58A1Fd59FDE3C7B` |
| Owner (key quorum auto-created from our P-256 public key) | `n34l6qhz4sc75bvnqu29ybfp` |

The private half of the owner key is `PRIVY_AUTH_KEY` in `.env` (only the name is in `.env.example`). Privy does not store it. **If it is lost, the wallet can no longer sign and the policy can no longer be changed.**

Vault used: `0x4DcFDF391b30d709886656C9Cc2645BC0F0Cde77`, with `execute(address,bytes)` = `0x1cff79cd` (`cast sig`). **`cast code` shows this address has code on testnet 10143 and none on mainnet 143.** The policy test only needs a `to` address, but the real mainnet policy needs the mainnet vault address once it is deployed.

Policy rules (the same conditions for `eth_signTransaction` and `eth_sendTransaction`, all ANDed, action `ALLOW`):

```json
[
  {"field_source":"ethereum_transaction","field":"to","operator":"eq","value":"0x4DcFDF391b30d709886656C9Cc2645BC0F0Cde77"},
  {"field_source":"ethereum_transaction","field":"chain_id","operator":"eq","value":"143"},
  {"field_source":"ethereum_transaction","field":"value","operator":"eq","value":"0"},
  {"field_source":"ethereum_calldata","field":"function_name","abi":[<execute(address venue, bytes data)>],"operator":"eq","value":"execute"}
]
```

| Case (`eth_signTransaction` unless noted) | Result |
|---|---|
| `execute(0x…dEaD, 0xdeadbeef)` on vault, chain 143, value `0x0`, type 2 | **200**, `{"method":"eth_signTransaction","data":{"signed_transaction":"0x02f8f2818f…","encoding":"rlp"}}`. `cast decode-transaction` gives signer `0xb3d11baba5cb53e6b784a0c0c58a1fd59fde3c7b` (= wallet), chainId `0x8f`, input `0x1cff79cd…` |
| Same, but `to` lowercased | **200**. The `to` comparison is effectively case-insensitive, even though the docs say "all string comparisons are case-sensitive". |
| Same, but `value` omitted | **200**. A missing value is treated as 0. |
| `execute` calldata sent to another address (AUSD) | **400** `{"error":"RPC request denied due to policy violation","code":"policy_violation"}` |
| Different selector on vault (`transfer(address,uint256)`) | **400** `policy_violation` (same body) |
| `execute` on vault with value 1 wei | **400** `policy_violation` |
| `execute` on vault with chain_id 10143 | **400** `policy_violation` |
| Plain 1-wei MON transfer, no data | **400** `policy_violation` |
| Allowed tx without a `privy-authorization-signature` header | **401** `{"error":"Missing \`privy-authorization-signature\` header or no signatures provided. Learn more about authorization signatures here: https://docs.privy.io/api-reference/authorization-signatures"}` |
| `personal_sign` (no rule for that method) | **400** `policy_violation`. Methods without a rule are denied by default. |
| `PATCH /v1/policies/{id}` with only the app secret | **401**, same message plus `"code":"invalid_data"`. A leaked app secret cannot loosen the policy. |

Other firsthand notes:
- Rule `name` must be **under 50 characters**. Otherwise: `400 {"error":"Validation error: Rule name must be fewer than 50 characters at \"rules[0].name\"…","code":"invalid_policy_format"}`.
- Creating a policy or wallet with `owner: {public_key}` needs no authorization signature. Privy creates the key quorum and returns `owner_id`.
- Once a wallet has an owner, every `/rpc` call needs the owner's signature: an ECDSA P-256 / SHA-256 signature over RFC 8785-canonical JSON `{version:1, method, url, body, headers:{privy-app-id, privy-request-expiry}}`, sent base64 DER in `privy-authorization-signature`. We implement it in about 10 lines with `node:crypto` and no SDK. `privy-request-expiry` (unix ms) is optional, but if sent it must be part of the signed payload.
- A denial costs nothing onchain, because the policy runs before signing. Only an error comes back.

## House agent #1 on testnet (2026-10-02, firsthand)

Created by `agents/scripts/privy-setup.mjs` for the `proofbook-agents` Worker.

| Resource | ID |
|---|---|
| Policy (chain 10143, to = vault `0x98e2…2B53`, value 0, `execute`, venue = PerplAdapter `0x583B…aB09`) | `gpyj5hvzmj9auwjgm51ovqkl` |
| Server wallet (house agent #1's session key once rotated) | `wnv9gal23ndaqtce5l0kgz2i`, address `0x552874909A030344fC5eBB4E29A935E2bEe8B082` |

The script's two signing checks: `execute(adapter)` on the vault was **signed**, and `execute(0x…dEaD)` on the vault got **`policy_violation`**. So the calldata rule on `execute`'s `venue` argument works: Privy enforces the adapter allowlist as well as the vault.

## Doc claims (not verified firsthand)

- **Chain support:** EVM is "Tier 3" (sign, send, track). Monad `eip155:143` and Monad Testnet `eip155:10143` appear in Privy's EVM chain tables (swaps, deposit automations) and in the gas-sponsorship network list. Docs don't say which RPC Privy uses to broadcast on Monad. Client SDK docs mention "Privy's default RPC providers" with rate limits.
- **`eth_sendTransaction`:** `POST /rpc` with `"caip2":"eip155:143"`. Privy fills gas and nonce, signs, broadcasts, and returns `hash` plus `transaction_id`. For sign-and-broadcast calls, **simulation runs before the policy**, so a reverting or underfunded tx returns the simulation error rather than `policy_violation`.
- **Gas sponsorship:** "App pays" lists **Monad** and **Monad Testnet**. Pass `"sponsor": true` on `eth_sendTransaction`. It uses EIP-7702 plus a paymaster (Alchemy-powered). It has to be enabled in Dashboard → Fee sponsorship, and mainnet needs a saved payment method or prepaid credits. Unverified for Proofbook: how 7702 delegation of the session-key EOA interacts with Monad's reserve-balance rule, and whether the policy is still checked against the inner call.
- **Rate limits:** there are no published numbers. Limits are "per endpoint", return 429, and should be retried with exponential backoff.
- **Pricing (privy.io/pricing):** the free Developer plan includes **50K signatures/month and $1M tx volume**, for 0–499 MAU. A signature is any signing request (`eth_signTransaction`, `eth_sendTransaction`, `personal_sign`, …). Above 50K it is $0.01/signature (PAYG $2,000 base). The policy engine and native gas sponsorship are in all plans. A house agent trading every few minutes uses a few thousand signatures a month, well inside the free tier.

## Recommended integration for house agents

1. One Privy wallet per house agent, with one policy per vault (docs: "only one policy is supported" per wallet). Owner = the `PRIVY_AUTH_KEY` quorum. Register the wallet address as the vault's session key.
2. **Sign with Privy and broadcast ourselves:** `eth_signTransaction` → `eth_sendRawTransaction` on our RPC. This lets us set an **explicit tight `gas_limit`**, which matters because Monad charges on the gas limit, and it avoids depending on Privy's Monad RPC. This path is the one proven above.
3. The wallet EOA must hold **>10 MON** on mainnet (Monad reserve rule), unless 7702 sponsorship turns out to work for us.
4. Defence in depth, optional: add `execute.venue in [adapter addresses]` (field source `ethereum_calldata`) so Privy also enforces the adapter allowlist. The vault already enforces it onchain (invariant 1).
5. The policy also has an `eth_sendTransaction` rule, so the Privy-broadcast path (and sponsorship) can be tried later without a policy change.

## Human to-dos in the Privy dashboard

- Nothing was required for this spike. Policies, wallets and owners were all created via the API.
- Before mainnet: create the real policy with the **mainnet vault address** (new policy, or a `PATCH` signed by `PRIVY_AUTH_KEY`) and archive the spike wallet and policy.
- Optional: enable Fee sponsorship for Monad (needs a payment method or credits) if we want Privy-sponsored gas. Optional: add IP allowlisting for the app secret.
- Back up `PRIVY_AUTH_KEY` in the team password manager. It cannot be recovered.

Sources: docs.privy.io (`/controls/policies/overview`, `/controls/policies/create-a-policy`, `/controls/policies/example-policies/ethereum`, `/api-reference/wallets/ethereum/eth-sign-transaction`, `/api-reference/authorization-signatures`, `/controls/authorization-keys/using-owners/sign/direct-implementation`, `/wallets/overview/chains`, `/wallets/gas-and-asset-management/gas/overview`, `/recipes/dashboard/optimizing`), privy.io/pricing. Fetched 2026-09-29.
