import { formatEther, parseEther } from "viem";
import { appConfig } from "@/config/app.config";

export function shortenAddress(address: string | null | undefined, chars = 4): string {
  if (!address) return "Open (any eligible buyer)";
  if (address.length <= chars * 2 + 4) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatAvax(weiString: string | bigint): string {
  try {
    const value = typeof weiString === "bigint" ? weiString : BigInt(weiString);
    return `${formatEther(value)} ${appConfig.escrow.nativeSymbol}`;
  } catch {
    return `0 ${appConfig.escrow.nativeSymbol}`;
  }
}

export function parseAvaxToWei(amountText: string): bigint | null {
  const trimmed = amountText.trim();
  if (!trimmed || !/^\d+(\.\d{1,18})?$/.test(trimmed)) return null;
  try {
    const wei = parseEther(trimmed);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

export function formatTimestamp(isoOrEpoch: string | number | null | undefined): string {
  if (isoOrEpoch === null || isoOrEpoch === undefined || isoOrEpoch === "") return "—";
  const date = typeof isoOrEpoch === "number" ? new Date(isoOrEpoch * 1000) : new Date(isoOrEpoch);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds < 3600) {
    const mins = Math.max(1, Math.round(seconds / 60));
    return `${mins} min`;
  }
  if (seconds < 86400) {
    const hours = Math.round((seconds / 3600) * 10) / 10;
    return `${hours} hr`;
  }
  const days = Math.round((seconds / 86400) * 10) / 10;
  return `${days} day${days === 1 ? "" : "s"}`;
}

const WEI_PER_AVAX = 10n ** 18n;
const REFERENCE_AVAX_USD_CENTS = 2_500n; // $25.00 USD / AVAX reference benchmark
const REFERENCE_AVAX_VND = 635_000n; // 635,000 VND / AVAX reference benchmark
const ETH_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

export function formatApproximateFiatFromWei(wei: bigint): {
  readonly usd: string;
  readonly vnd: string;
} {
  if (wei <= 0n) {
    return { usd: "$0.00 USD", vnd: "0 VNĐ" };
  }
  const usdCents = (wei * REFERENCE_AVAX_USD_CENTS + WEI_PER_AVAX / 2n) / WEI_PER_AVAX;
  const vndTotal = (wei * REFERENCE_AVAX_VND + WEI_PER_AVAX / 2n) / WEI_PER_AVAX;

  const usd =
    usdCents === 0n
      ? "< $0.01 USD"
      : `$${(usdCents / 100n).toLocaleString("en-US")}.${(usdCents % 100n).toString().padStart(2, "0")} USD`;
  const vnd = vndTotal === 0n ? "< 1 VNĐ" : `${vndTotal.toLocaleString("en-US")} VNĐ`;

  return { usd, vnd };
}

export function detectAddressPoisoningLookalike(
  participants: ReadonlyArray<{ readonly role: string; readonly address: string | null | undefined }>
): string | null {
  const valid = participants
    .map((p) => ({ role: p.role, address: p.address?.trim() ?? "" }))
    .filter((p) => ETH_ADDRESS_PATTERN.test(p.address) && p.address.toLowerCase() !== ZERO_ETH_ADDRESS);

  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const a = valid[i]!;
      const b = valid[j]!;
      const lowerA = a.address.toLowerCase();
      const lowerB = b.address.toLowerCase();
      if (lowerA === lowerB) continue;

      const samePrefix = lowerA.slice(2, 6) === lowerB.slice(2, 6);
      const sameSuffix = lowerA.slice(-4) === lowerB.slice(-4);
      if (samePrefix && sameSuffix) {
        return `${a.role} and ${b.role} share identical 4-character prefix (0x${a.address.slice(2, 6)}) and suffix (...${a.address.slice(-4)}) on different wallets. Verify all 42 characters carefully to guard against vanity address poisoning.`;
      }
    }
  }
  return null;
}

export function evaluateArbiterTrust(
  arbiterAddress: string | null | undefined,
  defaultArbiterAddress: string | undefined
): "verified" | "custom" | "none" {
  const trimmed = arbiterAddress?.trim() ?? "";
  if (!ETH_ADDRESS_PATTERN.test(trimmed) || trimmed.toLowerCase() === ZERO_ETH_ADDRESS) {
    return "none";
  }
  if (defaultArbiterAddress && trimmed.toLowerCase() === defaultArbiterAddress.toLowerCase()) {
    return "verified";
  }
  return "custom";
}
