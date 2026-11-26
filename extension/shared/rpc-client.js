/**
 * SafeDeal Escrow Companion — Pure ESM Avalanche C-Chain JSON-RPC Client
 * Queries SafeDealEscrow.sol directly via eth_call without requiring MetaMask or SIWE auth:
 *   - getTrade(bytes32 tradeId)          -> 0xa3b13799
 *   - getDisputeVotes(bytes32 tradeId)   -> 0x48547c8a
 *   - claimableBalances(address account) -> 0x68c8278f (alias claimableBalance: 0x60f3309b)
 * Optionally merges off-chain metadata from SafeDeal API if publicly reachable.
 */

import { computeCanonicalTermsHash, formatWeiToAvax, ZERO_ADDRESS } from "./canonical-terms.js";

export const DEFAULT_FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc";
export const DEFAULT_ESCROW_CONTRACT = "0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29";
export const DEFAULT_API_BASE_URL = "https://safedeal-production.up.railway.app";
export const DEFAULT_WEB_APP_URL = "https://avalanche-9b099.web.app";
export const FUJI_CHAIN_ID = 43113;

export const OFFICIAL_SAFEDEAL_ORIGINS = Object.freeze([
  "https://avalanche-9b099.web.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:14173",
  "http://127.0.0.1:14173",
  "http://localhost:24173",
  "http://127.0.0.1:24173",
]);

/**
 * Validates that a configured endpoint or web app URL uses `https:` or a loopback
 * `http://localhost` / `http://127.0.0.1` origin. Rejects `javascript:`, `data:`,
 * embedded credentials, or non-loopback plaintext `http:`.
 * @param {string} rawUrl
 * @param {string} [label="URL"]
 * @returns {URL}
 */
export function validateSafeEndpointUrl(rawUrl, label = "URL") {
  let parsed;
  try {
    parsed = new URL(String(rawUrl ?? "").trim());
  } catch {
    throw new Error(`Invalid ${label}: malformed URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid ${label}: embedded credentials are not allowed`);
  }
  const isHttps = parsed.protocol === "https:";
  const isLoopbackHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (!isHttps && !isLoopbackHttp) {
    throw new Error(
      `Unsafe ${label} scheme "${parsed.protocol}" for host "${parsed.hostname}": only https: or loopback http://localhost / http://127.0.0.1 are allowed`
    );
  }
  return parsed;
}

/**
 * Validates a 20-byte EVM hex address (`0x` + 40 hex characters).
 * @param {string} address
 * @returns {boolean}
 */
export function isValidEvmAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(address ?? "").trim());
}

export const SELECTORS = {
  getTrade: "0xa3b13799",
  getDisputeVotes: "0x48547c8a",
  claimableBalances: "0x68c8278f",
  claimableBalanceAlias: "0x60f3309b",
  totalLockedEscrow: "0x5d6cff7b",
  totalClaimable: "0x4838ed19",
};

export const TRADE_STATUS_LABELS = [
  "NONE",
  "CREATED",
  "FUNDED",
  "DELIVERED",
  "RELEASED",
  "REFUNDED",
  "DISPUTED",
  "RESOLVED",
  "CANCELLED",
];

/**
 * Extracts a 32-byte hex tradeId (0x + 64 hex chars) from a raw tradeId or SafeDeal URL.
 * Also extracts a deal UUID if a `/deals/<uuid>` URL is provided.
 * @param {string} rawInput
 * @returns {{ tradeId: string | null, dealId: string | null }}
 */
