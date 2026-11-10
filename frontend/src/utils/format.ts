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
