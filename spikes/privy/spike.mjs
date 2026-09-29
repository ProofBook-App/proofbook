#!/usr/bin/env node
// Day 0 spike: can a Privy server wallet act as a house-agent session key on Monad (eip155:143),
// with a Privy policy that only allows AgentVault.execute(address,bytes) on one vault?
//
// Sign-only (eth_signTransaction). Sends nothing, moves no funds.
// No dependencies: plain fetch + node:crypto. Node >= 22 (tested on 24).
//
// Secrets (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTH_KEY) are read from the repo-root .env and never printed.
// If PRIVY_AUTH_KEY is missing, a fresh P-256 authorization key is generated and appended to .env.
// Non-secret IDs (policy id, wallet id/address, owner public key) are cached in ./state.json.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(HERE, '../../.env');
const STATE_PATH = join(HERE, 'state.json');
const RESULTS_PATH = join(HERE, 'results.json');
const API = 'https://api.privy.io';

// ---- test parameters -------------------------------------------------------------------------
const VAULT = '0x4DcFDF391b30d709886656C9Cc2645BC0F0Cde77'; // AgentVault (deployed on testnet 10143)
const EXECUTE_SELECTOR = '0x1cff79cd'; // cast sig 'execute(address,bytes)'
const CHAIN_ID = 143;
const OTHER_ADDRESS = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'; // AUSD, as "some other contract"
const DUMMY_VENUE = '0x000000000000000000000000000000000000dEaD';