export function parseDealIdentifier(rawInput) {
  const trimmed = String(rawInput ?? "").trim();
  if (!trimmed) {
    return { tradeId: null, dealId: null };
  }

  const hexMatch = trimmed.match(/0x[0-9a-fA-F]{64}/);
  if (hexMatch) {
    return { tradeId: hexMatch[0].toLowerCase(), dealId: null };
  }

  const urlDealMatch = trimmed.match(/\/deals\/([^/?#\s]+)/i);
  const candidate = urlDealMatch ? decodeURIComponent(urlDealMatch[1]) : trimmed;

  if (/^0x[0-9a-fA-F]{64}$/.test(candidate)) {
    return { tradeId: candidate.toLowerCase(), dealId: null };
  }
  if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
    return { tradeId: `0x${candidate.toLowerCase()}`, dealId: null };
  }

  return { tradeId: null, dealId: candidate };
}

/**
 * Validates and left-pads a bytes32 hex value to 64 hex characters (without 0x).
 * @param {string} bytes32Hex
 * @returns {string}
 */
export function encodeBytes32Param(bytes32Hex) {
  const clean = String(bytes32Hex ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,64}$/.test(clean)) {
    throw new Error(`Invalid bytes32 tradeId: "${bytes32Hex}"`);
  }
  return clean.padStart(64, "0");
}

/**
 * Validates and left-pads a 20-byte EVM address to 64 hex characters (without 0x).
 * @param {string} address
 * @returns {string}
 */
export function encodeAddressParam(address) {
  const clean = String(address ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid EVM address: "${address}"`);
  }
  return clean.padStart(64, "0");
}

/**
 * Executes a JSON-RPC eth_call against the configured Avalanche C-Chain RPC endpoint.
 * @param {{
 *   rpcUrl?: string,
 *   contractAddress?: string,
 *   data: string,
 *   fetchImpl?: typeof fetch
 * }} params
 * @returns {Promise<string>}
 */
export async function ethCall({
  rpcUrl = DEFAULT_FUJI_RPC_URL,
  contractAddress = DEFAULT_ESCROW_CONTRACT,
  data,
  fetchImpl = globalThis.fetch,
}) {
  const safeRpcUrl = String(rpcUrl ?? "").trim();
  validateSafeEndpointUrl(safeRpcUrl, "rpcUrl");
  if (!isValidEvmAddress(contractAddress)) {
    throw new Error(`Invalid contractAddress: "${contractAddress}"`);
  }

  const response = await fetchImpl(safeRpcUrl, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          to: contractAddress,
          data,
        },
        "latest",
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Avalanche RPC HTTP error: ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "Avalanche eth_call reverted");
  }
  if (typeof payload.result !== "string" || !payload.result.startsWith("0x")) {
    throw new Error("Invalid eth_call response from RPC");
  }
  return payload.result;
}

/**
 * Splits a 0x-prefixed ABI return payload into 32-byte (64-hex-char) words.
 * @param {string} hexResult
 * @param {number} minWords
 * @returns {string[]}
 */
export function splitAbiWords(hexResult, minWords) {
  const clean = hexResult.replace(/^0x/, "");
  if (clean.length < minWords * 64) {
    throw new Error(
      `Unexpected ABI response length: expected at least ${minWords * 64} hex chars, got ${clean.length}`
    );
  }
  const words = [];
  for (let i = 0; i < clean.length; i += 64) {
    words.push(clean.slice(i, i + 64));
  }
  return words;
}

function wordToAddress(word) {
  return `0x${word.slice(24).toLowerCase()}`;
}

function wordToBytes32(word) {
  return `0x${word.toLowerCase()}`;
}

function wordToUint64Number(word) {
  return Number(BigInt(`0x${word}`));
}

/**
 * Decodes the 15-word static tuple returned by SafeDealEscrow.getTrade(bytes32).
 * Struct layout in ISafeDealEscrow.sol:
 *   0: bytes32 tradeId
 *   1: address seller
 *   2: uint64 createdAt
 *   3: TradeStatus status (uint8)
 *   4: bool settled
 *   5: address buyer
 *   6: uint64 fundedAt
 *   7: address arbiter
 *   8: uint64 fundingDeadline
 *   9: uint256 amount
 *  10: bytes32 termsHash
 *  11: uint64 deliveredAt
 *  12: uint64 deliveryDeadline
 *  13: uint64 inspectionWindow
 *  14: uint64 disputedAt
 * @param {string} hexResult
 */
export function decodeTradeTuple(hexResult) {
  const words = splitAbiWords(hexResult, 15);
  const statusCode = Number(BigInt(`0x${words[3]}`));
  const status = TRADE_STATUS_LABELS[statusCode] ?? "UNKNOWN";
  const amountWeiBigInt = BigInt(`0x${words[9]}`);
  const seller = wordToAddress(words[1]);
  const buyerRaw = wordToAddress(words[5]);
  const arbiter = wordToAddress(words[7]);

  return {
    tradeId: wordToBytes32(words[0]),
    seller,
    createdAt: wordToUint64Number(words[2]),
    statusCode,
    status,
    settled: BigInt(`0x${words[4]}`) !== 0n,
    buyer: buyerRaw === ZERO_ADDRESS ? null : buyerRaw,
    buyerAddressRaw: buyerRaw,
    fundedAt: wordToUint64Number(words[6]),
    arbiter,
    fundingDeadline: wordToUint64Number(words[8]),
    amountWei: amountWeiBigInt.toString(10),
    amountAvax: formatWeiToAvax(amountWeiBigInt, 6),
    termsHash: wordToBytes32(words[10]),
    deliveredAt: wordToUint64Number(words[11]),
    deliveryDeadline: wordToUint64Number(words[12]),
    inspectionWindow: wordToUint64Number(words[13]),
    disputedAt: wordToUint64Number(words[14]),
  };
}

/**
 * Decodes the 5-word static tuple returned by SafeDealEscrow.getDisputeVotes(bytes32).
 * Struct layout in ISafeDealEscrow.sol:
 *   0: bytes32 buyerVoteHash
 *   1: bytes32 sellerVoteHash
 *   2: bytes32 arbiterVoteHash
 *   3: uint64 disputedAt
 *   4: uint64 timeoutAt
 * @param {string} hexResult
 */
export function decodeDisputeVotesTuple(hexResult) {
  const words = splitAbiWords(hexResult, 5);
  const zeroBytes32 = "0x" + "0".repeat(64);
  const buyerVoteHash = wordToBytes32(words[0]);
  const sellerVoteHash = wordToBytes32(words[1]);
  const arbiterVoteHash = wordToBytes32(words[2]);

  const activeVotes = [buyerVoteHash, sellerVoteHash, arbiterVoteHash].filter(
    (h) => h !== zeroBytes32
  );

  return {
    buyerVoteHash,
    sellerVoteHash,
    arbiterVoteHash,
    buyerHasVoted: buyerVoteHash !== zeroBytes32,
    sellerHasVoted: sellerVoteHash !== zeroBytes32,
    arbiterHasVoted: arbiterVoteHash !== zeroBytes32,
    activeVoteCount: activeVotes.length,
    disputedAt: wordToUint64Number(words[3]),
    timeoutAt: wordToUint64Number(words[4]),
  };
}

/**
 * Queries SafeDealEscrow.getTrade(bytes32 tradeId) on Avalanche Fuji (or custom RPC).
 * @param {string} tradeId
 * @param {{ rpcUrl?: string, contractAddress?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function getTrade(tradeId, options = {}) {
  const data = `${SELECTORS.getTrade}${encodeBytes32Param(tradeId)}`;
  const raw = await ethCall({ ...options, data });
  return decodeTradeTuple(raw);
}

/**
 * Queries SafeDealEscrow.getDisputeVotes(bytes32 tradeId) on Avalanche Fuji (or custom RPC).
 * @param {string} tradeId
 * @param {{ rpcUrl?: string, contractAddress?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function getDisputeVotes(tradeId, options = {}) {
  const data = `${SELECTORS.getDisputeVotes}${encodeBytes32Param(tradeId)}`;
  const raw = await ethCall({ ...options, data });
  return decodeDisputeVotesTuple(raw);
}

/**
 * Queries SafeDealEscrow.claimableBalances(address account) on Avalanche Fuji.
 * @param {string} accountAddress
 * @param {{ rpcUrl?: string, contractAddress?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function claimableBalance(accountAddress, options = {}) {
  const encodedAddr = encodeAddressParam(accountAddress);
  let raw;
  try {
    raw = await ethCall({
      ...options,
      data: `${SELECTORS.claimableBalances}${encodedAddr}`,
    });
  } catch {
    raw = await ethCall({
      ...options,
      data: `${SELECTORS.claimableBalanceAlias}${encodedAddr}`,
    });
  }
  const words = splitAbiWords(raw, 1);
  const amountWeiBigInt = BigInt(`0x${words[0]}`);
  return {
    address: accountAddress.trim().toLowerCase(),
    claimableWei: amountWeiBigInt.toString(10),
    claimableAvax: formatWeiToAvax(amountWeiBigInt, 6),
    hasClaimable: amountWeiBigInt > 0n,
  };
}

export const claimableBalances = claimableBalance;
export const fetchClaimableBalance = claimableBalance;

/**
 * Attempts to fetch optional off-chain metadata from SafeDeal API `/api/v1/deals/<id>`.
 * Gracefully returns null if the endpoint requires authentication (401/403) or is offline.
 * @param {string} dealOrTradeId
 * @param {{ apiBaseUrl?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function fetchOptionalBackendDeal(dealOrTradeId, options = {}) {
  const apiBaseUrl = String(options.apiBaseUrl || DEFAULT_API_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  validateSafeEndpointUrl(apiBaseUrl, "apiBaseUrl");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const response = await fetchImpl(
      `${apiBaseUrl}/api/v1/deals/${encodeURIComponent(dealOrTradeId)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
      }
    );
    if (!response.ok) return null;
    const body = await response.json();
    return body?.data ?? body ?? null;
  } catch {
    return null;
  }
}

