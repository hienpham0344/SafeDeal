import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { contractsConfig } from "@/config/contracts";
import { env } from "@/config/env";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";

export interface TxExecutionResult {
  readonly txHash: `0x${string}`;
  readonly blockNumber: bigint;
}

function classifyWalletError(error: unknown): string {
  if (!(error instanceof Error)) return "Transaction failed.";
  const msg = error.message;
  if (msg.includes("User rejected") || msg.includes("User denied")) {
    return "Transaction rejected in wallet.";
  }
  if (msg.includes("timed out") || msg.includes("Timeout")) {
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
  return useReadContract({
    address: contractsConfig.escrowAddress,
    abi: contractsConfig.escrowAbi,
    functionName: "getTrade",
    args: tradeId ? [tradeId] : undefined,
    query: {
      enabled: Boolean(contractsConfig.escrowAddress && tradeId),
      refetchInterval: 10_000,
    },
  });
}

export function useEscrowContractExecutor() {
  const { isConnected, isWrongNetwork } = useAuthSession();
  const publicClient = usePublicClient({ chainId: env.chainId });
  const { writeContractAsync } = useWriteContract();
  const [activeAction, setActiveAction] = useState<string | null>(null);
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

  const waitForHash = useCallback(
    async (txHash: `0x${string}`): Promise<TxExecutionResult> => {
      const { client } = ensureReady();
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
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
      submit: (contractAddress: `0x${string}`) => Promise<`0x${string}`>,
      onHashSubmitted?: (txHash: `0x${string}`) => void
    ): Promise<TxExecutionResult> => {
      if (activeAction) {
        throw new Error(`Another transaction (${activeAction}) is already in progress.`);
      }
      setTxError(null);
      setActiveAction(actionName);
      try {
        const { contractAddress } = ensureReady();
        const txHash = await submit(contractAddress);
        onHashSubmitted?.(txHash);
        return await waitForHash(txHash);
      } catch (err) {
        const readable = classifyWalletError(err);
        setTxError(readable);
        throw new Error(readable);
      } finally {
        setActiveAction(null);
      }
    },
    [activeAction, ensureReady, waitForHash]
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "createTrade",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "fundTrade",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "markDelivered",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "releaseFunds",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "refundBySeller",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "refundAfterDeadline",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "cancelUnfundedTrade",
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
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "openDispute",
            args: [tradeId],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const resolveDispute = useCallback(
    (
      tradeId: `0x${string}`,
      buyerAmountWei: bigint,
      sellerAmountWei: bigint,
      onHashSubmitted?: (txHash: `0x${string}`) => void
    ) =>
      runContractCall(
        "resolveDispute",
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "resolveDispute",
            args: [tradeId, buyerAmountWei, sellerAmountWei],
          }),
        onHashSubmitted
      ),
    [runContractCall, writeContractAsync]
  );

  const withdraw = useCallback(
    (onHashSubmitted?: (txHash: `0x${string}`) => void) =>
      runContractCall(
        "withdraw",
        (address) =>
          writeContractAsync({
            address,
            abi: contractsConfig.escrowAbi,
            functionName: "withdraw",
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
      resolveDispute,
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
      resolveDispute,
      withdraw,
    ]
  );
}