const EXECUTE_ABI = [{
  type: 'function', name: 'execute', stateMutability: 'nonpayable',
  inputs: [{ name: 'venue', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [],
}];

// ---- env ---------------------------------------------------------------------------------------
function loadEnv() {
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = loadEnv();
const APP_ID = env.PRIVY_APP_ID;
const APP_SECRET = env.PRIVY_APP_SECRET;
if (!APP_ID || !APP_SECRET) throw new Error('PRIVY_APP_ID / PRIVY_APP_SECRET missing from .env');

// ---- authorization key (P-256) -----------------------------------------------------------------
function ensureAuthKey() {
  let raw = env.PRIVY_AUTH_KEY;
  if (!raw) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    raw = `wallet-auth:${pkcs8}`;
    appendFileSync(ENV_PATH, `\n# Privy authorization key (P-256, PKCS8 base64) owning the house-agent wallet + policy\nPRIVY_AUTH_KEY=${raw}\n`);
    console.log('Generated a new authorization key and appended PRIVY_AUTH_KEY to .env (value not shown).');
  }
  const der = Buffer.from(raw.replace(/^wallet-auth:/, ''), 'base64');
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
  return { key, publicKey };
}
const auth = ensureAuthKey();

// RFC 8785 canonical JSON (sufficient for our payloads: strings, ints, bools, null, arrays, objects).
function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
}

function authSignature(method, url, body, privyHeaders) {
  const payload = { version: 1, method, url, body, headers: privyHeaders };
  return sign('sha256', Buffer.from(canonicalize(payload)), auth.key).toString('base64');
}

// ---- HTTP --------------------------------------------------------------------------------------
async function privy(method, path, body, { signed = true } = {}) {
  const url = `${API}${path}`;
  const privyHeaders = { 'privy-app-id': APP_ID, 'privy-request-expiry': String(Date.now() + 60_000) };
  const headers = {
    Authorization: `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`,
    'Content-Type': 'application/json',
    ...privyHeaders,
  };
  if (signed && method !== 'GET') headers['privy-authorization-signature'] = authSignature(method, url, body, privyHeaders);
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// ---- helpers -----------------------------------------------------------------------------------
const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
function encodeExecute(venue, inner) {
  const d = inner.replace(/^0x/, '');
  const len = d.length / 2;
  const padded = d.padEnd(Math.ceil(len / 32) * 64, '0');
  return EXECUTE_SELECTOR + pad32(venue) + pad32('0x40') + pad32('0x' + len.toString(16)) + padded;
}

function baseTx(overrides = {}) {
  return {
    type: 2,
    chain_id: CHAIN_ID,
    to: VAULT,
    value: '0x0',
    data: encodeExecute(DUMMY_VENUE, '0xdeadbeef'),
    nonce: 0,
    gas_limit: 300000,
    max_fee_per_gas: '0x2e90edd000', // 200 gwei
    max_priority_fee_per_gas: '0x3b9aca00', // 1 gwei
    ...overrides,
  };
}

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
const saveState = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');

// ---- 1. policy ---------------------------------------------------------------------------------
function policyBody() {
  const conditions = [
    { field_source: 'ethereum_transaction', field: 'to', operator: 'eq', value: VAULT },
    { field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: String(CHAIN_ID) },
    { field_source: 'ethereum_transaction', field: 'value', operator: 'eq', value: '0' },
    { field_source: 'ethereum_calldata', field: 'function_name', abi: EXECUTE_ABI, operator: 'eq', value: 'execute' },
  ];
  return {
    version: '1.0',
    name: 'proofbook-house-agent: AgentVault.execute only',
    chain_type: 'ethereum',
    rules: ['eth_signTransaction', 'eth_sendTransaction'].map((method) => ({
      name: `vault.execute ${CHAIN_ID} ${method}`,
      method, action: 'ALLOW', conditions,
    })),
    owner: { public_key: auth.publicKey },
  };
}

async function ensurePolicy() {
  if (state.policyId) {
    const r = await privy('GET', `/v1/policies/${state.policyId}`);
    if (r.status === 200) return r.body;
  }
  const r = await privy('POST', '/v1/policies', policyBody(), { signed: false });
  console.log('create policy ->', r.status);
  if (r.status !== 200) { console.log(JSON.stringify(r.body, null, 2)); throw new Error('policy create failed'); }
  state.policyId = r.body.id; state.policyOwnerId = r.body.owner_id; state.ownerPublicKey = auth.publicKey; saveState();
  return r.body;
}

// ---- 2. wallet ---------------------------------------------------------------------------------
async function ensureWallet() {
  if (state.walletId) {
    const r = await privy('GET', `/v1/wallets/${state.walletId}`);
    if (r.status === 200) return r.body;
  }
  const r = await privy('POST', '/v1/wallets', {
    chain_type: 'ethereum',
    policy_ids: [state.policyId],
    owner: { public_key: auth.publicKey },
  }, { signed: false });
  console.log('create wallet ->', r.status);
  if (r.status !== 200) { console.log(JSON.stringify(r.body, null, 2)); throw new Error('wallet create failed'); }
  state.walletId = r.body.id; state.walletAddress = r.body.address; state.walletOwnerId = r.body.owner_id; saveState();
  return r.body;
}

// ---- 3/4. cases --------------------------------------------------------------------------------
async function signTx(tx, opts) {
  return privy('POST', `/v1/wallets/${state.walletId}/rpc`, { method: 'eth_signTransaction', params: { transaction: tx } }, opts);
}

function recover(raw) {
  const out = execFileSync('cast', ['decode-transaction', raw], { encoding: 'utf8' });
  let d = JSON.parse(out);
  if (typeof d === 'string') d = JSON.parse(d); // cast 1.8.3 prints a JSON-encoded string
  return d;
}

async function main() {
  const policy = await ensurePolicy();
  const wallet = await ensureWallet();
  console.log(`policy ${policy.id} owner ${policy.owner_id}`);
  console.log(`wallet ${wallet.id} ${wallet.address} policies ${JSON.stringify(wallet.policy_ids)} owner ${wallet.owner_id}`);

  const cases = [
    { name: 'allowed: execute() on vault, chain 143, value 0', expect: 'allow', tx: baseTx() },
    { name: 'allowed?: vault address lowercased in request', expect: 'allow?', tx: baseTx({ to: VAULT.toLowerCase() }) },
    { name: 'allowed?: value field omitted', expect: 'allow?', tx: (({ value, ...t }) => t)(baseTx()) },
    { name: 'deny: execute() calldata to another address', expect: 'deny', tx: baseTx({ to: OTHER_ADDRESS }) },
    { name: 'deny: different selector on vault (transfer(address,uint256))', expect: 'deny',
      tx: baseTx({ data: '0xa9059cbb' + pad32(OTHER_ADDRESS) + pad32('0x1') }) },
    { name: 'deny: execute() on vault with value 1 wei', expect: 'deny', tx: baseTx({ value: '0x1' }) },
    { name: 'deny: execute() on vault, chain 10143', expect: 'deny', tx: baseTx({ chain_id: 10143 }) },
    { name: 'deny: plain MON transfer (no data)', expect: 'deny', tx: baseTx({ to: OTHER_ADDRESS, data: '0x', value: '0x1' }) },
    { name: 'deny: allowed tx but NO authorization signature', expect: 'deny', tx: baseTx(), opts: { signed: false } },
  ];

  const results = [];
  for (const c of cases) {
    const r = await signTx(c.tx, c.opts);
    const entry = { case: c.name, expect: c.expect, status: r.status, response: r.body };
    const raw = r.body?.data?.signed_transaction;
    if (raw) {
      const d = recover(raw);
      entry.decoded = { signer: d.signer, chainId: d.chainId, to: d.to, value: d.value, input: d.input?.slice(0, 10) };
      entry.signerMatchesWallet = d.signer?.toLowerCase() === wallet.address.toLowerCase();
    }
    const verdict = r.status === 200 ? 'SIGNED' : 'REJECTED';
    console.log(`\n[${verdict}] ${c.name} (expect ${c.expect}) -> HTTP ${r.status}`);
    console.log(JSON.stringify(raw ? { ...entry, response: { method: r.body.method, encoding: r.body.data.encoding } } : r.body));
    if (entry.decoded) console.log(`  cast signer ${entry.decoded.signer} matches wallet: ${entry.signerMatchesWallet}`);
    results.push(entry);
  }

  // No rule for personal_sign -> should be denied by default.
  const ps = await privy('POST', `/v1/wallets/${state.walletId}/rpc`, { method: 'personal_sign', params: { message: 'hello', encoding: 'utf-8' } });
  console.log(`\n[${ps.status === 200 ? 'SIGNED' : 'REJECTED'}] deny: personal_sign (no rule) -> HTTP ${ps.status}\n${JSON.stringify(ps.body)}`);
  results.push({ case: 'deny: personal_sign (no rule)', expect: 'deny', status: ps.status, response: ps.body });

  // Owner protection: loosening the policy with only the app secret (no owner signature) must fail.
  const patch = await privy('PATCH', `/v1/policies/${state.policyId}`, { name: 'loosened without owner sig' }, { signed: false });
  console.log(`\n[${patch.status === 200 ? 'UPDATED' : 'REJECTED'}] deny: PATCH policy without owner signature -> HTTP ${patch.status}\n${JSON.stringify(patch.body)}`);
  results.push({ case: 'deny: PATCH policy without owner signature', expect: 'deny', status: patch.status, response: patch.body });

  writeFileSync(RESULTS_PATH, JSON.stringify({ ranAt: new Date().toISOString(), policyId: policy.id, walletId: wallet.id, walletAddress: wallet.address, results }, null, 2) + '\n');
  console.log(`\nwrote ${RESULTS_PATH}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
