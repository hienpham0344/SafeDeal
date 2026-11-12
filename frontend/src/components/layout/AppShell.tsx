import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowLeft, Menu, X } from "lucide-react";
import { brandConfig } from "@/config/brand.config";
import { env } from "@/config/env";
import { ROUTES } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { shortenAddress } from "@/utils/format";
import { AlertBanner } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";

export interface AppShellBreadcrumb {
  readonly label: string;
  readonly to: string;
}

export function AppShell({
  title,
  subtitle,
  breadcrumb,
  children,
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly breadcrumb?: AppShellBreadcrumb;
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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  const walletButtonText = !isConnected
    ? brandConfig.walletButtonLabel
    : isWrongNetwork
      ? "Wrong Network"
      : shortenAddress(address);

  return (
    <div data-surface="app" className="min-h-screen sd-app-bg text-sd-ink font-geist flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b border-sd-line bg-sd-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3.5 md:px-10">
          <div className="flex items-center gap-6 lg:gap-8">
            <Link
              to={ROUTES.home}
              className="whitespace-nowrap shrink-0 text-lg font-semibold tracking-tight text-white"
            >
              {brandConfig.name}
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-5 lg:gap-6 md:flex">
              {brandConfig.navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === ROUTES.home}
                  className={({ isActive }) =>
                    `whitespace-nowrap shrink-0 border-b-2 py-1 text-sm transition-colors ${
                      isActive
                        ? "border-sd-accent font-medium text-white"
                        : "border-transparent text-sd-inkMuted hover:text-white"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to={ROUTES.arbiter}
                className={({ isActive }) =>
                  `whitespace-nowrap shrink-0 border-b-2 py-1 text-sm transition-colors ${
                    isActive
                      ? "border-sd-accent font-medium text-white"
                      : "border-transparent text-sd-inkMuted hover:text-white"
                  }`
                }
              >
                Arbiter
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden lg:inline-flex whitespace-nowrap shrink-0 items-center gap-2 text-xs font-mono text-sd-inkMuted">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>
                {env.chainName} ({env.chainId})
              </span>
            </span>

            <button
              type="button"
              onClick={openWalletModal}
              className="hidden md:inline-flex whitespace-nowrap shrink-0 min-h-[40px] items-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#09090b] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sd-canvas"
            >
              {walletButtonText}
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-white hover:bg-white/5 md:hidden"
            >
              {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-sd-line bg-sd-canvas px-6 py-4 md:hidden">
            <nav aria-label="Mobile" className="flex flex-col gap-1.5">
              {brandConfig.navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === ROUTES.home}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex min-h-[44px] items-center rounded-lg px-3 text-base transition-colors ${
                      isActive
                        ? "border border-sd-lineStrong bg-sd-elevated font-medium text-white"
                        : "text-sd-inkMuted hover:bg-white/5 hover:text-white"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to={ROUTES.arbiter}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex min-h-[44px] items-center rounded-lg px-3 text-base transition-colors ${
                    isActive
                      ? "border border-sd-lineStrong bg-sd-elevated font-medium text-white"
                      : "text-sd-inkMuted hover:bg-white/5 hover:text-white"
                  }`
                }
              >
                Arbiter
              </NavLink>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openWalletModal();
                }}
                className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#09090b]"
              >
                {walletButtonText}
              </button>
            </nav>
          </div>
        )}
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 md:px-10 md:py-10 space-y-6"
      >
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

        {(breadcrumb || title || subtitle) && (
          <div className="border-b border-sd-line pb-6">
            {breadcrumb && (
              <Link
                to={breadcrumb.to}
                className="mb-3 inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 text-xs font-medium text-sd-inkMuted transition-colors hover:text-sd-ink"
              >
                <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>Back to {breadcrumb.label}</span>
              </Link>
            )}
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl text-balance">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-2 max-w-2xl text-sm text-sd-inkMuted sm:text-base">{subtitle}</p>
            )}
          </div>
        )}

        {children}
      </main>

      <footer className="border-t border-sd-line bg-sd-canvas/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-xs text-sd-inkMuted sm:flex-row sm:items-center sm:justify-between md:px-10">
          <p className="text-sd-inkSubtle">
            <span className="font-medium text-sd-ink">{brandConfig.name}</span> — Non-custodial on-chain
            escrow. Funds remain locked in smart contracts until release, refund, or arbitration.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-4">
            <Link
              to={ROUTES.home}
              className="inline-flex min-h-[44px] items-center text-sd-inkMuted transition-colors hover:text-sd-ink sm:min-h-0"
            >
              Home
            </Link>
            <Link
              to={ROUTES.howItWorks}
              className="inline-flex min-h-[44px] items-center text-sd-inkMuted transition-colors hover:text-sd-ink sm:min-h-0"
            >
              How It Works
            </Link>
            <Link
              to={ROUTES.support}
              className="inline-flex min-h-[44px] items-center text-sd-inkMuted transition-colors hover:text-sd-ink sm:min-h-0"
            >
              Support
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
