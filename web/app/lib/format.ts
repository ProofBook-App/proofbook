// Display formatting for indexer amounts, which arrive as decimal strings of base units.
// AUSD and USDC have 6 decimals (never assume 18).

const MINUS = "−";

function group(int: bigint) {
  return int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// formatUnits("399909625") -> "399.91". Rounds half away from zero to `dp` places.
export function formatUnits(value: string | bigint, decimals = 6, dp = 2) {
  const n = BigInt(value);
  const abs = n < 0n ? -n : n;
  const cut = 10n ** BigInt(Math.max(0, decimals - dp));
  const rounded = decimals > dp ? (abs + cut / 2n) / cut : abs * 10n ** BigInt(dp - decimals);
  const unit = 10n ** BigInt(dp);
  const text = dp > 0 ? `${group(rounded / unit)}.${(rounded % unit).toString().padStart(dp, "0")}` : group(rounded);
  return n < 0n && rounded !== 0n ? `${MINUS}${text}` : text;
}

// With an explicit sign: "+1.08", "−0.09", "0.00".
export function formatSigned(value: string | bigint, decimals = 6, dp = 2) {
  const text = formatUnits(value, decimals, dp);
  return BigInt(value) > 0n && /[1-9]/.test(text) ? `+${text}` : text;
}

// Basis points as a percentage: -2 -> "−0.02%". `signed` adds "+" to gains.
export function formatBps(bps: number, signed = false) {
  const text = (Math.abs(bps) / 100).toFixed(2);
  if (bps < 0) return `${MINUS}${text}%`;
  return `${signed && bps > 0 ? "+" : ""}${text}%`;
}

export function tone(value: string | bigint | number) {
  const n = typeof value === "number" ? value : Number(BigInt(value));
  return n > 0 ? "text-gain" : n < 0 ? "text-limit" : "text-ink";
}

// Unix seconds as "Sep 30, 14:07 UTC". UTC so the server and client render the same text.
export function formatTime(unix: number) {
  const d = new Date(unix * 1000);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}, ${d.toISOString().slice(11, 16)} UTC`;
}

export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
