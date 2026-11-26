import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletModal } from "@/components/wallet/WalletModal";
import { ArbiterPage } from "@/pages/ArbiterPage";
import { CreateDealPage } from "@/pages/CreateDealPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DealDetailsPage } from "@/pages/DealDetailsPage";
import { DisputePage } from "@/pages/DisputePage";
import { SupportPage } from "@/pages/SupportPage";
import type { DealDetail, DealSummary, DisputeDetail } from "@/types/api";
import { computeCanonicalTermsHash } from "@/utils/canonical-terms";

const SELLER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const BUYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ARBITER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const CONTRACT_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const TRADE_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

let mockSessionState = {
  address: SELLER as `0x${string}` | undefined,
  isConnected: true,
  isWrongNetwork: false,
  isAuthenticated: true,
  isAuthenticating: false,
  isSessionLoading: false,
  walletChainId: 31337,
  expectedChainId: 31337,
  sessionUser: { address: SELLER, chainId: 31337, authenticatedAt: "2026-01-01T00:00:00Z" },
  authError: null,
  walletModalOpen: false,
  openWalletModal: vi.fn(),
  closeWalletModal: vi.fn(),
  connectInjectedWallet: vi.fn(),
  signInWithWallet: vi.fn(),
  switchToExpectedNetwork: vi.fn(),
  disconnectAndSignOut: vi.fn(),
  clearAuthError: vi.fn(),
};

const mockExecutor = {
  activeAction: null as string | null,
  txError: null as string | null,
  clearTxError: vi.fn(),
  waitForHash: vi.fn(),
  createTrade: vi.fn(),
  fundTrade: vi.fn(),
  markDelivered: vi.fn(),
  releaseFunds: vi.fn(),
  refundBySeller: vi.fn(),
  refundAfterDeadline: vi.fn(),
  cancelUnfundedTrade: vi.fn(),
  openDispute: vi.fn(),
  submitResolutionVote: vi.fn(),
  resolveDisputeByTimeout: vi.fn(),
  withdraw: vi.fn(),
};

let mockOnChainTrade: {
  data:
    | {
        status: number;
        seller?: `0x${string}`;
        buyer?: `0x${string}`;
        arbiter?: `0x${string}`;
        amount?: bigint;
        termsHash?: `0x${string}`;
        deliveredAt?: bigint;
      }
    | undefined;
  isSuccess?: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: undefined,
  refetch: vi.fn(),
};

let mockOnChainDisputeVotes: {
  data:
    | {
        buyerVoteHash: `0x${string}`;
        sellerVoteHash: `0x${string}`;
        arbiterVoteHash: `0x${string}`;
        disputedAt: bigint;
        timeoutAt: bigint;
      }
    | undefined;
  isSuccess?: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: undefined,
  refetch: vi.fn(),
};

const sampleDealSummary: DealSummary = {
  tradeId: TRADE_ID,
  title: "Avalanche Validator Consulting",
  description: "Full validator cluster hardening and key custody audit.",
  seller: SELLER,
  buyer: BUYER,
  arbiter: ARBITER,
  amountWei: "2000000000000000000",
  termsHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
  fundingDeadline: "2027-01-01T00:00:00Z",
  deliveryDeadline: "2027-01-08T00:00:00Z",
  inspectionWindowSeconds: 86400,
  status: "FUNDED",
  onChainBound: true,
  settled: false,
  deliveredAt: null,
  fundedAt: "2026-12-01T00:00:00Z",
  createdAt: "2026-12-01T00:00:00Z",
  disputeId: null,
};

const sampleDealDetail: DealDetail = {
  ...sampleDealSummary,
  terms: "Delivery within 7 days with signed report.",
  canonicalTermsJson: "{}",
  chainId: 31337,
  contractAddress: CONTRACT_ADDR,
  createTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const sampleDispute: DisputeDetail = {
  id: 7,
  tradeId: TRADE_ID,
  dealTitle: "Avalanche Validator Consulting",
  dealAmountWei: "1000000000000000000",
  seller: SELLER,
  buyer: BUYER,
  arbiter: ARBITER,
  openedBy: BUYER,
  reason: "Incomplete audit report",
  summary: "Missing node failover benchmark data.",
  status: "OPEN",
  buyerAwardWei: null,
  sellerAwardWei: null,
  resolutionRationale: null,
  openTxHash: null,
  resolveTxHash: null,
  createdAt: "2026-12-02T00:00:00Z",
  disputedAt: "2026-12-02T00:00:00Z",
  evidenceDeadlineAt: "2026-12-09T00:00:00Z",
  timeoutAt: "2026-12-16T00:00:00Z",
  resolvedAt: null,
  votes: [],
};

const listDealsMock = vi.fn();
const getDealMock = vi.fn();
const getDealHistoryMock = vi.fn();
const createDealDraftMock = vi.fn();
const bindDealTxMock = vi.fn();
const syncDealMock = vi.fn();
const listAssignedDisputesMock = vi.fn();
const recordResolutionMock = vi.fn();
const createDisputeMock = vi.fn();
const getDisputeMock = vi.fn();
const listDisputeEvidenceMock = vi.fn();
const submitDisputeVoteMock = vi.fn();
const recordDisputeTimeoutMock = vi.fn();

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      chainId: 31337,
      chainName: "Anvil Local",
      escrowContractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    },
  };
});

vi.mock("@/features/authentication/hooks/useAuthSession", () => ({
  useAuthSession: () => mockSessionState,
}));

vi.mock("@/features/escrow/hooks/useEscrowActions", () => ({
  useClaimableBalance: () => ({ data: 500000000000000000n, refetch: vi.fn() }),
  useOnChainTrade: () => mockOnChainTrade,
  useOnChainDisputeVotes: () => mockOnChainDisputeVotes,
  useEscrowContractExecutor: () => mockExecutor,
}));

vi.mock("@/features/deals/api/deals-api", () => ({
  listDeals: (...args: unknown[]) => listDealsMock(...args),
  getDeal: (...args: unknown[]) => getDealMock(...args),
  getDealHistory: (...args: unknown[]) => getDealHistoryMock(...args),
  createDealDraft: (...args: unknown[]) => createDealDraftMock(...args),
  bindDealTransaction: (...args: unknown[]) => bindDealTxMock(...args),
  syncDealState: (...args: unknown[]) => syncDealMock(...args),
}));

vi.mock("@/features/arbitration/api/arbitration-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/arbitration/api/arbitration-api")>();
  return {
    ...actual,
    listAssignedDisputes: (...args: unknown[]) => listAssignedDisputesMock(...args),
    recordArbitrationResolution: (...args: unknown[]) => recordResolutionMock(...args),
  };
});

vi.mock("@/features/disputes/api/disputes-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/disputes/api/disputes-api")>();
  return {
    ...actual,
    createDisputeMetadata: (...args: unknown[]) => createDisputeMock(...args),
    getDispute: (...args: unknown[]) => getDisputeMock(...args),
    listDisputeEvidence: (...args: unknown[]) => listDisputeEvidenceMock(...args),
    submitDisputeVoteRecord: (...args: unknown[]) => submitDisputeVoteMock(...args),
    recordDisputeTimeoutResolution: (...args: unknown[]) => recordDisputeTimeoutMock(...args),
  };
});

