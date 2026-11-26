import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Connector, useAccount, useChainId, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { env } from "@/config/env";
import { BEARER_TOKEN_KEY, setUnauthorizedHandler } from "@/services/http/api-client";
import {
  fetchCurrentSession,
  logoutSession,
  requestAuthNonce,
  verifyWalletSignature,
} from "@/features/authentication/api/auth-api";
import {
  AuthSessionContext,
  type AuthSessionContextValue,
} from "@/features/authentication/hooks/useAuthSession";
import { clearAllPersistedCreateDrafts } from "@/features/deals/hooks/useCreateDraftPersistence";
import { clearAllPendingTxs } from "@/features/deals/hooks/usePendingTransactions";
import type { AuthSessionUser } from "@/types/api";

interface Eip1193Provider {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
}

function getInjectedEthereumProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { ethereum?: unknown }).ethereum;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "request" in candidate &&
    typeof (candidate as { request?: unknown }).request === "function"
  ) {
    return candidate as Eip1193Provider;
  }
  return null;
}

function isUnrecognizedChainError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const errObj = error as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown; cause?: { code?: unknown } };
    data?: { originalError?: { code?: unknown } };
  };
  if (
    errObj.code === 4902 ||
    errObj.cause?.code === 4902 ||
    errObj.cause?.cause?.code === 4902 ||
    errObj.data?.originalError?.code === 4902
  ) {
    return true;
  }
  const message =
    typeof errObj.message === "string"
      ? errObj.message
      : typeof errObj.cause?.message === "string"
        ? errObj.cause.message
        : "";
  return (
    message.includes("4902") ||
    /unrecognized chain/i.test(message) ||
    message.includes("wallet_addEthereumChain")
  );
}

const SIWE_HEADER_SUFFIX = " wants you to sign in with your ethereum account:";

function splitHostAndPort(rawHost: string): { readonly hostname: string; readonly port: string } {
  const trimmed = rawHost.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket !== -1) {
      const hostname = trimmed.slice(0, closingBracket + 1);
      const rest = trimmed.slice(closingBracket + 1);
      const port = rest.startsWith(":") ? rest.slice(1) : "";
      return { hostname, port };
    }
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon !== -1 && trimmed.indexOf(":") === lastColon) {
    return {
      hostname: trimmed.slice(0, lastColon),
      port: trimmed.slice(lastColon + 1),
    };
  }
  return { hostname: trimmed, port: "" };
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function isEquivalentOriginHost(challengeHost: string, browserHost: string): boolean {
  const normalizedChallenge = challengeHost.trim().toLowerCase();
  const normalizedBrowser = browserHost.trim().toLowerCase();
  if (!normalizedBrowser) return true;
  if (normalizedChallenge === normalizedBrowser) return true;

  const challengeParts = splitHostAndPort(normalizedChallenge);
  const browserParts = splitHostAndPort(normalizedBrowser);
  return (
    isLoopbackHostname(challengeParts.hostname) &&
    isLoopbackHostname(browserParts.hostname) &&
    challengeParts.port === browserParts.port
  );
}

function verifySiweChallengeMessage(
  message: string,
  expectedHost: string,
  expectedAddress: string
): void {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const headerLine = (lines[0] ?? "").trim();
  const headerLower = headerLine.toLowerCase();
  const challengeDomain = headerLower.endsWith(SIWE_HEADER_SUFFIX)
    ? headerLine.slice(0, headerLine.length - SIWE_HEADER_SUFFIX.length).trim()
    : "";

  if (expectedHost && (!challengeDomain || !isEquivalentOriginHost(challengeDomain, expectedHost))) {
    throw new Error(
      `SIWE anti-phishing check failed: challenge domain does not match ${expectedHost}.`
    );
  }

  const challengeAddress = (lines[1] ?? "").trim().toLowerCase();
  if (!challengeAddress || challengeAddress !== expectedAddress.trim().toLowerCase()) {
    throw new Error(
      "SIWE anti-phishing check failed: challenge wallet address does not match connected wallet."
    );
  }
}

