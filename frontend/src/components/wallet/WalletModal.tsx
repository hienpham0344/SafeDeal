import { X, Wallet, ShieldCheck, AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { env } from "@/config/env";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { shortenAddress } from "@/utils/format";
import { Button } from "@/components/ui/Button";

export function WalletModal() {
  const {
    address,
    isConnected,
    walletChainId,
    expectedChainId,
    isWrongNetwork,
    isAuthenticated,
    isAuthenticating,
    authError,
    walletModalOpen,
    closeWalletModal,
    connectInjectedWallet,
    signInWithWallet,
    switchToExpectedNetwork,
    disconnectAndSignOut,
  } = useAuthSession();

  if (!walletModalOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm font-geist"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-neutral-950 p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <Wallet size={18} aria-hidden="true" />
            <h2 id="wallet-modal-title" className="text-base font-medium">
              Wallet & Session
            </h2>
          </div>
          <button
            type="button"
            onClick={closeWalletModal}
            aria-label="Close wallet dialog"
            className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm">
          <div className="rounded-xl border border-white/10 bg-black p-4">
            <p className="text-xs uppercase tracking-wider text-white/50">Active Target Network</p>
            <p className="mt-1 font-medium text-white">
              {env.chainName} (Chain ID {expectedChainId})
            </p>
          </div>

          {!isConnected ? (
            <div className="space-y-3">
              <p className="text-white/70">
                Connect an injected EVM wallet (MetaMask, Core, Rabby) to create, fund, or arbitrate escrow deals.
              </p>
              <Button onClick={() => void connectInjectedWallet()} className="w-full" size="lg">
                Connect Injected Wallet
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-black p-4 space-y-1">
                <p className="text-xs text-white/50">Connected Wallet</p>
                <p className="font-mono text-sm text-white">{shortenAddress(address, 6)}</p>
                <p className="text-xs text-white/50">
                  Wallet Chain ID: {walletChainId ?? "Unknown"}
                </p>
              </div>

              {isWrongNetwork && (
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-amber-100">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <div className="space-y-2">
                      <p className="font-medium">Wrong Network Connected</p>
                      <p className="text-xs opacity-90">
                        Please switch to {env.chainName} ({expectedChainId}) before signing or sending transactions.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void switchToExpectedNetwork()}
                      >
                        <RefreshCw size={14} />
                        Switch to {env.chainName}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!isWrongNetwork && (
                <div className="rounded-xl border border-white/10 bg-black p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/50">Backend Session (SIWE)</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                        {isAuthenticated ? (
                          <>
                            <ShieldCheck size={15} className="text-emerald-300" />
                            <span>Authenticated</span>
                          </>
                        ) : (
                          <span className="text-white/75">Signature Required</span>
                        )}
                      </p>
                    </div>
                    {!isAuthenticated && (
                      <Button
                        size="sm"
                        disabled={isAuthenticating}
                        onClick={() => void signInWithWallet()}
                      >
                        {isAuthenticating ? "Signing..." : "Sign In"}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <Button
                variant="secondary"
                onClick={() => void disconnectAndSignOut()}
                className="w-full"
              >
                <LogOut size={15} />
                Disconnect & Sign Out
              </Button>
            </div>
          )}

          {authError && (
            <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              {authError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
