import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "@/features/authentication/components/AuthSessionProvider";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";

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
  const { isAuthenticated, sessionUser, signInWithWallet, disconnectAndSignOut } = useAuthSession();
  return (
    <div>
      <span data-testid="auth-state">{isAuthenticated ? sessionUser?.address : "anon"}</span>
      <button type="button" onClick={() => void signInWithWallet()}>
        SignIn
      </button>
      <button type="button" onClick={() => void disconnectAndSignOut()}>
        SignOut
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
      message: "localhost wants you to sign in",
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
      message: "sign in buyer",
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
});
