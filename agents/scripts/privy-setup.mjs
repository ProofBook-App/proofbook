#!/usr/bin/env node
// HUMAN-RUN. Creates the Privy policy and server wallet for one house agent on Monad TESTNET (10143).
//
//   cd agents
//   node --env-file=../.env scripts/privy-setup.mjs \
//     --vault 0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53 --adapter 0x583B6bCFcAec599E6Fc09e27db581d6abe7baB09
//
// Reads PRIVY_APP_ID, PRIVY_APP_SECRET and PRIVY_AUTH_KEY from the environment and never prints them.
// Prints only the policy id, the wallet id and the wallet address. Run it once per house agent: each
// run makes a NEW policy and wallet. Nothing is sent onchain and no MON moves.
//
// Policy (all conditions ANDed, action ALLOW, for eth_signTransaction and eth_sendTransaction):
//   to = vault, chain_id = 10143, value = 0, function = execute(address venue, bytes data),
//   and execute.venue = adapter (Privy also enforces the adapter allowlist; the vault does onchain).
// Owner of both = the key quorum of PRIVY_AUTH_KEY's public key, so only that key can sign or change them.
//
// After creating, it asks Privy to SIGN (not send) two transactions to show the policy working:
//   1. vault.execute(adapter, 0x) on 10143       → expected: signed (the policy allows it)
//   2. vault.execute(0x…dEaD, 0x) on 10143       → expected: policy_violation (wrong venue)
// Pass --no-venue-rule if case 1 is denied too (Privy's calldata address matching is unverified for us:
// docs/reference/privy.md). Then the policy is to/chain/value/function only, as in the Day 0 spike.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { parseArgs } from "node:util";
import { authorizationSignature, importAuthKey, PRIVY_API } from "../src/privy.ts";

const CHAIN_ID = 10143;
const EXECUTE_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "venue", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
];

const { values } = parseArgs({
  options: {
    vault: { type: "string" },
    adapter: { type: "string" },
    name: { type: "string", default: "proofbook house agent testnet" },
    "no-venue-rule": { type: "boolean", default: false },
  },
});
const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
if (!isAddr(values.vault) || !isAddr(values.adapter)) {
  console.error("usage: node --env-file=../.env scripts/privy-setup.mjs --vault <AgentVault> --adapter <PerplAdapter> [--no-venue-rule]");
  process.exit(1);
}
const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: appSecret, PRIVY_AUTH_KEY: authKey } = process.env;
const missing = ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_AUTH_KEY"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing from the environment: ${missing.join(", ")}`);
  process.exit(1);
}

const der = Buffer.from(authKey.trim().replace(/^wallet-auth:/, ""), "base64");
const publicKey = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }))
  .export({ format: "der", type: "spki" })
  .toString("base64");
const signingKey = await importAuthKey(authKey);

async function privy(method, path, body, { signed = true } = {}) {
  const url = `${PRIVY_API}${path}`;
  const privyHeaders = { "privy-app-id": appId, "privy-request-expiry": String(Date.now() + 60_000) };
  const headers = {
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    "Content-Type": "application/json",
    ...privyHeaders,
  };
  if (signed) headers["privy-authorization-signature"] = await authorizationSignature(signingKey, method, url, body, privyHeaders);
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const conditions = [
  { field_source: "ethereum_transaction", field: "to", operator: "eq", value: values.vault },
  { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(CHAIN_ID) },
  { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
  { field_source: "ethereum_calldata", field: "function_name", abi: EXECUTE_ABI, operator: "eq", value: "execute" },
];
if (!values["no-venue-rule"]) {
  conditions.push({ field_source: "ethereum_calldata", field: "execute.venue", abi: EXECUTE_ABI, operator: "eq", value: values.adapter });
}

const policy = await privy(
  "POST",
  "/v1/policies",
  {
    version: "1.0",
    name: values.name.slice(0, 49),
    chain_type: "ethereum",
    // Rule names must be under 50 characters (docs/reference/privy.md).
    rules: ["eth_signTransaction", "eth_sendTransaction"].map((method) => ({
      name: `vault.execute ${CHAIN_ID} ${method}`,
      method,
      action: "ALLOW",
      conditions,
    })),
    owner: { public_key: publicKey },
  },
  { signed: false },
);
if (policy.status !== 200) {
  console.error(`policy create failed: HTTP ${policy.status} ${JSON.stringify(policy.body)}`);
  process.exit(1);
}

const wallet = await privy(
  "POST",
  "/v1/wallets",
  { chain_type: "ethereum", policy_ids: [policy.body.id], owner: { public_key: publicKey } },
  { signed: false },
);
if (wallet.status !== 200) {
  console.error(`wallet create failed: HTTP ${wallet.status} ${JSON.stringify(wallet.body)} (policy ${policy.body.id} was created)`);
  process.exit(1);
}

console.log(`policy id       ${policy.body.id}`);
console.log(`wallet id       ${wallet.body.id}`);
console.log(`wallet address  ${wallet.body.address}`);

// ---- sign-only policy check (nothing is broadcast)
const pad32 = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const executeData = (venue) => `0x1cff79cd${pad32(venue)}${pad32("0x40")}${pad32("0x0")}`;
const tx = (venue) => ({
  type: 2,
  chain_id: CHAIN_ID,
  to: values.vault,
  value: "0x0",
  data: executeData(venue),
  nonce: 0,
  gas_limit: 300000,
  max_fee_per_gas: "0x2e90edd000",
  max_priority_fee_per_gas: "0x3b9aca00",
});
for (const [label, venue, expect] of [
  ["execute(adapter) on the vault", values.adapter, "signed"],
  ["execute(0x…dEaD) on the vault", "0x000000000000000000000000000000000000dEaD", values["no-venue-rule"] ? "signed" : "policy_violation"],
]) {
  const r = await privy("POST", `/v1/wallets/${wallet.body.id}/rpc`, { method: "eth_signTransaction", params: { transaction: tx(venue) } });
  const got = r.status === 200 ? "signed" : (r.body?.code ?? `HTTP ${r.status}`);
  console.log(`policy check    ${label}: ${got} (expected ${expect})${got === expect ? "" : "  <-- MISMATCH"}`);
}
console.log("\nNext: put the wallet id and address into agents/wrangler.jsonc (HOUSE_AGENTS), then agents/scripts/rotate-and-fund.sh.");
