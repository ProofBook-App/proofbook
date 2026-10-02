// Privy server-wallet signing for house-agent session keys (docs/reference/privy.md).
// A port of spikes/privy/spike.mjs from node:crypto to WebCrypto, so it runs in a Worker with no
// nodejs_compat and no SDK. Each house agent's session key is a Privy wallet whose policy allows
// only AgentVault.execute(adapter, …) on its own vault, chain 10143, value 0. Privy checks that
// policy before it signs; we broadcast through our own RPC with our own tight gas limit.

export const PRIVY_API = "https://api.privy.io";

export type PrivySecrets = { appId: string; appSecret: string; authKey: string };

/** The transaction shape Privy's eth_signTransaction takes (the one the spike proved). */
export type PrivyTx = {
  type: 2;
  chain_id: number;
  to: string;
  value: "0x0";
  data: string;
  nonce: number;
  gas_limit: number;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
};

/** RFC 8785 canonical JSON, as in the spike: sorted keys, undefined members dropped, ES number/string forms. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
    .join(",")}}`;
}

/** The authorization key: "wallet-auth:" + base64 PKCS#8 of a P-256 private key. */
export async function importAuthKey(raw: string): Promise<CryptoKey> {
  const der = base64ToBytes(raw.trim().replace(/^wallet-auth:/, ""));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/**
 * privy-authorization-signature: ECDSA P-256 / SHA-256 over the canonical
 * {version: 1, method, url, body, headers: {privy-app-id, privy-request-expiry}}, base64 DER.
 * WebCrypto returns r‖s (IEEE P1363), so it is re-encoded as DER, which is what node:crypto sent.
 */
export async function authorizationSignature(
  key: CryptoKey,
  method: string,
  url: string,
  body: unknown,
  privyHeaders: Record<string, string>,
): Promise<string> {
  const payload = canonicalize({ version: 1, method, url, body, headers: privyHeaders });
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload)),
  );
  return bytesToBase64(p1363ToDer(sig));
}

/** r‖s (32 + 32 bytes) → DER SEQUENCE { INTEGER r, INTEGER s }. */
export function p1363ToDer(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) throw new Error(`expected a 64-byte P-256 signature, got ${sig.length}`);
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.slice(i);
    const pad = v[0]! & 0x80 ? 1 : 0;
    const out = new Uint8Array(2 + pad + v.length);
    out[0] = 0x02;
    out[1] = pad + v.length;
    out.set(v, 2 + pad);
    return out;
  };
  const r = int(sig.slice(0, 32));
  const s = int(sig.slice(32));
  const out = new Uint8Array(2 + r.length + s.length);
  out[0] = 0x30;
  out[1] = r.length + s.length;
  out.set(r, 2);
  out.set(s, 2 + r.length);
  return out;
}

/** Signs one transaction with a Privy server wallet. Privy's policy runs first; a denial throws. */
export async function privySignTransaction(secrets: PrivySecrets, walletId: string, tx: PrivyTx): Promise<`0x${string}`> {
  const url = `${PRIVY_API}/v1/wallets/${walletId}/rpc`;
  const body = { method: "eth_signTransaction", params: { transaction: tx } };
  const privyHeaders = { "privy-app-id": secrets.appId, "privy-request-expiry": String(Date.now() + 60_000) };
  const key = await importAuthKey(secrets.authKey);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${secrets.appId}:${secrets.appSecret}`)}`,
      "Content-Type": "application/json",
      ...privyHeaders,
      "privy-authorization-signature": await authorizationSignature(key, "POST", url, body, privyHeaders),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: { data?: { signed_transaction?: string }; error?: string; code?: string } | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // fall through: report the status and a short slice of the body
  }
  const signed = json?.data?.signed_transaction;
  if (!res.ok || !signed) {
    throw new Error(`Privy eth_signTransaction ${res.status}: ${json?.code ?? ""} ${json?.error ?? text.slice(0, 200)}`.trim());
  }
  return signed as `0x${string}`;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
