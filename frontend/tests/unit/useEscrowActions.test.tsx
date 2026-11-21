import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEscrowContractExecutor } from "@/features/escrow/hooks/useEscrowActions";

const CONTRACT_ADDR = "0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29" as const;
const TRADE_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const BUYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ARBITER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const TERMS_HASH = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const writeContractAsyncMock = vi.fn();
const waitForTransactionReceiptMock = vi.fn();
const reconnectMock = vi.fn();
const getAccountMock = vi.fn();

let mockAccountConnector: unknown = undefined;
let mockConfigConnectors: unknown[] = [];

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      chainId: 43113,
      chainName: "Avalanche Fuji C-Chain",
      escrowContractAddress: "0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29",
    },
  };
});

vi.mock("@/config/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/contracts")>();
  return {
    ...actual,
    contractsConfig: {
      ...actual.contractsConfig,
      escrowAddress: "0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29",
    },
  };
});

vi.mock("@/features/authentication/hooks/useAuthSession", () => ({
  useAuthSession: () => ({
    isConnected: true,
    isWrongNetwork: false,
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ connector: mockAccountConnector }),
  useConfig: () => ({ connectors: mockConfigConnectors }),
  usePublicClient: () => ({
    waitForTransactionReceipt: waitForTransactionReceiptMock,
  }),
  useReadContract: () => ({ data: 0n }),
  useWriteContract: () => ({ writeContractAsync: writeContractAsyncMock }),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: (...args: unknown[]) => getAccountMock(...args),
  reconnect: (...args: unknown[]) => reconnectMock(...args),
}));

describe("useEscrowContractExecutor connector hydration resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountConnector = undefined;
    mockConfigConnectors = [];
    getAccountMock.mockReturnValue({ connector: undefined });
    reconnectMock.mockResolvedValue([]);
    writeContractAsyncMock.mockResolvedValue(TX_HASH);
    waitForTransactionReceiptMock.mockResolvedValue({
      status: "success",
      blockNumber: 42n,
    });
  });

  it("recovers a live connector when wagmi state only holds a persisted plain connector object", async () => {
    const stalePersistedConnector = {
      id: "injected",
      name: "Injected",
      type: "injected",
      uid: "stale-uid",
    };
    const liveConnector = {
      id: "injected",
      name: "Injected",
      type: "injected",
      uid: "stale-uid",
      getChainId: vi.fn().mockResolvedValue(43113),
      getAccounts: vi.fn().mockResolvedValue([BUYER]),
    };

    mockAccountConnector = stalePersistedConnector;
    mockConfigConnectors = [liveConnector];
    getAccountMock
      .mockReturnValueOnce({ connector: stalePersistedConnector })
      .mockReturnValueOnce({ connector: liveConnector });

    const { result } = renderHook(() => useEscrowContractExecutor());

    await act(async () => {
      const tx = await result.current.createTrade({
        tradeId: TRADE_ID,
        preassignedBuyer: BUYER,
        arbiter: ARBITER,
        amountWei: 50_000_000_000_000_000n,
        termsHash: TERMS_HASH,
        fundingDeadline: 1_900_000_000n,
        deliveryDeadline: 1_900_100_000n,
        inspectionWindow: 86_400n,
      });
      expect(tx.txHash).toBe(TX_HASH);
    });

    expect(reconnectMock).toHaveBeenCalledTimes(1);
    expect(writeContractAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT_ADDR,
        functionName: "createTrade",
        connector: liveConnector,
        chainId: 43113,
      })
    );
  });

  it("surfaces a readable reconnect error instead of raw getChainId TypeError when no live connector exists", async () => {
    mockAccountConnector = { id: "injected", name: "Injected", type: "injected", uid: "stale-uid" };
    mockConfigConnectors = [];

    const { result } = renderHook(() => useEscrowContractExecutor());

    await act(async () => {
      await expect(result.current.withdraw()).rejects.toThrow(
        /Wallet connection is stale or still reconnecting/i
      );
    });
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
  });
});
