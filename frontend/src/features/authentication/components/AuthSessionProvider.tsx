import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { env } from "@/config/env";
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
import type { AuthSessionUser } from "@/types/api";

export function AuthSessionProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const { address, isConnected, chainId: accountChainId } = useAccount();
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
    void logoutSession().then(() => {
      if (cancelled) return;
      queryClient.setQueryData<AuthSessionUser | null>(["auth", "session"], (current) =>
        current && current.address.toLowerCase() === mismatchedAddress ? null : current
      );
    });
    return () => {
      cancelled = true;
    };
  }, [address, isAuthenticating, isConnected, queryClient, sessionUser]);

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
      const signature = await signMessageAsync({ message: challenge.message });
      const user = await verifyWalletSignature(challenge.message, signature);
      queryClient.setQueryData(["auth", "session"], user);
      setWalletModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["deals"] }),
        queryClient.invalidateQueries({ queryKey: ["disputes"] }),
        queryClient.invalidateQueries({ queryKey: ["arbitration"] }),
      ]);
      return user;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Wallet sign-in failed.");
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, isConnected, isWrongNetwork, queryClient, signMessageAsync]);

  const disconnectAndSignOut = useCallback(async () => {
    setAuthError(null);
    await queryClient.cancelQueries({ queryKey: ["auth", "session"] });
    await logoutSession();
    queryClient.setQueryData(["auth", "session"], null);
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
      openWalletModal: () => setWalletModalOpen(true),
      closeWalletModal: () => setWalletModalOpen(false),
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
