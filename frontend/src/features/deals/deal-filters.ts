import type { DealSummary } from "@/types/api";

export type DashboardTab = "ALL" | "CREATED" | "FUNDED" | "ACTIVE" | "COMPLETED" | "DISPUTED";

export const DASHBOARD_TABS: { id: DashboardTab; label: string }[] = [
  { id: "ALL", label: "All Deals" },
  { id: "CREATED", label: "My Created" },
  { id: "FUNDED", label: "My Funded" },
  { id: "ACTIVE", label: "Active" },
  { id: "COMPLETED", label: "Completed" },
  { id: "DISPUTED", label: "Disputed" },
];

export function filterDealsForTab(
  deals: readonly DealSummary[],
  tab: DashboardTab,
  walletAddress: string | undefined
): readonly DealSummary[] {
  const me = walletAddress?.toLowerCase();
  switch (tab) {
    case "CREATED":
      return deals.filter((d) => me && d.seller.toLowerCase() === me);
    case "FUNDED":
      return deals.filter(
        (d) => me && d.buyer?.toLowerCase() === me && d.status !== "CREATED" && d.status !== "DRAFT"
      );
    case "ACTIVE":
      return deals.filter(
        (d) => d.status === "CREATED" || d.status === "FUNDED" || d.status === "DELIVERED"
      );
    case "COMPLETED":
      return deals.filter(
        (d) =>
          d.status === "RELEASED" ||
          d.status === "REFUNDED" ||
          d.status === "RESOLVED" ||
          d.status === "CANCELLED"
      );
    case "DISPUTED":
      return deals.filter((d) => d.status === "DISPUTED");
    default:
      return deals;
  }
}
