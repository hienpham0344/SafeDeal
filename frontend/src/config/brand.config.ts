import { env } from "./env";
import { ROUTES } from "./routes";

export interface NavItem {
  readonly label: string;
  readonly to: string;
}

export const brandConfig = {
  name: env.appName,
  heroVideoUrl: env.heroVideoUrl,
  navItems: [
    { label: "Home", to: ROUTES.home },
    { label: "How It Works", to: ROUTES.howItWorks },
    { label: "My Deals", to: ROUTES.dashboard },
    { label: "Support", to: ROUTES.support },
  ] satisfies readonly NavItem[],
  walletButtonLabel: "Connect Wallet",
  hero: {
    badge: "Secure P2P Transactions",
    headlineLines: ["Trade with trust,", "not with", "blind faith."] as const,
    description:
      "Secure every deal with on-chain escrow. Your funds stay protected until the agreed conditions are met.",
    ctaLabel: "Create a Deal",
    ctaTo: ROUTES.create,
  },
} as const;
