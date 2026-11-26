import { useCallback, useMemo, useRef, useState } from "react";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult } from "viem";
import { type Connector, useAccount, useConfig, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { getAccount, reconnect } from "wagmi/actions";
import { appConfig } from "@/config/app.config";
import { contractsConfig } from "@/config/contracts";
import { env } from "@/config/env";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";

export interface TxExecutionResult {
  readonly txHash: `0x${string}`;
  readonly blockNumber: bigint;
}

const SOLIDITY_REVERT_MESSAGES: Readonly<Record<string, string>> = {
  InspectionWindowActive:
    "Inspection window is still active. The seller can open a dispute only after the buyer inspection window expires.",
  FundingDeadlinePassed:
    "Funding deadline has already passed on-chain. Create a new deal with an updated funding schedule.",
  DeliveryDeadlinePassed:
    "Delivery deadline has already passed on-chain. Seller delivery or pre-deadline actions are no longer permitted.",
  DeliveryDeadlineNotReached:
    "Delivery deadline has not been reached yet. Buyer deadline refund unlocks only after the delivery deadline expires.",
  DisputeTimeoutNotReached:
    "14-day dispute timeout has not been reached yet. Use 2-of-3 consensus voting or wait until timeout expires.",
  InvalidState:
    "Invalid deal status for this action on-chain. Click Sync On-Chain to refresh the latest contract state.",
  InvalidStatus:
    "Invalid deal status for this action on-chain. Click Sync On-Chain to refresh the latest contract state.",
  UnauthorizedCaller:
    "Connected wallet is not authorized to perform this escrow action on-chain.",
  Unauthorized:
    "Connected wallet is not authorized to perform this escrow action on-chain.",
  IncorrectPaymentAmount:
    "Exact escrow AVAX deposit amount is required to fund this trade.",
  NothingToWithdraw:
    "No claimable AVAX balance is currently available for your wallet on-chain.",
  AlreadySettled:
    "This escrow trade has already been settled on-chain.",
  TradeAlreadyExists:
    "This trade ID is already registered on-chain. Retry backend binding instead of re-deploying.",
  TradeNotFound:
    "Trade ID does not exist on the configured SafeDealEscrow contract.",
  InvalidSettlementAllocation:
    "Buyer and seller payout split must sum to the exact locked escrow amount.",
  InvalidRoleSeparation:
    "Buyer, seller, and arbiter must be distinct non-zero wallet addresses.",
  InvalidTermsHash:
    "Canonical termsHash cannot be empty or zero.",
  InvalidAmount:
    "Escrow amount must be strictly greater than 0 wei.",
  InvalidDeadline:
    "Funding and delivery deadlines must be in the future and ordered chronologically.",
  ZeroAddress:
    "Required escrow participant address cannot be the zero address.",
  DirectTransfersNotAllowed:
    "Direct AVAX transfers to the contract are blocked; use fundTrade(tradeId).",
  WithdrawalTransferFailed:
    "On-chain AVAX pull-withdrawal transfer failed in recipient account.",
  ReentrancyGuardReentrantCall:
    "Concurrent reentrant contract call blocked by ReentrancyGuard.",
};

function extractHexErrorData(error: unknown): `0x${string}` | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as {
    data?: unknown;
    cause?: { data?: unknown; cause?: { data?: unknown } };
  };
  for (const raw of [candidate.data, candidate.cause?.data, candidate.cause?.cause?.data]) {
    if (typeof raw === "string" && /^0x[0-9a-fA-F]{8,}$/.test(raw)) {
      return raw as `0x${string}`;
    }
    if (
      typeof raw === "object" &&
      raw !== null &&
      "data" in raw &&
      typeof (raw as { data?: unknown }).data === "string" &&
      /^0x[0-9a-fA-F]{8,}$/.test((raw as { data: string }).data)
    ) {
      return (raw as { data: `0x${string}` }).data;
    }
  }
  return null;
}

export function decodeEscrowRevertError(error: unknown): string | null {
  if (error instanceof BaseError) {
    const revertError = error.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError && revertError.data?.errorName) {
      const mapped = SOLIDITY_REVERT_MESSAGES[revertError.data.errorName];
      if (mapped) return mapped;
    }
  }

  const rawData = extractHexErrorData(error);
  if (rawData) {
    try {
      const decoded = decodeErrorResult({
        abi: contractsConfig.escrowAbi,
        data: rawData,
      });
      const mapped = SOLIDITY_REVERT_MESSAGES[decoded.errorName];
      if (mapped) return mapped;
    } catch {
      // Fall through to name pattern matching
    }
  }

  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (text) {
    for (const [errorName, friendly] of Object.entries(SOLIDITY_REVERT_MESSAGES)) {
      if (new RegExp(`\\b${errorName}\\b`).test(text)) {
        return friendly;
      }
    }
  }
  return null;
}

