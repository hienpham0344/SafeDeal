import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { SeamlessHeroVideo } from "@/components/landing/SeamlessHeroVideo";
import { brandConfig } from "@/config/brand.config";
import { ROUTES } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { shortenAddress } from "@/utils/format";

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { address, isConnected, isWrongNetwork, openWalletModal } = useAuthSession();

  const walletLabel = !isConnected
    ? brandConfig.walletButtonLabel
    : isWrongNetwork
      ? "Wrong Network"
      : shortenAddress(address);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black font-geist">
      <SeamlessHeroVideo src={brandConfig.heroVideoUrl} />

      <header className="relative z-30 flex items-center justify-between px-6 py-5 md:px-12 lg:px-16">
        <div className="flex items-center gap-10">
          <Link
            to={ROUTES.home}
            className="text-lg font-semibold tracking-tight text-white sm:text-xl"
          >
            {brandConfig.name}
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
            {brandConfig.navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-sm text-white/80 hover:text-white transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center">
          <button
            type="button"
            onClick={openWalletModal}
            className="hidden md:inline-flex items-center rounded-lg bg-white px-5 py-2 text-sm font-medium text-black hover:scale-105 transition-transform"
          >
            {walletLabel}
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className="relative z-50 flex h-10 w-10 items-center justify-center text-white active:scale-90 transition-transform md:hidden"
          >
            <Menu
              size={22}
              className={`absolute transition-all duration-300 ${
                mobileMenuOpen ? "rotate-90 scale-75 opacity-0" : "rotate-0 scale-100 opacity-100"
              }`}
              aria-hidden="true"
            />
            <X
              size={22}
              className={`absolute transition-all duration-300 ${
                mobileMenuOpen ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-75 opacity-0"
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      <div
        aria-hidden={!mobileMenuOpen}
        data-testid="mobile-menu"
        className={`absolute inset-x-0 top-0 z-20 bg-black/98 backdrop-blur-xl transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] md:hidden ${
          mobileMenuOpen ? "h-screen opacity-100" : "h-0 opacity-0 pointer-events-none"
        }`}
      >
        <div
          className={`flex h-full flex-col justify-center px-8 transition-all duration-500 delay-100 ${
            mobileMenuOpen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          <nav aria-label="Mobile" className="flex flex-col gap-6">
            {brandConfig.navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className="text-3xl font-medium text-white/90 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              openWalletModal();
            }}
            className="mt-6 w-fit rounded-full bg-white px-8 py-3.5 text-base font-medium text-black hover:scale-105 transition-transform"
          >
            {walletLabel}
          </button>
        </div>
      </div>

      <main className="relative z-10 flex h-[calc(100vh-80px)] flex-col justify-between px-6 pb-10 pt-12 sm:pb-12 sm:pt-16 md:px-12 md:pb-16 md:pt-20 lg:px-16">
        <div className="max-w-3xl">
          <p className="mb-4 sm:mb-6 text-xs sm:text-sm text-white/90 animate-[fadeSlideUp_0.8s_ease_0.2s_both]">
            {brandConfig.hero.badge}
          </p>
          <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-medium leading-[1.1] tracking-tight text-white animate-[fadeSlideUp_0.8s_ease_0.4s_both]">
            {brandConfig.hero.headlineLines[0]}
            <br />
            {brandConfig.hero.headlineLines[1]}
            <br />
            {brandConfig.hero.headlineLines[2]}
          </h1>
        </div>

        <div>
          <p className="text-sm sm:text-base md:text-lg leading-relaxed text-white/60 max-w-sm sm:max-w-lg mb-5 sm:mb-6 animate-[fadeSlideUp_0.8s_ease_0.7s_both]">
            {brandConfig.hero.description}
          </p>
          <Link
            to={brandConfig.hero.ctaTo}
            className="rounded-lg bg-white px-5 py-2.5 sm:px-6 sm:py-3 text-sm font-medium text-black hover:scale-105 transition-transform inline-flex items-center gap-2 animate-[fadeSlideUp_0.8s_ease_0.9s_both]"
          >
            <span>{brandConfig.hero.ctaLabel}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}