function renderWithQuery(ui: React.ReactElement, initialRoute = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SafeDeal Dashboard, DealDetails & Arbiter Pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockOnChainTrade = { data: undefined, refetch: vi.fn() };
    mockOnChainDisputeVotes = { data: undefined, refetch: vi.fn() };
    mockSessionState = {
      ...mockSessionState,
      address: SELLER,
      isConnected: true,
      isWrongNetwork: false,
      isAuthenticated: true,
      walletModalOpen: false,
    };
  });

  it("renders deals on Dashboard and filters by tab plus claimable withdrawal banner", async () => {
    const user = userEvent.setup();
    listDealsMock.mockResolvedValue({
      items: [
        sampleDealSummary,
        {
          ...sampleDealSummary,
          tradeId: "0x3333333333333333333333333333333333333333333333333333333333333333",
          title: "Disputed Escrow Deal",
          seller: BUYER,
          buyer: SELLER,
          status: "DISPUTED",
        },
      ],
      page: 0,
      size: 50,
      totalItems: 2,
      totalPages: 1,
    });

    renderWithQuery(<DashboardPage />);

    expect(await screen.findByText("Avalanche Validator Consulting")).toBeInTheDocument();
    expect(screen.getByText("Disputed Escrow Deal")).toBeInTheDocument();
    expect(screen.getByText(/0\.5 AVAX ready to withdraw/i)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Disputed" }));
    expect(screen.queryByText("Avalanche Validator Consulting")).not.toBeInTheDocument();
    expect(screen.getByText("Disputed Escrow Deal")).toBeInTheDocument();
  });

  it("prompts wallet connection when disconnected on Dashboard", () => {
    mockSessionState.isConnected = false;
    mockSessionState.isAuthenticated = false;
    mockSessionState.address = undefined;

    renderWithQuery(<DashboardPage />);
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument();
  });

  it("renders role-gated seller actions on DealDetailsPage for a FUNDED deal", async () => {
    getDealMock.mockResolvedValue(sampleDealDetail);
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    expect(await screen.findByText("Avalanche Validator Consulting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Delivered" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voluntary Refund to Buyer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Dispute" })).toBeInTheDocument();
  });

  it("suppresses Deploy Trade On-Chain when on-chain status is CREATED and displays Sync On-Chain failure banner", async () => {
    const user = userEvent.setup();
    getDealMock.mockResolvedValue({
      ...sampleDealDetail,
      status: "DRAFT",
      onChainBound: false,
      createTxHash: null,
    });
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });
    mockOnChainTrade = { data: { status: 1 }, refetch: vi.fn() }; // 1 = CREATED on-chain
    syncDealMock.mockRejectedValueOnce(new Error("RPC node temporarily unavailable"));

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    expect(await screen.findByText("Avalanche Validator Consulting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deploy Trade On-Chain" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Unfunded Deal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sync on-chain/i }));
    expect(await screen.findByText("RPC node temporarily unavailable")).toBeInTheDocument();
  });

  it("retains confirmed createTrade txHash on bind failure and retries binding without recreating trade", async () => {
    const user = userEvent.setup();
    const fundingLocal = "2030-01-01T12:00";
    const deliveryLocal = "2030-01-08T12:00";
    const fundingEpoch = Math.floor(Date.parse(fundingLocal) / 1000);
    const deliveryEpoch = Math.floor(Date.parse(deliveryLocal) / 1000);
    const title = "Recovery Flow Escrow Deal";
    const description = "Testing partial on-chain create recovery before bind succeeds.";
    const terms = "Deliver artifact and verify SHA-256 commitment.";

    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: 31337,
      seller: SELLER,
      buyer: BUYER,
      arbiter: ARBITER,
      amountWei: "1000000000000000000",
      fundingDeadline: fundingEpoch,
      deliveryDeadline: deliveryEpoch,
      inspectionWindowSeconds: 72 * 3600,
      title,
      description,
      terms,
    });

    createDealDraftMock.mockResolvedValueOnce({
      tradeId: TRADE_ID,
      termsHash,
      contractAddress: CONTRACT_ADDR,
      chainId: 31337,
      deal: {
        ...sampleDealDetail,
        title,
        description,
        terms,
        canonicalTermsJson: canonicalJson,
        amountWei: "1000000000000000000",
        fundingDeadline: new Date(fundingEpoch * 1000).toISOString(),
        deliveryDeadline: new Date(deliveryEpoch * 1000).toISOString(),
        inspectionWindowSeconds: 72 * 3600,
        status: "DRAFT",
        onChainBound: false,
        createTxHash: null,
      },
    });

    const confirmedTx = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as const;
    mockExecutor.createTrade.mockResolvedValueOnce({ txHash: confirmedTx, blockNumber: 42n });
    bindDealTxMock.mockRejectedValueOnce(new Error("Transient 503 binding failure"));

    renderWithQuery(<CreateDealPage />);

    await user.type(screen.getByLabelText("Deal Title"), title);
    await user.type(screen.getByLabelText("Description"), description);
    await user.clear(screen.getByLabelText(/Amount/));
    await user.type(screen.getByLabelText(/Amount/), "1.0");
    fireEvent.change(screen.getByLabelText("Funding Deadline"), { target: { value: fundingLocal } });
    fireEvent.change(screen.getByLabelText("Delivery Deadline"), { target: { value: deliveryLocal } });
    await user.type(screen.getByLabelText("Arbiter Wallet Address"), ARBITER);
    await user.type(screen.getByLabelText(/Preassigned Buyer Address/), BUYER);
    await user.type(screen.getByLabelText(/Terms & Acceptance Criteria/), terms);

    await user.click(screen.getByRole("button", { name: "Preview On-Chain Transaction" }));

    const deployBtn = await screen.findByRole("button", { name: "Create Trade On-Chain" });
    await user.click(deployBtn);

    expect(await screen.findByText("Transient 503 binding failure")).toBeInTheDocument();
    expect(screen.getByText("On-Chain Transaction Submitted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Draft" })).toBeDisabled();

    const retryBtn = screen.getByRole("button", { name: "Retry Backend Binding" });
    bindDealTxMock.mockResolvedValueOnce({ ...sampleDealDetail, status: "CREATED", onChainBound: true });
    await user.click(retryBtn);

    expect(await screen.findByText("Deal Created & Bound")).toBeInTheDocument();
    expect(mockExecutor.createTrade).toHaveBeenCalledTimes(1);
    expect(bindDealTxMock).toHaveBeenCalledTimes(2);
    expect(bindDealTxMock).toHaveBeenLastCalledWith(TRADE_ID, confirmedTx);
  });

  it("executes pull-withdrawal on DealDetailsPage without calling syncDeal with withdraw txHash", async () => {
    const user = userEvent.setup();
    getDealMock.mockResolvedValue(sampleDealDetail);
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });
    mockExecutor.withdraw.mockResolvedValueOnce({
      txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      blockNumber: 55n,
    });

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    const withdrawBtn = await screen.findByRole("button", { name: "Withdraw AVAX" });
    await user.click(withdrawBtn);

    expect(await screen.findByText(/Withdrawal confirmed on-chain/i)).toBeInTheDocument();
    expect(mockExecutor.withdraw).toHaveBeenCalledTimes(1);
    expect(syncDealMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched buyer/seller split totals in ArbiterPage without calling contract", async () => {
    const user = userEvent.setup();
    mockSessionState.address = ARBITER;
    listAssignedDisputesMock.mockResolvedValue([sampleDispute]);

    renderWithQuery(<ArbiterPage />);

    expect(await screen.findByText(/Dispute #7/)).toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    // buyer allocation, seller allocation, rationale
    await user.clear(inputs[0]!);
    await user.type(inputs[0]!, "0.7");
    await user.clear(inputs[1]!);
    await user.type(inputs[1]!, "0.7");
    await user.type(inputs[2]!, "Buyer and seller failed verification thresholds.");
    await user.click(screen.getByRole("button", { name: /sign & submit settlement/i }));

    expect(await screen.findByText(/must sum exactly to the locked escrow amount/i)).toBeInTheDocument();
    expect(mockExecutor.submitResolutionVote).not.toHaveBeenCalled();
  });

  it("recovers pending createTrade after /create reload via waitForHash without re-invoking createTrade", async () => {
    const pendingTxHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;
    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: 31337,
      seller: SELLER,
      buyer: BUYER,
      arbiter: ARBITER,
      amountWei: "1000000000000000000",
      fundingDeadline: 1893499200,
      deliveryDeadline: 1894104000,
      inspectionWindowSeconds: 72 * 3600,
      title: "Pending Reload Deal",
      description: "Testing browser refresh recovery while createTrade confirmation is pending.",
      terms: "Deliver package with signed manifest.",
    });

    const draftPayload = {
      tradeId: TRADE_ID,
      termsHash,
      contractAddress: CONTRACT_ADDR,
      chainId: 31337,
      deal: {
        ...sampleDealDetail,
        title: "Pending Reload Deal",
        description: "Testing browser refresh recovery while createTrade confirmation is pending.",
        terms: "Deliver package with signed manifest.",
        canonicalTermsJson: canonicalJson,
        amountWei: "1000000000000000000",
        fundingDeadline: new Date(1893499200 * 1000).toISOString(),
        deliveryDeadline: new Date(1894104000 * 1000).toISOString(),
        inspectionWindowSeconds: 72 * 3600,
        status: "DRAFT",
        onChainBound: false,
        createTxHash: null,
      },
    };

    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER,
        previewDraft: draftPayload,
        clientTermsHash: termsHash,
        submittedCreateTxHash: null,
        updatedAt: new Date().toISOString(),
      })
    );
    window.sessionStorage.setItem(
      `safedeal:pending-tx:create-${TRADE_ID}`,
      JSON.stringify({
        txHash: pendingTxHash,
        action: "createTrade",
        startedAt: new Date().toISOString(),
      })
    );

    mockExecutor.waitForHash.mockResolvedValueOnce({ txHash: pendingTxHash, blockNumber: 91n });
    bindDealTxMock.mockResolvedValueOnce({ ...sampleDealDetail, status: "CREATED", onChainBound: true });

    renderWithQuery(<CreateDealPage />);

    expect(await screen.findByText("Deal Created & Bound")).toBeInTheDocument();
    expect(mockExecutor.createTrade).not.toHaveBeenCalled();
    expect(mockExecutor.waitForHash).toHaveBeenCalledTimes(1);
    expect(mockExecutor.waitForHash).toHaveBeenCalledWith(pendingTxHash);
    expect(bindDealTxMock).toHaveBeenCalledWith(TRADE_ID, pendingTxHash);
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER.toLowerCase()}`)).toBeNull();
    expect(window.sessionStorage.getItem(`safedeal:pending-tx:create-${TRADE_ID}`)).toBeNull();
  });

  it("restores confirmed createTrade after reload before backend bind succeeds and clears draft on Edit Draft", async () => {
    const user = userEvent.setup();
    const confirmedTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: 31337,
      seller: SELLER,
      buyer: BUYER,
      arbiter: ARBITER,
      amountWei: "1000000000000000000",
      fundingDeadline: 1893499200,
      deliveryDeadline: 1894104000,
      inspectionWindowSeconds: 72 * 3600,
      title: "Confirmed Pre-Bind Deal",
      description: "Testing reload after tx confirmation but before backend bind succeeds.",
      terms: "Verify checksum and release upon acceptance.",
    });

    const draftPayload = {
      tradeId: TRADE_ID,
      termsHash,
      contractAddress: CONTRACT_ADDR,
      chainId: 31337,
      deal: {
        ...sampleDealDetail,
        title: "Confirmed Pre-Bind Deal",
        description: "Testing reload after tx confirmation but before backend bind succeeds.",
        terms: "Verify checksum and release upon acceptance.",
        canonicalTermsJson: canonicalJson,
        amountWei: "1000000000000000000",
        fundingDeadline: new Date(1893499200 * 1000).toISOString(),
        deliveryDeadline: new Date(1894104000 * 1000).toISOString(),
        inspectionWindowSeconds: 72 * 3600,
        status: "DRAFT",
        onChainBound: false,
        createTxHash: null,
      },
    };

    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER,
        previewDraft: draftPayload,
        clientTermsHash: termsHash,
        submittedCreateTxHash: confirmedTxHash,
        updatedAt: new Date().toISOString(),
      })
    );

    const view = renderWithQuery(<CreateDealPage />);

    expect(await screen.findByText("Confirmed Pre-Bind Deal")).toBeInTheDocument();
    expect(screen.getByText("On-Chain Transaction Submitted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Draft" })).toBeDisabled();

    bindDealTxMock.mockResolvedValueOnce({ ...sampleDealDetail, status: "CREATED", onChainBound: true });
    await user.click(screen.getByRole("button", { name: "Retry Backend Binding" }));

    expect(await screen.findByText("Deal Created & Bound")).toBeInTheDocument();
    expect(mockExecutor.createTrade).not.toHaveBeenCalled();
    expect(mockExecutor.waitForHash).not.toHaveBeenCalled();
    expect(bindDealTxMock).toHaveBeenCalledWith(TRADE_ID, confirmedTxHash);
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER.toLowerCase()}`)).toBeNull();
    view.unmount();

    // Unconfirmed Step 2 draft also restores and clears cleanly when Edit Draft is clicked
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER,
        previewDraft: draftPayload,
        clientTermsHash: termsHash,
        submittedCreateTxHash: null,
        updatedAt: new Date().toISOString(),
      })
    );

    renderWithQuery(<CreateDealPage />);
    expect(await screen.findByText("Confirmed Pre-Bind Deal")).toBeInTheDocument();
    const editBtn = screen.getByRole("button", { name: "Edit Draft" });
    expect(editBtn).toBeEnabled();
    await user.click(editBtn);

    expect(await screen.findByRole("button", { name: "Preview On-Chain Transaction" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER.toLowerCase()}`)).toBeNull();
  });

  it("automatically expires and purges abandoned drafts older than 24 hours on CreateDealPage load", async () => {
    const expiredTimestamp = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: 31337,
      seller: SELLER,
      buyer: BUYER,
      arbiter: ARBITER,
      amountWei: "1000000000000000000",
      fundingDeadline: 1893499200,
      deliveryDeadline: 1894104000,
      inspectionWindowSeconds: 72 * 3600,
      title: "Stale Abandoned Deal Draft",
      description: "This draft has exceeded the 24h retention window.",
      terms: "Terms text.",
    });

    const draftPayload = {
      tradeId: TRADE_ID,
      termsHash,
      contractAddress: CONTRACT_ADDR,
      chainId: 31337,
      deal: {
        ...sampleDealDetail,
        title: "Stale Abandoned Deal Draft",
        description: "This draft has exceeded the 24h retention window.",
        terms: "Terms text.",
        canonicalTermsJson: canonicalJson,
        amountWei: "1000000000000000000",
        fundingDeadline: new Date(1893499200 * 1000).toISOString(),
        deliveryDeadline: new Date(1894104000 * 1000).toISOString(),
        inspectionWindowSeconds: 72 * 3600,
        status: "DRAFT",
        onChainBound: false,
        createTxHash: null,
      },
    };

    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER,
        previewDraft: draftPayload,
        clientTermsHash: termsHash,
        submittedCreateTxHash: null,
        updatedAt: expiredTimestamp,
      })
    );

    renderWithQuery(<CreateDealPage />);

    // Should NOT restore the draft, should render Step 1 form instead of Step 2 preview
    expect(await screen.findByRole("button", { name: "Preview On-Chain Transaction" })).toBeInTheDocument();
    expect(screen.queryByText("Stale Abandoned Deal Draft")).toBeNull();
    // Storage should be cleared
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER.toLowerCase()}`)).toBeNull();
  });

  it("synchronizes DealDetailsPage fundTrade exactly once without duplicate waitForHash and retains txHash across transient 503 failure", async () => {
    const user = userEvent.setup();
    const fundTxHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;
    const { termsHash: verifiedTermsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: sampleDealDetail.chainId,
      seller: sampleDealDetail.seller,
      buyer: sampleDealDetail.buyer,
      arbiter: sampleDealDetail.arbiter,
      amountWei: sampleDealDetail.amountWei,
      fundingDeadline: Math.floor(Date.parse(sampleDealDetail.fundingDeadline) / 1000),
      deliveryDeadline: Math.floor(Date.parse(sampleDealDetail.deliveryDeadline) / 1000),
      inspectionWindowSeconds: sampleDealDetail.inspectionWindowSeconds,
      title: sampleDealDetail.title,
      description: sampleDealDetail.description,
      terms: sampleDealDetail.terms,
    });
    const verifiedDeal = {
      ...sampleDealDetail,
      termsHash: verifiedTermsHash,
      canonicalTermsJson: canonicalJson,
    };
    mockSessionState.address = BUYER;
    getDealMock.mockResolvedValue({ ...verifiedDeal, status: "CREATED" });
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });
    mockOnChainTrade = { data: { status: 1 }, refetch: vi.fn().mockResolvedValue(undefined) };

    let resolveFund!: (val: { txHash: `0x${string}`; blockNumber: bigint }) => void;
    mockExecutor.fundTrade.mockImplementationOnce(async (_id, _amount, onHash?: (hash: `0x${string}`) => void) => {
      onHash?.(fundTxHash);
      return await new Promise<{ txHash: `0x${string}`; blockNumber: bigint }>((resolve) => {
        resolveFund = resolve;
      });
    });

    // First sync attempt fails transiently (503); second sync succeeds via Sync On-Chain button
    syncDealMock
      .mockRejectedValueOnce(new Error("Backend temporarily unavailable (503)"))
      .mockResolvedValueOnce({ ...verifiedDeal, status: "FUNDED" });

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    const fundBtn = await screen.findByRole("button", { name: /Fund Escrow/i });
    await user.click(fundBtn);

    // Pending banner renders (causing a state-driven re-render) while fundTrade awaits receipt
    expect(await screen.findByText("Pending fundTrade")).toBeInTheDocument();
    expect(mockExecutor.waitForHash).not.toHaveBeenCalled();

    resolveFund({ txHash: fundTxHash, blockNumber: 77n });

    // Transient 503 preserves pendingTx hash in sessionStorage instead of wiping it
    expect(await screen.findByText("Backend temporarily unavailable (503)")).toBeInTheDocument();
    expect(syncDealMock).toHaveBeenCalledTimes(1);
    expect(syncDealMock).toHaveBeenCalledWith(TRADE_ID, fundTxHash);
    expect(window.sessionStorage.getItem(`safedeal:pending-tx:${TRADE_ID}`)).toContain(fundTxHash);

    // Clicking Sync On-Chain sends the retained txHash and clears pendingTx on success
    await user.click(screen.getByRole("button", { name: /sync on-chain/i }));
    expect(await screen.findByText(/Deal synced from chain \(FUNDED\)/i)).toBeInTheDocument();
    expect(syncDealMock).toHaveBeenCalledTimes(2);
    expect(syncDealMock).toHaveBeenLastCalledWith(TRADE_ID, fundTxHash);
    expect(window.sessionStorage.getItem(`safedeal:pending-tx:${TRADE_ID}`)).toBeNull();
  });

  it("clears Seller A createdTradeId and draft across disconnect then Seller B reconnect on CreateDealPage", async () => {
    const user = userEvent.setup();
    const fundingLocal = "2030-01-01T12:00";
    const deliveryLocal = "2030-01-08T12:00";
    const fundingEpoch = Math.floor(Date.parse(fundingLocal) / 1000);
    const deliveryEpoch = Math.floor(Date.parse(deliveryLocal) / 1000);
    const title = "Seller Switch Isolation Deal";
    const description = "Testing state isolation when disconnecting Seller A and connecting Seller B.";
    const terms = "Verified terms isolation across wallet changes.";

    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: 31337,
      seller: SELLER,
      buyer: BUYER,
      arbiter: ARBITER,
      amountWei: "1000000000000000000",
      fundingDeadline: fundingEpoch,
      deliveryDeadline: deliveryEpoch,
      inspectionWindowSeconds: 72 * 3600,
      title,
      description,
      terms,
    });

    createDealDraftMock.mockResolvedValueOnce({
      tradeId: TRADE_ID,
      termsHash,
      contractAddress: CONTRACT_ADDR,
      chainId: 31337,
      deal: {
        ...sampleDealDetail,
        title,
        description,
        terms,
        canonicalTermsJson: canonicalJson,
        amountWei: "1000000000000000000",
        fundingDeadline: new Date(fundingEpoch * 1000).toISOString(),
        deliveryDeadline: new Date(deliveryEpoch * 1000).toISOString(),
        inspectionWindowSeconds: 72 * 3600,
        status: "DRAFT",
        onChainBound: false,
        createTxHash: null,
      },
    });
    mockExecutor.createTrade.mockResolvedValueOnce({
      txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      blockNumber: 42n,
    });
    bindDealTxMock.mockResolvedValueOnce({ ...sampleDealDetail, status: "CREATED", onChainBound: true });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/create"]}>
          <CreateDealPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const view = render(tree());
    await user.type(screen.getByLabelText("Deal Title"), title);
    await user.type(screen.getByLabelText("Description"), description);
    await user.clear(screen.getByLabelText(/Amount/));
    await user.type(screen.getByLabelText(/Amount/), "1.0");
    fireEvent.change(screen.getByLabelText("Funding Deadline"), { target: { value: fundingLocal } });
    fireEvent.change(screen.getByLabelText("Delivery Deadline"), { target: { value: deliveryLocal } });
    await user.type(screen.getByLabelText("Arbiter Wallet Address"), ARBITER);
    await user.type(screen.getByLabelText(/Preassigned Buyer Address/), BUYER);
    await user.type(screen.getByLabelText(/Terms & Acceptance Criteria/), terms);
    await user.click(screen.getByRole("button", { name: "Preview On-Chain Transaction" }));
    await user.click(await screen.findByRole("button", { name: "Create Trade On-Chain" }));
    expect(await screen.findByText("Deal Created & Bound")).toBeInTheDocument();

    // Disconnect wallet -> rerender -> reconnect as Seller B
    mockSessionState = { ...mockSessionState, address: undefined, isConnected: false, isAuthenticated: false };
    view.rerender(tree());

    mockSessionState = { ...mockSessionState, address: BUYER, isConnected: true, isAuthenticated: true };
    view.rerender(tree());

    expect(screen.queryByText("Deal Created & Bound")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Preview On-Chain Transaction" })).toBeInTheDocument();
  });

  it("recovers pending DealDetailsPage fundTrade after reload with a single waitForHash and sync even if query objects churn", async () => {
    const pendingTxHash = "0x9999999999999999999999999999999999999999999999999999999999999999" as const;
    mockSessionState.address = BUYER;
    getDealMock.mockResolvedValue({ ...sampleDealDetail, status: "CREATED" });
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });
    window.sessionStorage.setItem(
      `safedeal:pending-tx:${TRADE_ID}`,
      JSON.stringify({
        txHash: pendingTxHash,
        action: "fundTrade",
        startedAt: new Date().toISOString(),
      })
    );

    let resolveReceipt!: (val: { txHash: `0x${string}`; blockNumber: bigint }) => void;
    mockExecutor.waitForHash.mockImplementationOnce(
      async () =>
        await new Promise<{ txHash: `0x${string}`; blockNumber: bigint }>((resolve) => {
          resolveReceipt = resolve;
        })
    );
    syncDealMock.mockResolvedValueOnce({ ...sampleDealDetail, status: "FUNDED" });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/deals/${TRADE_ID}`]}>
          <Routes>
            <Route path="/deals/:id" element={<DealDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const view = render(tree());
    expect(await screen.findByText("Pending fundTrade")).toBeInTheDocument();

    // Simulate wagmi polling returning a fresh query result object during pending wait
    mockOnChainTrade = { data: { status: 1 }, refetch: vi.fn().mockResolvedValue(undefined) };
    view.rerender(tree());

    resolveReceipt({ txHash: pendingTxHash, blockNumber: 88n });

    expect(await screen.findByText(new RegExp(`Pending fundTrade transaction confirmed \\(${pendingTxHash}\\)`))).toBeInTheDocument();
    expect(mockExecutor.waitForHash).toHaveBeenCalledTimes(1);
    expect(mockExecutor.waitForHash).toHaveBeenCalledWith(pendingTxHash);
    expect(syncDealMock).toHaveBeenCalledTimes(1);
    expect(syncDealMock).toHaveBeenCalledWith(TRADE_ID, pendingTxHash);
    expect(window.sessionStorage.getItem(`safedeal:pending-tx:${TRADE_ID}`)).toBeNull();
  });

  it("retains confirmed submitResolutionVote txHash on 503 failure in ArbiterPage and retries submitDisputeVoteRecord without resending tx", async () => {
    const user = userEvent.setup();
    const resolveTxHash = "0xabababababababababababababababababababababababababababababababab" as const;
    mockSessionState.address = ARBITER;
    listAssignedDisputesMock.mockResolvedValue([sampleDispute]);
    mockExecutor.submitResolutionVote.mockImplementationOnce(
      async (_tradeId, _buyerWei, _sellerWei, onHash?: (hash: `0x${string}`) => void) => {
        onHash?.(resolveTxHash);
        return { txHash: resolveTxHash, blockNumber: 120n };
      }
    );
    submitDisputeVoteMock
      .mockRejectedValueOnce(new Error("Backend temporarily unavailable (503)"))
      .mockResolvedValueOnce({
        ...sampleDispute,
        status: "RESOLVED",
        buyerAwardWei: "1000000000000000000",
        sellerAwardWei: "0",
        resolutionRationale: "Evidence confirms buyer refund claim.",
        resolveTxHash,
        resolvedAt: "2026-12-03T00:00:00Z",
      });

    renderWithQuery(<ArbiterPage />);

    expect(await screen.findByText(/Dispute #7/)).toBeInTheDocument();
    const rationaleText = "Evidence confirms buyer refund claim.";
    await user.type(screen.getByLabelText("Arbitration Rationale"), rationaleText);
    await user.click(screen.getByRole("button", { name: "Sign & Submit Settlement On-Chain" }));

    expect(await screen.findByText("Backend temporarily unavailable (503)")).toBeInTheDocument();
    expect(screen.getByText("On-Chain Settlement Confirmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Buyer Allocation (AVAX)")).toBeDisabled();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:arbiter-resolve-7")).toContain(resolveTxHash);

    await user.click(screen.getByRole("button", { name: "Retry Recording Settlement" }));

    expect(
      await screen.findByText(new RegExp(`2-of-3 consensus reached and settled on-chain \\(${resolveTxHash}\\)`))
    ).toBeInTheDocument();
    expect(mockExecutor.submitResolutionVote).toHaveBeenCalledTimes(1);
    expect(submitDisputeVoteMock).toHaveBeenCalledTimes(2);
    expect(submitDisputeVoteMock).toHaveBeenLastCalledWith(7, {
      txHash: resolveTxHash,
      rationale: rationaleText,
    });
    expect(window.sessionStorage.getItem("safedeal:pending-tx:arbiter-resolve-7")).toBeNull();
  });

  it("allows arbiter to backfill arbitration rationale when indexer already marked dispute RESOLVED without rationale", async () => {
    const user = userEvent.setup();
    const indexedTxHash = "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd" as const;
    const rationaleText = "Indexed split settled on-chain; recording final rationale.";
    mockSessionState.address = ARBITER;
    listAssignedDisputesMock.mockResolvedValue([
      {
        ...sampleDispute,
        status: "RESOLVED",
        buyerAwardWei: "200000000000000000",
        sellerAwardWei: "800000000000000000",
        resolutionRationale: null,
        resolveTxHash: indexedTxHash,
        resolvedAt: "2026-12-03T00:00:00Z",
      },
    ]);
    recordResolutionMock.mockResolvedValueOnce({
      ...sampleDispute,
      status: "RESOLVED",
      buyerAwardWei: "200000000000000000",
      sellerAwardWei: "800000000000000000",
      resolutionRationale: rationaleText,
      resolveTxHash: indexedTxHash,
      resolvedAt: "2026-12-03T00:00:00Z",
    });

    renderWithQuery(<ArbiterPage />);

    expect(await screen.findByText("Settlement Indexed On-Chain")).toBeInTheDocument();
    expect(screen.getByLabelText("Buyer Allocation (AVAX)")).toHaveValue("0.2");
    expect(screen.getByLabelText("Buyer Allocation (AVAX)")).toBeDisabled();
    expect(screen.getByLabelText("Seller Allocation (AVAX)")).toHaveValue("0.8");
    expect(screen.getByLabelText("Seller Allocation (AVAX)")).toBeDisabled();

    await user.type(screen.getByLabelText("Arbitration Rationale"), rationaleText);
    await user.click(screen.getByRole("button", { name: "Save Arbitration Rationale" }));

    expect(
      await screen.findByText(new RegExp(`Arbitration rationale recorded for settlement \\(${indexedTxHash}\\)`))
    ).toBeInTheDocument();
    expect(mockExecutor.submitResolutionVote).not.toHaveBeenCalled();
    expect(recordResolutionMock).toHaveBeenCalledWith(7, {
      txHash: indexedTxHash,
      rationale: rationaleText,
    });
  });

  it("recovers pending submitResolutionVote after reload on ArbiterPage via waitForHash without duplicate tx", async () => {
    const user = userEvent.setup();
    const pendingResolveHash = "0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef" as const;
    const rationaleText = "Recovered settlement verified after reload.";
    mockSessionState.address = ARBITER;
    listAssignedDisputesMock.mockResolvedValue([sampleDispute]);
    window.sessionStorage.setItem(
      "safedeal:pending-tx:arbiter-resolve-7",
      JSON.stringify({
        txHash: pendingResolveHash,
        action: "submitResolutionVote",
        startedAt: new Date().toISOString(),
      })
    );
    mockExecutor.waitForHash.mockResolvedValueOnce({ txHash: pendingResolveHash, blockNumber: 150n });
    submitDisputeVoteMock.mockResolvedValueOnce({
      ...sampleDispute,
      status: "RESOLVED",
      buyerAwardWei: "1000000000000000000",
      sellerAwardWei: "0",
      resolutionRationale: rationaleText,
      resolveTxHash: pendingResolveHash,
      resolvedAt: "2026-12-03T00:00:00Z",
    });

    renderWithQuery(<ArbiterPage />);

    expect(await screen.findByText("On-Chain Settlement Confirmed")).toBeInTheDocument();
    expect(mockExecutor.waitForHash).toHaveBeenCalledTimes(1);
    expect(mockExecutor.waitForHash).toHaveBeenCalledWith(pendingResolveHash);

    await user.type(screen.getByLabelText("Arbitration Rationale"), rationaleText);
    await user.click(screen.getByRole("button", { name: "Retry Recording Settlement" }));

    expect(
      await screen.findByText(new RegExp(`2-of-3 consensus reached and settled on-chain \\(${pendingResolveHash}\\)`))
    ).toBeInTheDocument();
    expect(mockExecutor.submitResolutionVote).not.toHaveBeenCalled();
    expect(submitDisputeVoteMock).toHaveBeenCalledWith(7, {
      txHash: pendingResolveHash,
      rationale: rationaleText,
    });
    expect(window.sessionStorage.getItem("safedeal:pending-tx:arbiter-resolve-7")).toBeNull();
  });

  it("reuses confirmed openDispute txHash when sync fails transiently and on-chain status transitions to DISPUTED", async () => {
    const user = userEvent.setup();
    const openDisputeTxHash = "0x1212121212121212121212121212121212121212121212121212121212121212" as const;
    mockSessionState.address = BUYER;
    getDealMock.mockResolvedValue({ ...sampleDealDetail, status: "FUNDED", disputeId: null });
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });
    mockOnChainTrade = { data: { status: 2 }, refetch: vi.fn().mockResolvedValue(undefined) }; // 2 = FUNDED
    mockExecutor.openDispute.mockImplementationOnce(
      async (_tradeId, onHash?: (hash: `0x${string}`) => void) => {
        onHash?.(openDisputeTxHash);
        mockOnChainTrade = { data: { status: 6 }, refetch: vi.fn().mockResolvedValue(undefined) }; // 6 = DISPUTED
        return { txHash: openDisputeTxHash, blockNumber: 200n };
      }
    );
    syncDealMock.mockRejectedValueOnce(new Error("Backend sync temporarily unavailable (503)"));
    createDisputeMock.mockResolvedValueOnce({ ...sampleDispute, id: 19, openTxHash: openDisputeTxHash });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/deals/${TRADE_ID}`]}>
          <Routes>
            <Route path="/deals/:id" element={<DealDetailsPage />} />
            <Route path="/disputes/:id" element={<div>Dispute Detail Route</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const view = render(tree());

    await user.click(await screen.findByRole("button", { name: "Open Dispute" }));
    await user.type(
      screen.getByPlaceholderText("Short reason (e.g. Deliverable incomplete)"),
      "Incomplete delivery archive"
    );
    await user.type(
      screen.getByPlaceholderText("Explain the dispute facts for the arbiter"),
      "Delivered package is missing required checksum signature."
    );
    await user.click(screen.getByRole("button", { name: "Confirm Dispute" }));

    expect(await screen.findByText("Backend sync temporarily unavailable (503)")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(`safedeal:pending-tx:${TRADE_ID}`)).toContain(openDisputeTxHash);

    // Rerender so updated on-chain status (DISPUTED) reflects in effectiveStatus
    view.rerender(tree());
    expect(await screen.findByText("Attach Off-Chain Dispute Details")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Dispute" }));

    expect(await screen.findByText("Dispute Detail Route")).toBeInTheDocument();
    expect(mockExecutor.openDispute).toHaveBeenCalledTimes(1);
    expect(createDisputeMock).toHaveBeenCalledTimes(1);
    expect(createDisputeMock).toHaveBeenCalledWith(TRADE_ID, {
      reason: "Incomplete delivery archive",
      summary: "Delivered package is missing required checksum signature.",
      txHash: openDisputeTxHash,
    });
    expect(window.sessionStorage.getItem(`safedeal:pending-tx:${TRADE_ID}`)).toBeNull();
  });

  it("immediately drops Seller A draft without stale cross-seller exposure on instant wallet switch", async () => {
    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: 31337,
      seller: SELLER,
      buyer: BUYER,
      arbiter: ARBITER,
      amountWei: "1000000000000000000",
      fundingDeadline: 1893499200,
      deliveryDeadline: 1894104000,
      inspectionWindowSeconds: 72 * 3600,
      title: "Instant Switch Seller A Draft",
      description: "Testing zero cross-seller draft exposure during instant wallet switch.",
      terms: "Deliver package with signed manifest.",
    });

    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER,
        previewDraft: {
          tradeId: TRADE_ID,
          termsHash,
          contractAddress: CONTRACT_ADDR,
          chainId: 31337,
          deal: {
            ...sampleDealDetail,
            title: "Instant Switch Seller A Draft",
            description: "Testing zero cross-seller draft exposure during instant wallet switch.",
            terms: "Deliver package with signed manifest.",
            canonicalTermsJson: canonicalJson,
            amountWei: "1000000000000000000",
            fundingDeadline: new Date(1893499200 * 1000).toISOString(),
            deliveryDeadline: new Date(1894104000 * 1000).toISOString(),
            inspectionWindowSeconds: 72 * 3600,
            status: "DRAFT",
            onChainBound: false,
            createTxHash: null,
          },
        },
        clientTermsHash: termsHash,
        submittedCreateTxHash: null,
        updatedAt: new Date().toISOString(),
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/create"]}>
          <CreateDealPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const view = render(tree());
    expect(await screen.findByText("Instant Switch Seller A Draft")).toBeInTheDocument();

    // Instant account switch directly from SELLER -> BUYER (no disconnected undefined render)
    mockSessionState = { ...mockSessionState, address: BUYER, isConnected: true, isAuthenticated: true };
    view.rerender(tree());

    expect(screen.queryByText("Instant Switch Seller A Draft")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Preview On-Chain Transaction" })).toBeInTheDocument();
  });

  it("renders Dashboard Ledger Summary Strip with total deals count from totalItems and Active Escrow sum including disputed", async () => {
    listDealsMock.mockResolvedValue({
      items: [
        sampleDealSummary, // 2 AVAX (FUNDED)
        {
          ...sampleDealSummary,
          tradeId: "0x3333333333333333333333333333333333333333333333333333333333333333",
          title: "Disputed Escrow Deal",
          seller: BUYER,
          buyer: SELLER,
          status: "DISPUTED",
          amountWei: "1000000000000000000", // 1 AVAX (DISPUTED locked escrow)
        },
      ],
      page: 0,
      size: 50,
      totalItems: 12, // More deals across all pages than the 2 in current page
      totalPages: 1,
    });

    renderWithQuery(<DashboardPage />);

    const ledgerSummary = await screen.findByLabelText("Ledger summary");
    expect(within(ledgerSummary).getByText("Total Deals")).toBeInTheDocument();
    expect(within(ledgerSummary).getByText("12")).toBeInTheDocument();
    expect(within(ledgerSummary).getByText("Active Escrow")).toBeInTheDocument();
    expect(within(ledgerSummary).getByText("3 AVAX")).toBeInTheDocument();
    expect(within(ledgerSummary).getByText("Attention Required")).toBeInTheDocument();
    expect(within(ledgerSummary).getByText("1")).toBeInTheDocument();
  });

  it("renders Escrow lifecycle progress stepper with completed Resolved stage for RESOLVED deal", async () => {
    getDealMock.mockResolvedValue({
      ...sampleDealDetail,
      status: "RESOLVED",
      settled: true,
      deliveredAt: "2026-12-05T00:00:00Z",
    });
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    const stepper = await screen.findByRole("list", { name: "Escrow lifecycle progress" });
    expect(stepper).toBeInTheDocument();
    expect(within(stepper).getByText("Created")).toBeInTheDocument();
    expect(within(stepper).getByText("Funded")).toBeInTheDocument();
    expect(within(stepper).getByText("Delivered")).toBeInTheDocument();
    expect(within(stepper).getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText(/Arbitration Resolved/i)).toBeInTheDocument();
  });

  it("does not falsely report copied when navigator.clipboard.writeText rejects", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"));
    try {
      getDealMock.mockResolvedValue(sampleDealDetail);
      getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });

      renderWithQuery(
        <Routes>
          <Route path="/deals/:id" element={<DealDetailsPage />} />
        </Routes>,
        `/deals/${TRADE_ID}`
      );

      const copyTradeButton = await screen.findByRole("button", { name: "Copy Trade ID" });
      await user.click(copyTradeButton);

      expect(writeTextSpy).toHaveBeenCalledWith(TRADE_ID);
      expect(copyTradeButton).toHaveAttribute("title", "Copy Trade ID");
      expect(copyTradeButton).not.toHaveAttribute("title", "Copied");
    } finally {
      writeTextSpy.mockRestore();
    }
  });

  it("renders Escrow lifecycle progress stepper and copies Trade ID via CopyableHash on DealDetailsPage", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      getDealMock.mockResolvedValue(sampleDealDetail);
      getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });

      renderWithQuery(
        <Routes>
          <Route path="/deals/:id" element={<DealDetailsPage />} />
        </Routes>,
        `/deals/${TRADE_ID}`
      );

      const stepper = await screen.findByRole("list", { name: "Escrow lifecycle progress" });
      expect(stepper).toBeInTheDocument();
      expect(within(stepper).getByText("Created")).toBeInTheDocument();
      expect(within(stepper).getByText("Funded")).toBeInTheDocument();
      expect(within(stepper).getByText("Delivered")).toBeInTheDocument();
      expect(within(stepper).getByText("Released")).toBeInTheDocument();

      const copyTradeButton = screen.getByRole("button", { name: "Copy Trade ID" });
      await user.click(copyTradeButton);

      expect(writeTextSpy).toHaveBeenCalledWith(TRADE_ID);
      expect(copyTradeButton).toHaveAttribute("title", "Copied");
    } finally {
      writeTextSpy.mockRestore();
    }
  });

  it("updates buyer and seller allocations to 0.5 each when clicking 50 / 50 quick split preset", async () => {
    const user = userEvent.setup();
    mockSessionState.address = ARBITER;
    listAssignedDisputesMock.mockResolvedValue([sampleDispute]);

    renderWithQuery(<ArbiterPage />);

    const presetButton = await screen.findByRole("button", { name: "50 / 50" });
    await user.click(presetButton);

    const buyerInput = document.getElementById("buyer-alloc-7") as HTMLInputElement;
    const sellerInput = document.getElementById("seller-alloc-7") as HTMLInputElement;
    expect(buyerInput).toHaveValue("0.5");
    expect(sellerInput).toHaveValue("0.5");
  });

  it("renders Operational and not CREATED on SupportPage when /api/v1/health resolves cleanly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "UP",
          service: "safedeal-api",
          chainId: 31337,
          chainName: "Anvil Local",
          escrowContractConfigured: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    try {
      renderWithQuery(<SupportPage />);

      expect(await screen.findByText("Operational")).toBeInTheDocument();
      expect(screen.queryByText("CREATED")).not.toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/health"),
        expect.objectContaining({ method: "GET" })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders Degraded (Contract Unconfigured) on SupportPage when escrow contract is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "UP",
          service: "safedeal-api",
          chainId: 31337,
          chainName: "Anvil Local",
          escrowContractConfigured: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    try {
      renderWithQuery(<SupportPage />);

      expect(await screen.findByText("Degraded (Contract Unconfigured)")).toBeInTheDocument();
      expect(screen.queryByText("Operational")).not.toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("calls closeWalletModal when Escape key is pressed while WalletModal is open", async () => {
    const user = userEvent.setup();
    mockSessionState = {
      ...mockSessionState,
      walletModalOpen: true,
    };

    renderWithQuery(<WalletModal />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(mockSessionState.closeWalletModal).toHaveBeenCalledTimes(1);
  });

  it("allows Buyer on DisputePage to co-sign Arbiter's 1/3 proposal and reach 2-of-3 settlement", async () => {
    const user = userEvent.setup();
    const cosignTxHash = "0x3434343434343434343434343434343434343434343434343434343434343434" as const;
    const proposalHash = "0x5656565656565656565656565656565656565656565656565656565656565656" as const;
    const arbiterVote = {
      id: 1,
      voterAddress: ARBITER,
      voterRole: "ARBITER" as const,
      buyerAwardWei: "700000000000000000",
      sellerAwardWei: "300000000000000000",
      proposalHash,
      rationale: "70/30 refund recommended from delivery logs.",
      txHash: "0x1212121212121212121212121212121212121212121212121212121212121212",
      updatedAt: "2026-12-03T00:00:00Z",
    };

    mockSessionState.address = BUYER;
    getDisputeMock.mockResolvedValue({
      ...sampleDispute,
      votes: [arbiterVote],
    });
    listDisputeEvidenceMock.mockResolvedValue([]);
    mockExecutor.submitResolutionVote.mockResolvedValueOnce({ txHash: cosignTxHash, blockNumber: 201n });
    submitDisputeVoteMock.mockResolvedValueOnce({
      ...sampleDispute,
      status: "RESOLVED",
      buyerAwardWei: "700000000000000000",
      sellerAwardWei: "300000000000000000",
      resolveTxHash: cosignTxHash,
      resolvedAt: "2026-12-03T01:00:00Z",
      votes: [
        arbiterVote,
        {
          id: 2,
          voterAddress: BUYER,
          voterRole: "BUYER" as const,
          buyerAwardWei: "700000000000000000",
          sellerAwardWei: "300000000000000000",
          proposalHash,
          rationale: null,
          txHash: cosignTxHash,
          updatedAt: "2026-12-03T01:00:00Z",
        },
      ],
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/disputes/7"]}>
          <Routes>
            <Route path="/disputes/:id" element={<DisputePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const cosignButton = await screen.findByRole("button", { name: "Co-sign to Finalize (2/3)" });
    await user.click(cosignButton);

    expect(mockExecutor.submitResolutionVote).toHaveBeenCalledWith(
      TRADE_ID,
      700000000000000000n,
      300000000000000000n,
      expect.any(Function)
    );
    expect(submitDisputeVoteMock).toHaveBeenCalledWith(7, {
      txHash: cosignTxHash,
      rationale: "Co-signed arbiter settlement proposal.",
    });
    expect(
      await screen.findByText(new RegExp(`2-of-3 consensus reached and settled on-chain \\(${cosignTxHash}\\)`))
    ).toBeInTheDocument();
  });

  it("allows Buyer on DisputePage to trigger 50/50 timeout fallback after 14-day timeoutAt expires", async () => {
    const user = userEvent.setup();
    const timeoutTxHash = "0x7878787878787878787878787878787878787878787878787878787878787878" as const;
    mockSessionState.address = BUYER;
    getDisputeMock.mockResolvedValue({
      ...sampleDispute,
      disputedAt: "2020-01-01T00:00:00Z",
      evidenceDeadlineAt: "2020-01-08T00:00:00Z",
      timeoutAt: "2020-01-15T00:00:00Z",
      votes: [],
    });
    listDisputeEvidenceMock.mockResolvedValue([]);
    mockExecutor.resolveDisputeByTimeout.mockResolvedValueOnce({ txHash: timeoutTxHash, blockNumber: 202n });
    recordDisputeTimeoutMock.mockResolvedValueOnce({
      ...sampleDispute,
      status: "RESOLVED",
      buyerAwardWei: "500000000000000000",
      sellerAwardWei: "500000000000000000",
      resolveTxHash: timeoutTxHash,
      resolvedAt: "2026-12-03T02:00:00Z",
      votes: [],
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/disputes/7"]}>
          <Routes>
            <Route path="/disputes/:id" element={<DisputePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const timeoutButton = await screen.findByRole("button", { name: "Execute 50/50 Timeout Fallback" });
    await user.click(timeoutButton);

    expect(mockExecutor.resolveDisputeByTimeout).toHaveBeenCalledWith(TRADE_ID, expect.any(Function));
    expect(recordDisputeTimeoutMock).toHaveBeenCalledWith(7, { txHash: timeoutTxHash });
    expect(
      await screen.findByText(new RegExp(`14-day stalemate 50/50 fallback settled on-chain \\(${timeoutTxHash}\\)`))
    ).toBeInTheDocument();
  });

  it("paginates Dashboard deals when totalPages > 1 and resets page to 0 when switching filter tabs", async () => {
    const user = userEvent.setup();
    listDealsMock.mockImplementation(async (filters: { page?: number; size?: number }) => ({
      items: [
        {
          ...sampleDealSummary,
          title: `Page ${(filters.page ?? 0) + 1} Escrow Deal`,
        },
      ],
      page: filters.page ?? 0,
      size: filters.size ?? 20,
      totalItems: 25,
      totalPages: 2,
    }));

    renderWithQuery(<DashboardPage />);

    expect(await screen.findByText("Page 1 Escrow Deal")).toBeInTheDocument();
    expect(listDealsMock).toHaveBeenCalledWith({ page: 0, size: 20 });

    const nextBtn = screen.getByRole("button", { name: "Next" });
    const prevBtn = screen.getByRole("button", { name: "Previous" });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    await user.click(nextBtn);
    expect(await screen.findByText("Page 2 Escrow Deal")).toBeInTheDocument();
    expect(listDealsMock).toHaveBeenLastCalledWith({ page: 1, size: 20 });

    // Switching tabs resets page back to 0
    await user.click(screen.getByRole("tab", { name: "My Created" }));
    expect(await screen.findByText("Page 1 Escrow Deal")).toBeInTheDocument();
    expect(listDealsMock).toHaveBeenLastCalledWith({ page: 0, size: 20 });
  });

  it("populates CreateDealPage fields when clicking SEApp UIT Quick-Fill Deal Templates", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CreateDealPage />);

    const freelanceBtn = await screen.findByRole("button", { name: "Freelance Đồ án / UI-UX" });
    await user.click(freelanceBtn);

    expect(screen.getByLabelText("Deal Title")).toHaveValue(
      "Thiết kế UI/UX & Frontend Prototype Đồ án SEApp UIT"
    );
    expect(screen.getByLabelText(/Amount/)).toHaveValue("0.25");

    const laptopBtn = screen.getByRole("button", { name: "Mua bán Laptop / Giáo trình UIT" });
    await user.click(laptopBtn);

    expect(screen.getByLabelText("Deal Title")).toHaveValue(
      "Pass Laptop Sinh viên & Combo Giáo trình CNPM UIT"
    );
    expect(screen.getByLabelText(/Amount/)).toHaveValue("0.5");
  });

  it("downloads evidence attachment via authenticated button on DisputePage and surfaces errors cleanly", async () => {
    const user = userEvent.setup();
    mockSessionState.address = BUYER;
    getDisputeMock.mockResolvedValue(sampleDispute);
    listDisputeEvidenceMock.mockResolvedValue([
      {
        id: 42,
        disputeId: 7,
        submittedBy: SELLER,
        title: "Delivery Archive Log",
        notes: "Signed SHA-256 manifest.",
        fileName: "manifest.txt",
        mimeType: "text/plain",
        sizeBytes: 128,
        sha256Hex: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        hasAttachment: true,
        createdAt: "2026-12-02T01:00:00Z",
      },
    ]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "FORBIDDEN", message: "Attachment integrity check failed" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      );

    try {
      renderWithQuery(
        <Routes>
          <Route path="/disputes/:id" element={<DisputePage />} />
        </Routes>,
        "/disputes/7"
      );

      const downloadBtn = await screen.findByRole("button", { name: "manifest.txt" });
      await user.click(downloadBtn);

      expect(await screen.findByText("Attachment integrity check failed")).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/disputes/7/evidence/42/download"),
        expect.objectContaining({
          method: "GET",
          credentials: "include",
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("blocks DealDetailsPage actions on On-Chain Integrity Mismatch or Unverified On-Chain Escrow and renders 3-Way Verified badge when matched", async () => {
    const { termsHash, canonicalJson } = await computeCanonicalTermsHash({
      version: 1,
      chainId: sampleDealDetail.chainId,
      seller: sampleDealDetail.seller,
      buyer: sampleDealDetail.buyer,
      arbiter: sampleDealDetail.arbiter,
      amountWei: sampleDealDetail.amountWei,
      fundingDeadline: Math.floor(Date.parse(sampleDealDetail.fundingDeadline) / 1000),
      deliveryDeadline: Math.floor(Date.parse(sampleDealDetail.deliveryDeadline) / 1000),
      inspectionWindowSeconds: sampleDealDetail.inspectionWindowSeconds,
      title: sampleDealDetail.title,
      description: sampleDealDetail.description,
      terms: sampleDealDetail.terms,
    });
    const verifiedDeal: DealDetail = {
      ...sampleDealDetail,
      status: "FUNDED",
      termsHash,
      canonicalTermsJson: canonicalJson,
    };

    // 1) Spoofed API claims FUNDED while on-chain getTrade succeeded with status 0 (NONE)
    getDealMock.mockResolvedValue(verifiedDeal);
    getDealHistoryMock.mockResolvedValue({ events: [], transactions: [] });
    mockOnChainTrade = {
      data: { status: 0 },
      isSuccess: true,
      refetch: vi.fn(),
    };

    const view1 = renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    expect(await screen.findByText("Unverified On-Chain Escrow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Delivered" })).toBeDisabled();
    view1.unmount();

    // 2) Compromised API altered amountWei relative to on-chain getTrade
    mockOnChainTrade = {
      data: {
        status: 2,
        seller: SELLER,
        buyer: BUYER,
        arbiter: ARBITER,
        amount: 100_000_000_000_000_000n, // 0.1 AVAX on-chain vs 2.0 AVAX in API
        termsHash,
      },
      isSuccess: true,
      refetch: vi.fn(),
    };

    const view2 = renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    expect(await screen.findByText("On-Chain Integrity Mismatch — Actions Blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Delivered" })).toBeDisabled();
    view2.unmount();

    // 3) Matching Browser SHA-256 = API = On-Chain renders 3-Way Verified badge
    mockOnChainTrade = {
      data: {
        status: 2,
        seller: SELLER,
        buyer: BUYER,
        arbiter: ARBITER,
        amount: BigInt(verifiedDeal.amountWei),
        termsHash,
      },
      isSuccess: true,
      refetch: vi.fn(),
    };

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    expect(
      await screen.findByText("3-Way Verified (Browser SHA-256 = API = Avalanche Contract)")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Delivered" })).toBeEnabled();
  });

  it("renders public read-only Live On-Chain Contract Verification panel on DealDetailsPage when disconnected", async () => {
    mockSessionState = {
      ...mockSessionState,
      address: undefined,
      isConnected: false,
      isAuthenticated: false,
    };
    mockOnChainTrade = {
      data: {
        status: 2,
        seller: SELLER,
        buyer: BUYER,
        arbiter: ARBITER,
        amount: 2_000_000_000_000_000_000n,
        termsHash: sampleDealDetail.termsHash,
      },
      isSuccess: true,
      refetch: vi.fn(),
    };

    renderWithQuery(
      <Routes>
        <Route path="/deals/:id" element={<DealDetailsPage />} />
      </Routes>,
      `/deals/${TRADE_ID}`
    );

    expect(screen.getByText("Connect wallet to inspect deal")).toBeInTheDocument();
    expect(await screen.findByText("Live On-Chain Contract Verification")).toBeInTheDocument();
    expect(screen.getByText("2 AVAX")).toBeInTheDocument();
  });

  it("pre-fills CreateDealPage from extension deep-link query params, renders USD/VND sanity estimate, warns on address poisoning, and renders #privacy-policy on SupportPage", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <CreateDealPage />,
      "/create?title=Extension%20Escrow%20Draft&amountAvax=0.5&description=Captured%20from%20Chrome%20Side%20Panel&terms=Deliver%20signed%20build%20artifact"
    );

    expect(screen.getByLabelText("Deal Title")).toHaveValue("Extension Escrow Draft");
    expect(screen.getByLabelText(/Amount/)).toHaveValue("0.5");
    expect(screen.getByLabelText("Description")).toHaveValue("Captured from Chrome Side Panel");
    expect(screen.getByLabelText(/Terms & Acceptance Criteria/)).toHaveValue("Deliver signed build artifact");
    expect(screen.getByText(/\$12\.50 USD/)).toBeInTheDocument();
    expect(screen.getByText(/317,500 VNĐ/)).toBeInTheDocument();

    // Enter a vanity-poisoned arbiter sharing 4-char prefix (0xf39F) and suffix (2266) with SELLER
    const poisonedArbiter = "0xf39F000000000000000000000000000000002266";
    await user.clear(screen.getByLabelText("Arbiter Wallet Address"));
    await user.type(screen.getByLabelText("Arbiter Wallet Address"), poisonedArbiter);
    expect(await screen.findByText("Address Poisoning / Vanity Lookalike Warning")).toBeInTheDocument();

    // Verify SupportPage renders #privacy-policy anchor target
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "UP",
          service: "safedeal-api",
          chainId: 31337,
          chainName: "Anvil Local",
          escrowContractConfigured: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    try {
      const supportView = renderWithQuery(<SupportPage />, "/support#privacy-policy");
      expect(supportView.container.querySelector("#privacy-policy")).not.toBeNull();
      expect(screen.getByText(/Privacy & Non-Custodial Data Policy/i)).toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

