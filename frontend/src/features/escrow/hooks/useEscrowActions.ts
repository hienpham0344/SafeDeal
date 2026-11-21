import { useCallback, useMemo, useRef, useState } from "react";
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

function hasLiveConnector(connector: unknown): connector is Connector {
  return (
    typeof connector === "object" &&
    connector !== null &&
    "getChainId" in connector &&
    typeof (connector as { getChainId?: unknown }).getChainId === "function"
  );
}

function classifyWalletError(error: unknown): string {
  if (!(error instanceof Error)) return "Transaction failed.";
  const msg = error.message;
  if (msg.includes("User rejected") || msg.includes("User denied")) {
    return "Transaction rejected in wallet.";
  }
  if (msg.includes("getChainId is not a function")) {
    return "Wallet connection is stale or still reconnecting. Open Wallet & Session, disconnect, and reconnect your wallet.";
  }
  if (/timed out|timeout/i.test(msg)) {
    return "Transaction confirmation timed out. Check explorer or refresh to sync state.";
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
        const { contractAddress } = ensureReady();
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
