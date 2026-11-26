import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "@/features/authentication/components/AuthSessionProvider";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { BEARER_TOKEN_KEY } from "@/services/http/api-client";

const SELLER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;
const BUYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;

let mockWagmiAccount: {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  chainId: number;
} = {
  address: SELLER,
  isConnected: true,
  chainId: 31337,
};

const connectAsyncMock = vi.fn();
const disconnectAsyncMock = vi.fn().mockResolvedValue(undefined);
const switchChainAsyncMock = vi.fn();
const signMessageAsyncMock = vi.fn().mockResolvedValue("0xsignature");

const fetchCurrentSessionMock = vi.fn();
const requestAuthNonceMock = vi.fn();
const verifyWalletSignatureMock = vi.fn();
const logoutSessionMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      chainId: 31337,
      chainName: "Anvil Local",
    },
  };
});

vi.mock("wagmi", () => ({
  useAccount: () => mockWagmiAccount,
  useChainId: () => mockWagmiAccount.chainId,
  useConnect: () => ({ connectors: [{ id: "injected", name: "Injected" }], connectAsync: connectAsyncMock }),
  useDisconnect: () => ({ disconnectAsync: disconnectAsyncMock }),
  useSwitchChain: () => ({ switchChainAsync: switchChainAsyncMock }),
  useSignMessage: () => ({ signMessageAsync: signMessageAsyncMock }),
}));

vi.mock("@/features/authentication/api/auth-api", () => ({
  fetchCurrentSession: (...args: unknown[]) => fetchCurrentSessionMock(...args),
  requestAuthNonce: (...args: unknown[]) => requestAuthNonceMock(...args),
  verifyWalletSignature: (...args: unknown[]) => verifyWalletSignatureMock(...args),
  logoutSession: (...args: unknown[]) => logoutSessionMock(...args),
}));

function SessionProbe() {
  const { isAuthenticated, sessionUser, authError, signInWithWallet, disconnectAndSignOut, switchToExpectedNetwork } =
    useAuthSession();
  return (
    <div>
      <span data-testid="auth-state">{isAuthenticated ? sessionUser?.address : "anon"}</span>
      <span data-testid="auth-error">{authError ?? ""}</span>
      <button type="button" onClick={() => void signInWithWallet()}>
        SignIn
      </button>
      <button type="button" onClick={() => void disconnectAndSignOut()}>
        SignOut
      </button>
      <button type="button" onClick={() => void switchToExpectedNetwork()}>
        SwitchNetwork
      </button>
    </div>
  );
}

