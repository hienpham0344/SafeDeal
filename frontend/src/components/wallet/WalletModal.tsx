import { useEffect, useRef } from "react";
import { X, Wallet, ShieldCheck, AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { env } from "@/config/env";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { shortenAddress } from "@/utils/format";
import { Button } from "@/components/ui/Button";
import { CopyableHash } from "@/components/ui/CopyableHash";

export function WalletModal() {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!walletModalOpen) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeWalletModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [walletModalOpen, closeWalletModal]);

  if (!walletModalOpen) return null;

  return (
    <div
      data-surface="app"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm font-geist"
    >
      <div className="w-full max-w-md rounded-2xl border border-sd-lineStrong bg-sd-surface p-6 text-sd-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-sd-line pb-4">
          <div className="flex items-center gap-2">
            <Wallet size={18} strokeWidth={1.75} className="text-sd-inkMuted" aria-hidden="true" />
            <h2 id="wallet-modal-title" className="text-base font-medium text-white">
              Wallet & Session
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeWalletModal}
            aria-label="Close wallet dialog"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sd-inkMuted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sd-surface"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm">
          <div className="rounded-xl border border-sd-line bg-sd-inset p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
              Active Target Network
            </p>
            <p className="mt-1 flex items-center gap-2 font-medium text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>
                {env.chainName} (Chain ID {expectedChainId})
              </span>
            </p>
          </div>

          {!isConnected ? (
            <div className="space-y-3">
              <p className="text-sd-inkMuted">
                Connect an injected EVM wallet (MetaMask, Core, Rabby) to create, fund, or arbitrate escrow deals.
              </p>
              <Button onClick={() => void connectInjectedWallet()} className="w-full" size="lg">
                Connect Injected Wallet
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-sd-line bg-sd-inset p-4 space-y-1.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                  Connected Wallet
                </p>
                {address ? (
                  <CopyableHash
                    value={address}
                    displayValue={shortenAddress(address, 6)}
                    label="wallet address"
                    className="text-sm"
                  />
                ) : (
                  <p className="font-mono text-sm text-sd-ink">{shortenAddress(address, 6)}</p>
                )}
                <p className="font-mono text-xs text-sd-inkMuted">
                  Wallet Chain ID: {walletChainId ?? "Unknown"}
                </p>
              </div>

              {isWrongNetwork && (
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-amber-100">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
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
                        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                        Switch to {env.chainName}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!isWrongNetwork && (
                <div className="rounded-xl border border-sd-line bg-sd-inset p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                        Backend Session (SIWE)
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                        {isAuthenticated ? (
                          <>
                            <ShieldCheck size={15} strokeWidth={1.75} className="text-emerald-300" aria-hidden="true" />
                            <span className="text-white">Authenticated</span>
                          </>
                        ) : (
                          <span className="text-sd-inkMuted">Signature Required</span>
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
                <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
                Disconnect & Sign Out
              </Button>
            </div>
          )}

          {authError && (
            <p role="alert" className="rounded-lg border border-red-400/35 bg-red-500/10 p-3 text-xs text-red-200">
              {authError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
