export const ROUTES = {
  home: "/",
  howItWorks: "/how-it-works",
  support: "/support",
  create: "/create",
  dealDetails: "/deals/:id",
  dashboard: "/dashboard",
  disputeDetails: "/disputes/:id",
  arbiter: "/arbiter",
} as const;

export function dealPath(tradeId: string): string {
  return `/deals/${encodeURIComponent(tradeId)}`;
}

export function disputePath(disputeId: string): string {
  return `/disputes/${encodeURIComponent(disputeId)}`;
}