describe("AuthSessionProvider race & cache isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWagmiAccount = {
      address: SELLER,
      isConnected: true,
      chainId: 31337,
    };
  });

  it("cancels slow initial session fetch during signInWithWallet and preserves fresh SIWE session plus invalidates role queries", async () => {
    let resolveInitialSession!: (value: null) => void;
    fetchCurrentSessionMock.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveInitialSession = resolve;
        })
    );
    requestAuthNonceMock.mockResolvedValueOnce({
      nonce: "abc12345",
      message: `${window.location.host} wants you to sign in with your Ethereum account:\n${SELLER}\n\nSign in to SafeDeal.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: 31337\nNonce: abc12345\nIssued At: 2026-01-01T00:00:00Z`,
      expiresAt: "2030-01-01T00:00:00Z",
    });
    verifyWalletSignatureMock.mockResolvedValueOnce({
      address: SELLER,
      chainId: 31337,
      authenticatedAt: "2026-01-01T00:00:00Z",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionProbe />
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    expect(screen.getByTestId("auth-state")).toHaveTextContent("anon");

    await act(async () => {
      screen.getByRole("button", { name: "SignIn" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent(SELLER);
    });

    // Late resolution of initial pre-login GET /auth/me(null) MUST NOT clobber fresh session
    await act(async () => {
      resolveInitialSession(null);
      await Promise.resolve();
    });

    expect(screen.getByTestId("auth-state")).toHaveTextContent(SELLER);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["deals"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["disputes"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["arbitration"] });
  });

  it("clears stale backend session cleanly when wallet switches address and avoids wiping newer session if logout resolves late", async () => {
    fetchCurrentSessionMock.mockResolvedValue({
      address: SELLER,
      chainId: 31337,
      authenticatedAt: "2026-01-01T00:00:00Z",
    });

    let resolveMismatchLogout!: () => void;
    logoutSessionMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMismatchLogout = resolve;
        })
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionProbe />
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    const view = render(tree());
    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent(SELLER);
    });

    // Wallet changes to BUYER
    mockWagmiAccount = {
      address: BUYER,
      isConnected: true,
      chainId: 31337,
    };
    view.rerender(tree());

    await waitFor(() => {
      expect(logoutSessionMock).toHaveBeenCalledTimes(1);
    });

    // Suppose BUYER signs in before mismatch logout finishes; mismatch logout resolves afterwards
    requestAuthNonceMock.mockResolvedValueOnce({
      nonce: "buyer123",
      message: `${window.location.host} wants you to sign in with your Ethereum account:\n${BUYER}\n\nSign in to SafeDeal.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: 31337\nNonce: buyer123\nIssued At: 2026-01-01T00:01:00Z`,
      expiresAt: "2030-01-01T00:00:00Z",
    });
    verifyWalletSignatureMock.mockResolvedValueOnce({
      address: BUYER,
      chainId: 31337,
      authenticatedAt: "2026-01-01T00:01:00Z",
    });

    await act(async () => {
      screen.getByRole("button", { name: "SignIn" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent(BUYER);
    });

    await act(async () => {
      resolveMismatchLogout();
      await Promise.resolve();
    });

    expect(screen.getByTestId("auth-state")).toHaveTextContent(BUYER);
  });

  it("clears persisted drafts, pending transactions, and cached private queries on explicit disconnectAndSignOut", async () => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER.toLowerCase()}`,
      JSON.stringify({ sellerAddress: SELLER, updatedAt: new Date().toISOString() })
    );
    window.sessionStorage.setItem(
      "safedeal:pending-tx:deal-1",
      JSON.stringify({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        action: "fundTrade",
        startedAt: new Date().toISOString(),
      })
    );

    fetchCurrentSessionMock.mockResolvedValue({
      address: SELLER,
      chainId: 31337,
      authenticatedAt: "2026-01-01T00:00:00Z",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["deals", "list", {}], { items: [{ tradeId: "0x1" }] });
    queryClient.setQueryData(["disputes", "detail", "1"], { id: 1 });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionProbe />
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent(SELLER);
    });

    await act(async () => {
      screen.getByRole("button", { name: "SignOut" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent("anon");
    });

    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER.toLowerCase()}`)).toBeNull();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:deal-1")).toBeNull();
    expect(queryClient.getQueryData(["deals", "list", {}])).toBeUndefined();
    expect(queryClient.getQueryData(["disputes", "detail", "1"])).toBeUndefined();
  });

  it("clears session and cached private queries when bearer token is removed in another tab", async () => {
    fetchCurrentSessionMock.mockResolvedValue({
      address: SELLER,
      chainId: 31337,
      authenticatedAt: "2026-01-01T00:00:00Z",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["deals", "list", {}], { items: [{ tradeId: "0x1" }] });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionProbe />
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent(SELLER);
    });

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: BEARER_TOKEN_KEY,
          oldValue: "jwt-token",
          newValue: null,
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent("anon");
    });
    expect(queryClient.getQueryData(["deals", "list", {}])).toBeUndefined();
  });

  it("automatically invokes wallet_addEthereumChain and retries switchChainAsync on EIP-1193 4902 unrecognized chain error", async () => {
    fetchCurrentSessionMock.mockResolvedValue(null);
    const unrecognizedChainErr = Object.assign(new Error("Unrecognized chain ID 0x7a69"), {
      code: 4902,
    });
    switchChainAsyncMock
      .mockRejectedValueOnce(unrecognizedChainErr)
      .mockResolvedValueOnce({ id: 31337 });

    const requestMock = vi.fn().mockResolvedValue(null);
    Object.defineProperty(window, "ethereum", {
      value: { request: requestMock },
      configurable: true,
      writable: true,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionProbe />
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    await act(async () => {
      screen.getByRole("button", { name: "SwitchNetwork" }).click();
    });

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });
    expect(requestMock).toHaveBeenCalledWith({
      method: "wallet_addEthereumChain",
      params: [
        expect.objectContaining({
          chainId: "0x7a69",
          chainName: "Anvil Local",
          nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
        }),
      ],
    });
    expect(switchChainAsyncMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("auth-error")).toHaveTextContent("");
  });

  it("blocks SIWE wallet signing when challenge message domain or wallet address is spoofed", async () => {
    fetchCurrentSessionMock.mockResolvedValue(null);
    requestAuthNonceMock.mockResolvedValueOnce({
      nonce: "phishnonce1",
      message: `evil-phishing-domain.xyz wants you to sign in with your Ethereum account:\n${SELLER}\n\nURI: https://evil-phishing-domain.xyz\nVersion: 1\nChain ID: 31337\nNonce: phishnonce1`,
      expiresAt: "2030-01-01T00:00:00Z",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SessionProbe />
        </AuthSessionProvider>
      </QueryClientProvider>
    );

    await act(async () => {
      screen.getByRole("button", { name: "SignIn" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent(/SIWE anti-phishing check failed.*domain/i);
    });
    expect(signMessageAsyncMock).not.toHaveBeenCalled();

    // Now test spoofed wallet address with matching host
    requestAuthNonceMock.mockResolvedValueOnce({
      nonce: "phishnonce2",
      message: `${window.location.host} wants you to sign in with your Ethereum account:\n${BUYER}\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: 31337\nNonce: phishnonce2`,
      expiresAt: "2030-01-01T00:00:00Z",
    });

    await act(async () => {
      screen.getByRole("button", { name: "SignIn" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent(/SIWE anti-phishing check failed.*wallet/i);
    });
    expect(signMessageAsyncMock).not.toHaveBeenCalled();

    // Substring lookalike domain (evil-<host>) must also be blocked
    requestAuthNonceMock.mockResolvedValueOnce({
      nonce: "phishnonce3",
      message: `evil-${window.location.host} wants you to sign in with your Ethereum account:\n${SELLER}\n\nURI: https://evil-${window.location.host}\nVersion: 1\nChain ID: 31337\nNonce: phishnonce3`,
      expiresAt: "2030-01-01T00:00:00Z",
    });

    await act(async () => {
      screen.getByRole("button", { name: "SignIn" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent(/SIWE anti-phishing check failed.*domain/i);
    });
    expect(signMessageAsyncMock).not.toHaveBeenCalled();

    // Equivalent local loopback host (127.0.0.1:<port> <-> localhost:<port>) must be permitted for local E2E
    const currentPort = window.location.port ? `:${window.location.port}` : "";
    const alternateLoopbackHost = window.location.hostname === "127.0.0.1"
      ? `localhost${currentPort}`
      : `127.0.0.1${currentPort}`;
    requestAuthNonceMock.mockResolvedValueOnce({
      nonce: "loopbackok1",
      message: `${alternateLoopbackHost} wants you to sign in with your Ethereum account:\n${SELLER}\n\nURI: http://${alternateLoopbackHost}\nVersion: 1\nChain ID: 31337\nNonce: loopbackok1`,
      expiresAt: "2030-01-01T00:00:00Z",
    });
    verifyWalletSignatureMock.mockResolvedValueOnce({
      address: SELLER,
      chainId: 31337,
      authenticatedAt: "2026-01-01T00:02:00Z",
    });

    await act(async () => {
      screen.getByRole("button", { name: "SignIn" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-state")).toHaveTextContent(SELLER);
    });
    expect(signMessageAsyncMock).toHaveBeenCalledTimes(1);
  });
});