function hasLiveConnector(connector: unknown): connector is Connector {
  return (
    typeof connector === "object" &&
    connector !== null &&
    "getChainId" in connector &&
    typeof (connector as { getChainId?: unknown }).getChainId === "function"
  );
}

export function classifyWalletError(error: unknown): string {
  if (!(error instanceof Error)) return "Transaction failed.";
  const msg = error.message;
  if (msg.includes("User rejected") || msg.includes("User denied")) {
    return "Transaction rejected in wallet.";
  }
  if (msg.includes("getChainId is not a function")) {
    return "Wallet connection is stale or still reconnecting. Open Wallet & Session, disconnect, and reconnect your wallet.";
  }
  if (/timed out|timeout/i.test(msg) && !msg.includes("DisputeTimeoutNotReached")) {
    return "Transaction confirmation timed out. Check explorer or refresh to sync state.";
  }
  const decodedRevert = decodeEscrowRevertError(error);
  if (decodedRevert) {
    return decodedRevert;
  }
  return msg;
}

export function useClaimableBalance(accountAddress: `0x${string}` | undefined) {
  return useReadContract({
    address: contractsConfig.escrowAddress,
    abi: contractsConfig.escrowAbi,
    functionName: "claimableBalances",
    args: accountAddress ? [accountAddress] : undefined,
    query: {
      enabled: Boolean(contractsConfig.escrowAddress && accountAddress),
      refetchInterval: 10_000,
    },
  });
}

export function useOnChainTrade(tradeId: `0x${string}` | undefined) {
  const isValidBytes32 = Boolean(tradeId && /^0x[0-9a-fA-F]{64}$/.test(tradeId));
  return useReadContract({
    address: contractsConfig.escrowAddress,
    abi: contractsConfig.escrowAbi,
    functionName: "getTrade",
    args: isValidBytes32 && tradeId ? [tradeId] : undefined,
    query: {
      enabled: Boolean(contractsConfig.escrowAddress && isValidBytes32),
      refetchInterval: 10_000,
    },
  });
}

export function useOnChainDisputeVotes(tradeId: `0x${string}` | undefined) {
  const isValidBytes32 = Boolean(tradeId && /^0x[0-9a-fA-F]{64}$/.test(tradeId));
  return useReadContract({
    address: contractsConfig.escrowAddress,
    abi: contractsConfig.escrowAbi,
    functionName: "getDisputeVotes",
    args: isValidBytes32 && tradeId ? [tradeId] : undefined,
    query: {
      enabled: Boolean(contractsConfig.escrowAddress && isValidBytes32),
      refetchInterval: 10_000,
    },
  });
}

