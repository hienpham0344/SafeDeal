const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_204221_5339e40b-e73d-4ab0-9c65-79c18c66fd50.mp4";

export interface FrontendEnv {
  readonly appName: string;
  readonly appEnv: string;
  readonly apiBaseUrl: string;
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly explorerBaseUrl: string | undefined;
  readonly escrowContractAddress: `0x${string}` | undefined;
  readonly defaultArbiterAddress: `0x${string}` | undefined;
  readonly defaultInspectionWindowSeconds: number;
  readonly maxEvidenceBytes: number;
  readonly txPollIntervalMs: number;
  readonly heroVideoUrl: string;
  readonly configErrors: readonly string[];
}

function parseOptionalAddress(raw: string | undefined, field: string, errors: string[]): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (!ADDRESS_REGEX.test(trimmed)) {
    errors.push(`Invalid Ethereum address format for ${field}`);
    return undefined;
  }
  if (trimmed.toLowerCase() === ZERO_ADDRESS) {
    errors.push(`${field} cannot be the zero address`);
    return undefined;
  }
  return trimmed as `0x${string}`;
}

function parseOptionalUrl(raw: string | undefined, field: string, errors: string[]): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push(`${field} must use http or https protocol`);
      return undefined;
    }
    return trimmed.replace(/\/$/, "");
  } catch {
    errors.push(`Invalid URL for ${field}`);
    return undefined;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number, field: string, errors: string[]): number {
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`${field} must be a positive integer`);
    return fallback;
  }
  return n;
}

export function loadFrontendEnv(source: Record<string, string | undefined> = import.meta.env): FrontendEnv {
  const errors: string[] = [];

  const appName = source.VITE_APP_NAME?.trim() || "SafeDeal";
  const appEnv = source.VITE_APP_ENV?.trim() || "local";
  const apiBaseUrl =
    parseOptionalUrl(source.VITE_API_BASE_URL, "VITE_API_BASE_URL", errors) ?? "http://localhost:8080";
  const chainId = parsePositiveInt(source.VITE_CHAIN_ID, 31337, "VITE_CHAIN_ID", errors);
  const chainName =
    source.VITE_CHAIN_NAME?.trim() ||
    (chainId === 43113 ? "Avalanche Fuji C-Chain" : chainId === 31337 ? "Anvil Local" : `EVM Chain ${chainId}`);
  const rpcUrl =
    parseOptionalUrl(source.VITE_RPC_URL, "VITE_RPC_URL", errors) ?? "http://127.0.0.1:8545";
  const explorerBaseUrl = parseOptionalUrl(source.VITE_EXPLORER_BASE_URL, "VITE_EXPLORER_BASE_URL", errors);
  const escrowContractAddress = parseOptionalAddress(
    source.VITE_ESCROW_CONTRACT_ADDRESS,
    "VITE_ESCROW_CONTRACT_ADDRESS",
    errors
  );
  const defaultArbiterAddress = parseOptionalAddress(
    source.VITE_DEFAULT_ARBITER_ADDRESS,
    "VITE_DEFAULT_ARBITER_ADDRESS",
    errors
  );
  const defaultInspectionWindowSeconds = parsePositiveInt(
    source.VITE_DEFAULT_INSPECTION_WINDOW_SECONDS,
    259200,
    "VITE_DEFAULT_INSPECTION_WINDOW_SECONDS",
    errors
  );
  const maxEvidenceBytes = parsePositiveInt(
    source.VITE_MAX_EVIDENCE_BYTES,
    5 * 1024 * 1024,
    "VITE_MAX_EVIDENCE_BYTES",
    errors
  );
  const txPollIntervalMs = parsePositiveInt(
    source.VITE_TX_POLL_INTERVAL_MS,
    2000,
    "VITE_TX_POLL_INTERVAL_MS",
    errors
  );
  const heroVideoUrl =
    parseOptionalUrl(source.VITE_HERO_VIDEO_URL, "VITE_HERO_VIDEO_URL", errors) ?? DEFAULT_HERO_VIDEO_URL;

  return {
    appName,
    appEnv,
    apiBaseUrl,
    chainId,
    chainName,
    rpcUrl,
    explorerBaseUrl,
    escrowContractAddress,
    defaultArbiterAddress,
    defaultInspectionWindowSeconds,
    maxEvidenceBytes,
    txPollIntervalMs,
    heroVideoUrl,
    configErrors: errors,
  };
}

export const env: FrontendEnv = loadFrontendEnv();