/**
 * Performs complete on-chain deal verification (`getTrade` + `getDisputeVotes`)
 * and optionally merges off-chain metadata and RFC 8785 termsHash verification if available.
 * Works 100% without MetaMask or SIWE login when given a 0x... tradeId!
 * @param {string} rawInput
 * @param {{
 *   rpcUrl?: string,
 *   contractAddress?: string,
 *   apiBaseUrl?: string,
 *   fetchImpl?: typeof fetch
 * }} [options]
 */
export async function fetchDealVerification(rawInput, options = {}) {
  const parsed = parseDealIdentifier(rawInput);
  let resolvedTradeId = parsed.tradeId;
  let backendMetadata = null;

  if (!resolvedTradeId && parsed.dealId) {
    backendMetadata = await fetchOptionalBackendDeal(parsed.dealId, options);
    if (backendMetadata?.tradeId && /^0x[0-9a-fA-F]{64}$/.test(backendMetadata.tradeId)) {
      resolvedTradeId = backendMetadata.tradeId.toLowerCase();
    } else {
      throw new Error(
        "Paste a 32-byte on-chain tradeId (0x...) or sign in to the SafeDeal web app to resolve private deal UUIDs."
      );
    }
  }

  if (!resolvedTradeId) {
    throw new Error("Please enter a valid 32-byte tradeId (0x...) or SafeDeal deal link.");
  }

  const [onChainTrade, disputeVotes, optionalApiDeal] = await Promise.all([
    getTrade(resolvedTradeId, options),
    getDisputeVotes(resolvedTradeId, options),
    backendMetadata
      ? Promise.resolve(backendMetadata)
      : fetchOptionalBackendDeal(resolvedTradeId, options),
  ]);

  let termsVerified = null;
  let computedTermsHash = null;

  if (
    optionalApiDeal &&
    optionalApiDeal.title &&
    optionalApiDeal.description !== undefined &&
    optionalApiDeal.terms !== undefined
  ) {
    try {
      const baseInput = {
        version: Number(optionalApiDeal.termsVersion ?? 1),
        chainId: Number(optionalApiDeal.chainId ?? FUJI_CHAIN_ID),
        seller: optionalApiDeal.sellerAddress ?? onChainTrade.seller,
        buyer:
          optionalApiDeal.buyerAddress !== undefined
            ? optionalApiDeal.buyerAddress
            : onChainTrade.buyer,
        arbiter: optionalApiDeal.arbiterAddress ?? onChainTrade.arbiter,
        amountWei: String(optionalApiDeal.amountWei ?? onChainTrade.amountWei),
        fundingDeadline: Number(
          optionalApiDeal.fundingDeadlineEpoch ?? onChainTrade.fundingDeadline
        ),
        deliveryDeadline: Number(
          optionalApiDeal.deliveryDeadlineEpoch ?? onChainTrade.deliveryDeadline
        ),
        inspectionWindowSeconds: Number(
          optionalApiDeal.inspectionWindowSeconds ?? onChainTrade.inspectionWindow
        ),
        title: optionalApiDeal.title,
        description: optionalApiDeal.description,
        terms: optionalApiDeal.terms,
      };
      let computed = await computeCanonicalTermsHash(baseInput);
      if (
        computed.termsHash.toLowerCase() !== onChainTrade.termsHash.toLowerCase() &&
        baseInput.buyer !== null
      ) {
        // Open-buyer deals are anchored with buyer=null at createTrade before fundTrade binds trade.buyer
        const openBuyerComputed = await computeCanonicalTermsHash({
          ...baseInput,
          buyer: null,
        });
        if (openBuyerComputed.termsHash.toLowerCase() === onChainTrade.termsHash.toLowerCase()) {
          computed = openBuyerComputed;
        }
      }
      computedTermsHash = computed.termsHash;
      termsVerified =
        computed.termsHash.toLowerCase() === onChainTrade.termsHash.toLowerCase();
    } catch {
      termsVerified = null;
    }
  }

  return {
    queriedTradeId: resolvedTradeId,
    existsOnChain: onChainTrade.statusCode !== 0,
    ...onChainTrade,
    disputeVotes,
    metadata: optionalApiDeal,
    computedTermsHash,
    termsVerified,
    chainId: Number(optionalApiDeal?.chainId ?? FUJI_CHAIN_ID),
    contractAddress: options.contractAddress || DEFAULT_ESCROW_CONTRACT,
    rpcUrl: options.rpcUrl || DEFAULT_FUJI_RPC_URL,
    verifiedAt: Date.now(),
  };
}
