// Privy authorization signatures: the WebCrypto port must produce what the spike's node:crypto code
// did (docs/reference/privy.md): RFC 8785 JSON of {version, method, url, body, headers}, ECDSA P-256
// over SHA-256, base64 DER. The canonical strings below were produced by running the spike's own
// canonicalize() (spikes/privy/spike.mjs) on the same inputs. The key is a throwaway made here.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { test } from "node:test";
import { authorizationSignature, canonicalize, importAuthKey, p1363ToDer } from "../src/privy.ts";

const url = "https://api.privy.io/v1/wallets/wallet123/rpc";
const body = {
  method: "eth_signTransaction",
  params: {
    transaction: {
      type: 2,
      chain_id: 10143,
      to: "0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53",
      value: "0x0",
      data: "0x1cff79cd",
      nonce: 7,
      gas_limit: 412345,
      max_fee_per_gas: "0x2e90edd000",
      max_priority_fee_per_gas: "0x3b9aca00",
    },
  },
};
const headers = { "privy-request-expiry": "1790900000000", "privy-app-id": "test-app" };

const SPIKE_VECTOR =
  '{"body":{"method":"eth_signTransaction","params":{"transaction":{"chain_id":10143,"data":"0x1cff79cd","gas_limit":412345,"max_fee_per_gas":"0x2e90edd000","max_priority_fee_per_gas":"0x3b9aca00","nonce":7,"to":"0x98e2af31848B95d751e3BFD5bAB9E5EAB9122B53","type":2,"value":"0x0"}}},"headers":{"privy-app-id":"test-app","privy-request-expiry":"1790900000000"},"method":"POST","url":"https://api.privy.io/v1/wallets/wallet123/rpc","version":1}';

test("canonical payload matches the spike's vector", () => {
  assert.equal(canonicalize({ version: 1, method: "POST", url, body, headers }), SPIKE_VECTOR);
});

test("canonicalization edge cases match the spike", () => {
  const odd = { b: [3, { z: null, a: true }], A: 'é "q"', skip: undefined, n: -0.5, e: 1e21 };
  assert.equal(canonicalize(odd), '{"A":"é \\"q\\"","b":[3,{"a":true,"z":null}],"e":1e+21,"n":-0.5}');
});

function throwawayKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const raw = `wallet-auth:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`;
  return { raw, privateKey, publicKey };
}

test("WebCrypto signature is base64 DER that node:crypto verifies over the canonical payload", async () => {
  const k = throwawayKey();
  const key = await importAuthKey(k.raw);
  for (let i = 0; i < 25; i++) {
    // 25 signatures: about half have r or s with the high bit set, which DER pads with a 0x00.
    const sig = await authorizationSignature(key, "POST", url, body, headers);
    const der = Buffer.from(sig, "base64");
    assert.equal(der[0], 0x30);
    assert.equal(verify("sha256", Buffer.from(SPIKE_VECTOR), k.publicKey, der), true);
  }
  // A signature over a different body must not verify.
  const other = await authorizationSignature(key, "POST", url, { ...body, method: "personal_sign" }, headers);
  assert.equal(verify("sha256", Buffer.from(SPIKE_VECTOR), k.publicKey, Buffer.from(other, "base64")), false);
});

test("the spike's own node:crypto signature has the same DER shape", async () => {
  const k = throwawayKey();
  const spikeSig = sign("sha256", Buffer.from(SPIKE_VECTOR), k.privateKey); // what spike.mjs sent
  const ours = Buffer.from(await authorizationSignature(await importAuthKey(k.raw), "POST", url, body, headers), "base64");
  for (const der of [spikeSig, ours]) {
    assert.equal(der[0], 0x30);
    assert.equal(der[1], der.length - 2);
    assert.equal(der[2], 0x02);
  }
});

test("p1363ToDer pads high-bit integers and strips leading zeros", () => {
  const r = new Uint8Array(32).fill(0);
  r[31] = 0x01; // r = 1: 31 leading zeros stripped
  const s = new Uint8Array(32).fill(0xff); // s high bit set: needs a 0x00 pad
  const der = p1363ToDer(new Uint8Array([...r, ...s]));
  assert.deepEqual([...der.slice(0, 5)], [0x30, 3 + 35, 0x02, 0x01, 0x01]);
  assert.deepEqual([...der.slice(5, 8)], [0x02, 33, 0x00]);
  assert.equal(der.length, 2 + 3 + 35);
  assert.throws(() => p1363ToDer(new Uint8Array(63)));
});
