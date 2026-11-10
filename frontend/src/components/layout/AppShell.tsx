import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { brandConfig } from "@/config/brand.config";
import { env } from "@/config/env";
import { ROUTES } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { shortenAddress } from "@/utils/format";
import { AlertBanner } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";

export function AppShell({
  title,
  subtitle,
  children,
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const {
    address,
    isConnected,
    isWrongNetwork,
    isAuthenticated,
    isAuthenticating,
    openWalletModal,
    signInWithWallet,
    switchToExpectedNetwork,
  } = useAuthSession();

  const walletButtonText = !isConnected
    ? brandConfig.walletButtonLabel
    : isWrongNetwork
      ? "Wrong Network"
      : shortenAddress(address);

  return (
    <div className="min-h-screen bg-black text-white font-geist">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-8">
            <Link to={ROUTES.home} className="text-lg font-semibold tracking-tight text-white">
              {brandConfig.name}
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
              {brandConfig.navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `text-sm transition-colors ${isActive ? "text-white font-medium" : "text-white/70 hover:text-white"}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to={ROUTES.arbiter}
                className={({ isActive }) =>
                  `text-sm transition-colors ${isActive ? "text-white font-medium" : "text-white/70 hover:text-white"}`
                }
              >
                Arbiter
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center rounded-full border border-white/15 px-3 py-1 text-xs text-white/70">
              {env.chainName} ({env.chainId})
            </span>

            <button
              type="button"
              onClick={openWalletModal}
              className="hidden md:inline-flex items-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:scale-105 transition-transform"
            >
              {walletButtonText}
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="flex h-10 w-10 items-center justify-center text-white md:hidden"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-white/10 bg-black px-6 py-4 md:hidden">
            <nav aria-label="Mobile" className="flex flex-col gap-3">
              {brandConfig.navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-base text-white/85 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                to={ROUTES.arbiter}
                onClick={() => setMobileMenuOpen(false)}
                className="text-base text-white/85 hover:text-white"
              >
                Arbiter
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openWalletModal();
                }}
                className="mt-2 w-fit rounded-lg bg-white px-5 py-2 text-sm font-medium text-black"
              >
                {walletButtonText}
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 space-y-6">
        {env.configErrors.length > 0 && (
          <AlertBanner
            tone="error"
            title="Configuration Warning"
            message={env.configErrors.join(" • ")}
          />
        )}

        {isWrongNetwork && (
          <AlertBanner
            tone="warning"
            title="Wrong Network"
            message={`Your wallet is connected to an unsupported network. Switch to ${env.chainName} (Chain ID ${env.chainId}).`}
            action={
              <Button size="sm" onClick={() => void switchToExpectedNetwork()}>
                Switch Network
              </Button>
            }
          />
        )}

        {isConnected && !isWrongNetwork && !isAuthenticated && (
          <AlertBanner
            tone="info"
            title="Wallet Authentication Required"
            message="Sign a one-time SIWE challenge to synchronize drafts, deal history, and dispute evidence with the backend."
            action={
              <Button size="sm" disabled={isAuthenticating} onClick={() => void signInWithWallet()}>
                {isAuthenticating ? "Signing..." : "Sign In"}
              </Button>
            }
          />
        )}

        {(title || subtitle) && (
          <div className="border-b border-white/10 pb-6">
            {title && <h1 className="text-2xl font-medium tracking-tight text-white sm:text-3xl">{title}</h1>}
            {subtitle && <p className="mt-2 text-sm text-white/60 sm:text-base">{subtitle}</p>}
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
