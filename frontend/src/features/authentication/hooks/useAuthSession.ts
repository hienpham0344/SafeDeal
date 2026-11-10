import { createContext, useContext } from "react";
import type { AuthSessionUser } from "@/types/api";

export interface AuthSessionContextValue {
  readonly address: `0x${string}` | undefined;
  readonly isConnected: boolean;
  readonly walletChainId: number | undefined;
  readonly expectedChainId: number;
  readonly isWrongNetwork: boolean;
  readonly sessionUser: AuthSessionUser | null;
  readonly isAuthenticated: boolean;
  readonly isAuthenticating: boolean;
  readonly isSessionLoading: boolean;
  readonly authError: string | null;
  readonly walletModalOpen: boolean;
  readonly openWalletModal: () => void;
  readonly closeWalletModal: () => void;
  readonly connectInjectedWallet: () => Promise<void>;
  readonly signInWithWallet: () => Promise<AuthSessionUser | null>;
  readonly switchToExpectedNetwork: () => Promise<void>;
  readonly disconnectAndSignOut: () => Promise<void>;
  readonly clearAuthError: () => void;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function useAuthSession(): AuthSessionContextValue {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return ctx;
}