export function useEscrowContractExecutor() {
  const { isConnected, isWrongNetwork } = useAuthSession();
  const { connector: activeConnector } = useAccount();
  const config = useConfig();
  const publicClient = usePublicClient({ chainId: env.chainId });
  const { writeContractAsync } = useWriteContract();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const activeActionRef = useRef<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const ensureReady = useCallback(() => {
    if (!contractsConfig.escrowAddress) {
      throw new Error("Escrow contract address is not configured.");
    }
    if (!isConnected) {
      throw new Error("Connect your wallet before submitting an on-chain transaction.");
    }
    if (isWrongNetwork) {
      throw new Error(`Switch your wallet network to ${env.chainName} (Chain ID ${env.chainId}).`);
    }
    if (!publicClient) {
      throw new Error("Blockchain RPC client is not ready.");
    }
    return {
      contractAddress: contractsConfig.escrowAddress,
      client: publicClient,
    };
  }, [isConnected, isWrongNetwork, publicClient]);

  const resolveLiveConnector = useCallback(async (): Promise<Connector> => {
    if (hasLiveConnector(activeConnector)) {
      return activeConnector;
    }

    const fromStore = getAccount(config).connector;
    if (hasLiveConnector(fromStore)) {
      return fromStore;
    }

    await reconnect(config).catch(() => []);
    const afterReconnect = getAccount(config).connector;
    if (hasLiveConnector(afterReconnect)) {
      return afterReconnect;
    }

    const currentMeta = activeConnector as { uid?: string; id?: string } | undefined;
    const candidate =
      config.connectors.find(
        (c) =>
          hasLiveConnector(c) &&
          ((currentMeta?.uid && c.uid === currentMeta.uid) || (currentMeta?.id && c.id === currentMeta.id))
      ) ?? config.connectors.find(hasLiveConnector);

    if (candidate) {
      const accounts = await candidate.getAccounts().catch(() => []);
      if (accounts.length > 0) {
        return candidate;
      }
    }

    throw new Error(
      "Wallet connection is stale or still reconnecting. Open Wallet & Session, disconnect, and reconnect your wallet."
    );
  }, [activeConnector, config]);

  const waitForHash = useCallback(
    async (txHash: `0x${string}`): Promise<TxExecutionResult> => {
      const { client } = ensureReady();
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        pollingInterval: appConfig.transactions.pollIntervalMs,
        timeout: 120_000,
      });
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted on-chain (${txHash}).`);
      }
      return {
        txHash,
        blockNumber: receipt.blockNumber,
      };
    },
    [ensureReady]
  );

  const runContractCall = useCallback(
    async (
      actionName: string,
      submit: (contractAddress: `0x${string}`, connector: Connector) => Promise<`0x${string}`>,
      onHashSubmitted?: (txHash: `0x${string}`) => void
    ): Promise<TxExecutionResult> => {
      const currentActive = activeActionRef.current ?? activeAction;
      if (currentActive) {
        throw new Error(`Another transaction (${currentActive}) is already in progress.`);
      }
      activeActionRef.current = actionName;
      setTxError(null);
      setActiveAction(actionName);
      try {
        const { contractAddress, client } = ensureReady();
        if (typeof client.getBytecode === "function") {
          const bytecode = await client.getBytecode({ address: contractAddress });
          if (!bytecode || bytecode === "0x") {
            throw new Error(
              `No SafeDealEscrow contract bytecode found at ${contractAddress} on ${env.chainName} (Chain ID ${env.chainId}). Verify network and contract configuration before sending funds.`
            );
          }
        }
        const liveConnector = await resolveLiveConnector();
        const txHash = await submit(contractAddress, liveConnector);
        onHashSubmitted?.(txHash);
        return await waitForHash(txHash);
      } catch (err) {
        const readable = classifyWalletError(err);
        setTxError(readable);
        throw new Error(readable);
      } finally {
        activeActionRef.current = null;
        setActiveAction(null);
      }
    },
    [activeAction, ensureReady, resolveLiveConnector, waitForHash]
  );

  const createTrade = useCallback(
    (
      params: {
        tradeId: `0x${string}`;
        preassignedBuyer: `0x${string}`;
        arbiter: `0x${string}`;
        amountWei: bigint;
        termsHash: `0x${string}`;
        fundingDeadline: bigint;
        deliveryDeadline: bigint;
        inspectionWindow: bigint;
      },
      onHashSubmitted?: (txHash: `0x${string}`) => void
    ) =>
      runContractCall(
        "createTrade",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "createTrade",
            connector,
            chainId: env.chainId,
            args: [
              params.tradeId,
              params.preassignedBuyer,
              params.arbiter,
              params.amountWei,
              params.termsHash,
              params.fundingDeadline,
              params.deliveryDeadline,
              params.inspectionWindow,
            ],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const fundTrade = useCallback(
    (tradeId: `0x${string}`, amountWei: bigint, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "fundTrade",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "fundTrade",
            connector,
            chainId: env.chainId,
            args: [tradeId],
            value: amountWei,
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const markDelivered = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "markDelivered",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "markDelivered",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const releaseFunds = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "releaseFunds",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "releaseFunds",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const refundBySeller = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "refundBySeller",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "refundBySeller",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const refundAfterDeadline = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "refundAfterDeadline",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "refundAfterDeadline",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const cancelUnfundedTrade = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "cancelUnfundedTrade",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "cancelUnfundedTrade",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const openDispute = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "openDispute",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "openDispute",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const submitResolutionVote = useCallback(
    (
      tradeId: `0x${string}`,
      buyerAmountWei: bigint,
      sellerAmountWei: bigint,
      onHashSubmitted?: (txHash: `0x${string}`) => void
    ) =>
      runContractCall(
        "submitResolutionVote",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "submitResolutionVote",
            connector,
            chainId: env.chainId,
            args: [tradeId, buyerAmountWei, sellerAmountWei],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const resolveDisputeByTimeout = useCallback(
    (tradeId: `0x${string}`, onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "resolveDisputeByTimeout",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "resolveDisputeByTimeout",
            connector,
            chainId: env.chainId,
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const withdraw = useCallback(
    (onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "withdraw",
        (address, connector) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "withdraw",
            connector,
            chainId: env.chainId,
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const clearTxError = useCallback(() => setTxError(null), []);

  return useMemo(
    () => ({
      activeAction,
      txError,
      clearTxError,
      waitForHash,
      createTrade,
      fundTrade,
      markDelivered,
      releaseFunds,
      refundBySeller,
      refundAfterDeadline,
      cancelUnfundedTrade,
      openDispute,
      submitResolutionVote,
      resolveDisputeByTimeout,
      withdraw,
    }),
    [
      activeAction,
      txError,
      clearTxError,
      waitForHash,
      createTrade,
      fundTrade,
      markDelivered,
      releaseFunds,
      refundBySeller,
      refundAfterDeadline,
      cancelUnfundedTrade,
      openDispute,
      submitResolutionVote,
      resolveDisputeByTimeout,
      withdraw,
    ]
  );
}