export function AuthSessionProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const {
    address,
    isConnected,
    isReconnecting,
    chainId: accountChainId,
    connector: activeConnector,
  } = useAccount();
  const wagmiChainId = useChainId();
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const walletChainId = accountChainId ?? wagmiChainId;
  const isWrongNetwork = Boolean(isConnected && walletChainId && walletChainId !== env.chainId);

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchCurrentSession,
    staleTime: 30_000,
    retry: false,
  });

  const sessionUser = sessionQuery.data ?? null;
  const isAuthenticated = Boolean(
    isConnected &&
      address &&
      sessionUser &&
      sessionUser.address.toLowerCase() === address.toLowerCase()
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(["auth", "session"], null);
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [queryClient]);

  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key !== BEARER_TOKEN_KEY && event.key !== null) {
        return;
      }
      if (!event.newValue) {
        queryClient.setQueryData(["auth", "session"], null);
        queryClient.removeQueries({ queryKey: ["deals"] });
        queryClient.removeQueries({ queryKey: ["disputes"] });
        queryClient.removeQueries({ queryKey: ["arbitration"] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
      }
    }

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [queryClient]);

  // If the connected wallet changes to a different address than the backend session, clear stale session cleanly
  useEffect(() => {
    if (
      isAuthenticating ||
      !isConnected ||
      !address ||
      !sessionUser ||
      sessionUser.address.toLowerCase() === address.toLowerCase()
    ) {
      return;
    }
    let cancelled = false;
    const mismatchedAddress = sessionUser.address.toLowerCase();
    void logoutSession()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        queryClient.setQueryData<AuthSessionUser | null>(["auth", "session"], (current) =>
          current && current.address.toLowerCase() === mismatchedAddress ? null : current
        );
        queryClient.removeQueries({ queryKey: ["deals"] });
        queryClient.removeQueries({ queryKey: ["disputes"] });
        queryClient.removeQueries({ queryKey: ["arbitration"] });
      });
    return () => {
      cancelled = true;
    };
  }, [address, isAuthenticating, isConnected, queryClient, sessionUser]);

  // Clear stale persisted wagmi connections that failed to rehydrate a live connector instance
  useEffect(() => {
    if (
      !isConnected ||
      isReconnecting ||
      !activeConnector ||
      typeof (activeConnector as { getChainId?: unknown }).getChainId === "function"
    ) {
      return;
    }
    void disconnectAsync().catch(() => undefined);
  }, [activeConnector, disconnectAsync, isConnected, isReconnecting]);

  const connectInjectedWallet = useCallback(async () => {
    setAuthError(null);
    const connector = connectors[0];
    if (!connector) {
      setAuthError("No injected Web3 wallet detected. Install MetaMask or Core Wallet.");
      return;
    }
    try {
      await connectAsync({ connector });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Wallet connection rejected.");
    }
  }, [connectAsync, connectors]);

  const switchToExpectedNetwork = useCallback(async () => {
    setAuthError(null);
    try {
      await switchChainAsync({ chainId: env.chainId });
    } catch (error) {
      const ethereum = getInjectedEthereumProvider();
      if (isUnrecognizedChainError(error) && ethereum) {
        try {
          const envWithAliases = env as typeof env & {
            readonly avalancheRpcUrl?: string;
            readonly blockExplorerBaseUrl?: string;
          };
          const rpcTarget = envWithAliases.avalancheRpcUrl ?? env.rpcUrl;
          const explorerTarget = envWithAliases.blockExplorerBaseUrl ?? env.explorerBaseUrl;
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${env.chainId.toString(16)}`,
                chainName: env.chainName,
                nativeCurrency: {
                  name: "Avalanche",
                  symbol: "AVAX",
                  decimals: 18,
                },
                rpcUrls: [rpcTarget],
                blockExplorerUrls: explorerTarget ? [explorerTarget] : undefined,
              },
            ],
          });
          await switchChainAsync({ chainId: env.chainId });
          return;
        } catch (addError) {
          setAuthError(
            addError instanceof Error
              ? addError.message
              : `Failed to switch to ${env.chainName} (${env.chainId}).`
          );
          return;
        }
      }
      setAuthError(
        error instanceof Error
          ? error.message
          : `Failed to switch to ${env.chainName} (${env.chainId}).`
      );
    }
  }, [switchChainAsync]);

  const signInWithWallet = useCallback(async (): Promise<AuthSessionUser | null> => {
    if (!address || !isConnected) {
      setAuthError("Connect a wallet first.");
      return null;
    }
    if (isWrongNetwork) {
      setAuthError(`Switch network to ${env.chainName} (Chain ID ${env.chainId}) first.`);
      return null;
    }
    setAuthError(null);
    setIsAuthenticating(true);
    try {
      await queryClient.cancelQueries({ queryKey: ["auth", "session"] });
      const challenge = await requestAuthNonce(address, env.chainId);
      const expectedHost = typeof window !== "undefined" ? window.location.host : "";
      verifySiweChallengeMessage(challenge.message, expectedHost, address);
      const isLiveActiveConnector =
        activeConnector && typeof (activeConnector as { getChainId?: unknown }).getChainId === "function";
      let overrideConnector: Connector | undefined;
      if (activeConnector && !isLiveActiveConnector) {
        const meta = activeConnector as { uid?: string; id?: string };
        overrideConnector =
          connectors.find(
            (c) =>
              typeof (c as { getChainId?: unknown }).getChainId === "function" &&
              ((meta.uid && c.uid === meta.uid) || (meta.id && c.id === meta.id))
          ) ?? connectors.find((c) => typeof (c as { getChainId?: unknown }).getChainId === "function");
      }
      const signature = await signMessageAsync({
        message: challenge.message,
        ...(overrideConnector ? { connector: overrideConnector } : {}),
      });
      const user = await verifyWalletSignature(challenge.message, signature);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["deals"] }),
        queryClient.invalidateQueries({ queryKey: ["disputes"] }),
        queryClient.invalidateQueries({ queryKey: ["arbitration"] }),
      ]);
      queryClient.setQueryData(["auth", "session"], user);
      setWalletModalOpen(false);
      return user;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Wallet sign-in failed.");
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, [activeConnector, address, connectors, isConnected, isWrongNetwork, queryClient, signMessageAsync]);

  const disconnectAndSignOut = useCallback(async () => {
    setAuthError(null);
    await queryClient.cancelQueries({ queryKey: ["auth", "session"] });
    try {
      await logoutSession();
    } catch {
      // Ensure local session & wallet state are still cleared if server logout fails
    }
    queryClient.setQueryData(["auth", "session"], null);
    clearAllPersistedCreateDrafts();
    clearAllPendingTxs();
    queryClient.removeQueries({ queryKey: ["deals"] });
    queryClient.removeQueries({ queryKey: ["disputes"] });
    queryClient.removeQueries({ queryKey: ["arbitration"] });
    await disconnectAsync().catch(() => undefined);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["deals"] }),
      queryClient.invalidateQueries({ queryKey: ["disputes"] }),
      queryClient.invalidateQueries({ queryKey: ["arbitration"] }),
    ]);
  }, [disconnectAsync, queryClient]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      address,
      isConnected,
      walletChainId,
      expectedChainId: env.chainId,
      isWrongNetwork,
      sessionUser,
      isAuthenticated,
      isAuthenticating,
      isSessionLoading: sessionQuery.isLoading,
      authError,
      walletModalOpen,
      openWalletModal: () => {
        setAuthError(null);
        setWalletModalOpen(true);
      },
      closeWalletModal: () => {
        setAuthError(null);
        setWalletModalOpen(false);
      },
      connectInjectedWallet,
      signInWithWallet,
      switchToExpectedNetwork,
      disconnectAndSignOut,
      clearAuthError: () => setAuthError(null),
    }),
    [
      address,
      authError,
      connectInjectedWallet,
      disconnectAndSignOut,
      isAuthenticated,
      isAuthenticating,
      isConnected,
      isWrongNetwork,
      sessionQuery.isLoading,
      sessionUser,
      signInWithWallet,
      switchToExpectedNetwork,
      walletChainId,
      walletModalOpen,
    ]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}
