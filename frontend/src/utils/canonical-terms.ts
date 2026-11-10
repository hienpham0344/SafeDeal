export interface CanonicalTermsInput {
  readonly version: number;
  readonly chainId: number;
  readonly seller: string;
  readonly buyer: string | null;
  readonly arbiter: string;
  readonly amountWei: string;
  readonly fundingDeadline: number;
  readonly deliveryDeadline: number;
  readonly inspectionWindowSeconds: number;
  readonly title: string;
  readonly description: string;
  readonly terms: string;
}

function normalizeOptionalAddress(address: string | null | undefined): string | null {
  if (!address || !address.trim()) return null;
  return address.trim().toLowerCase();
}

/**
 * RFC 8785 deterministic canonical JSON serialization for SafeDeal deal terms.
 * Keys are sorted lexicographically by UTF-16 code unit order; addresses are lowercase;
 * integers and strings follow exact JSON serialization without extraneous whitespace.
 */
export function canonicalizeJsonValue(value: unknown): string {
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
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON type: ${typeof value}`);
}

export function buildCanonicalTermsJson(input: CanonicalTermsInput): string {
  const normalized: CanonicalTermsInput = {
    amountWei: input.amountWei.trim(),
    arbiter: input.arbiter.trim().toLowerCase(),
    buyer: normalizeOptionalAddress(input.buyer),
    chainId: input.chainId,
    deliveryDeadline: input.deliveryDeadline,
    description: input.description.trim(),
    fundingDeadline: input.fundingDeadline,
    inspectionWindowSeconds: input.inspectionWindowSeconds,
    seller: input.seller.trim().toLowerCase(),
    terms: input.terms.trim(),
    title: input.title.trim(),
    version: input.version,
  };
  return canonicalizeJsonValue(normalized);
}

export async function sha256Hex(utf8Text: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(utf8Text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

export async function computeCanonicalTermsHash(input: CanonicalTermsInput): Promise<{
  canonicalJson: string;
  termsHash: `0x${string}`;
}> {
  const canonicalJson = buildCanonicalTermsJson(input);
  const termsHash = await sha256Hex(canonicalJson);
  return { canonicalJson, termsHash };
}
