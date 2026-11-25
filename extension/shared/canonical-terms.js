/**
 * SafeDeal Escrow Companion — RFC 8785 Canonical JSON & SHA-256 termsHash
 * Exact ESM port of frontend/src/utils/canonical-terms.ts and
 * backend/crates/domain/src/canonical_terms.rs.
 */

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Normalizes an optional EVM address: trims whitespace, lowercases,
 * and maps empty or zero address to null.
 * @param {string | null | undefined} address
 * @returns {string | null}
 */
export function normalizeOptionalAddress(address) {
  if (!address || !String(address).trim()) return null;
  const lower = String(address).trim().toLowerCase();
  return lower === ZERO_ADDRESS ? null : lower;
}

/**
 * Normalizes a decimal wei string by stripping leading zeros while keeping "0" for zero.
 * @param {string | number | bigint} amountWei
 * @returns {string}
 */
export function normalizeAmountWei(amountWei) {
  const trimmed = String(amountWei ?? "").trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+/, "") || "0";
  }
  return trimmed;
}

/**
 * RFC 8785 deterministic canonical JSON serialization for SafeDeal deal terms.
 * Keys are sorted lexicographically by UTF-16 code unit order; addresses are lowercase;
 * integers and strings follow exact ECMAScript JSON.stringify serialization without whitespace.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalizeJsonValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Canonical JSON does not allow non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJsonValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(record[key])}`
    );
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON type: ${typeof value}`);
}

/**
 * Builds the deterministic RFC 8785 canonical JSON string for SafeDeal deal terms.
 * @param {{
 *   version: number,
 *   chainId: number,
 *   seller: string,
 *   buyer?: string | null,
 *   arbiter: string,
 *   amountWei: string,
 *   fundingDeadline: number,
 *   deliveryDeadline: number,
 *   inspectionWindowSeconds: number,
 *   title: string,
 *   description: string,
 *   terms: string
 * }} input
 * @returns {string}
 */
export function buildCanonicalTermsJson(input) {
  const normalized = {
    amountWei: normalizeAmountWei(input.amountWei),
    arbiter: String(input.arbiter ?? "").trim().toLowerCase(),
    buyer: normalizeOptionalAddress(input.buyer),
    chainId: Number(input.chainId),
    deliveryDeadline: Number(input.deliveryDeadline),
    description: String(input.description ?? "").trim(),
    fundingDeadline: Number(input.fundingDeadline),
    inspectionWindowSeconds: Number(input.inspectionWindowSeconds),
    seller: String(input.seller ?? "").trim().toLowerCase(),
    terms: String(input.terms ?? "").trim(),
    title: String(input.title ?? "").trim(),
    version: Number(input.version),
  };
  return canonicalizeJsonValue(normalized);
}

/**
 * Computes 0x-prefixed lowercase SHA-256 digest of a UTF-8 string using Web Crypto API.
 * @param {string} utf8Text
 * @returns {Promise<string>}
 */
export async function sha256Hex(utf8Text) {
  const bytes = new TextEncoder().encode(utf8Text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/**
 * Computes both the canonical JSON string and the 0x-prefixed SHA-256 termsHash.
 * @param {{
 *   version: number,
 *   chainId: number,
 *   seller: string,
 *   buyer?: string | null,
 *   arbiter: string,
 *   amountWei: string,
 *   fundingDeadline: number,
 *   deliveryDeadline: number,
 *   inspectionWindowSeconds: number,
 *   title: string,
 *   description: string,
 *   terms: string
 * }} input
 * @returns {Promise<{ canonicalJson: string, termsHash: string }>}
 */
export async function computeCanonicalTermsHash(input) {
  const canonicalJson = buildCanonicalTermsJson(input);
  const termsHash = await sha256Hex(canonicalJson);
  return { canonicalJson, termsHash };
}

/**
 * Converts a decimal AVAX string (e.g. "1.5") to an exact integer wei string using BigInt arithmetic.
 * Never uses floating-point math.
 * @param {string} avaxString
 * @returns {string}
 */
export function parseAvaxToWei(avaxString) {
  const cleaned = String(avaxString ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(cleaned)) {
    throw new Error(`Invalid AVAX amount: "${avaxString}"`);
  }
  const [wholePart, fracPart = ""] = cleaned.split(".");
  const paddedFrac = fracPart.padEnd(18, "0").slice(0, 18);
  const wei = BigInt(wholePart) * 1000000000000000000n + BigInt(paddedFrac || "0");
  return wei.toString(10);
}

/**
 * Formats a wei value (BigInt or decimal string) into a human-readable AVAX string without float drift.
 * @param {bigint | string} weiValue
 * @param {number} [maxFractionDigits=4]
 * @returns {string}
 */
export function formatWeiToAvax(weiValue, maxFractionDigits = 4) {
  const wei = typeof weiValue === "bigint" ? weiValue : BigInt(String(weiValue || "0"));
  const base = 1000000000000000000n;
  const whole = wei / base;
  const remainder = wei % base;
  if (remainder === 0n) {
    return whole.toString(10);
  }
  const fullFrac = remainder.toString(10).padStart(18, "0");
  const clipped = fullFrac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return clipped ? `${whole.toString(10)}.${clipped}` : whole.toString(10);
}
