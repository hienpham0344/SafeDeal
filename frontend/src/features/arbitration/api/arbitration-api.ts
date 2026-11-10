import { z } from "zod";
import { parseEther } from "viem";
import { apiRequest } from "@/services/http/api-client";
import type { DisputeDetail } from "@/types/api";

export const resolveDisputeSchema = z.object({
  buyerAmountAvax: z.string().trim().min(1, "Enter buyer allocation"),
  sellerAmountAvax: z.string().trim().min(1, "Enter seller allocation"),
  rationale: z.string().trim().min(10, "Provide a clear arbitration rationale").max(4000),
});

export type ResolveDisputeFormValues = z.infer<typeof resolveDisputeSchema>;

export function validateSplitAllocation(
  buyerAvax: string,
  sellerAvax: string,
  totalWeiString: string
): { buyerWei: bigint; sellerWei: bigint } | { error: string } {
  try {
    if (!/^\d+(\.\d{1,18})?$/.test(buyerAvax.trim()) || !/^\d+(\.\d{1,18})?$/.test(sellerAvax.trim())) {
      return { error: "Amounts must be non-negative AVAX decimals (up to 18 decimal places)." };
    }
    const buyerWei = parseEther(buyerAvax.trim());
    const sellerWei = parseEther(sellerAvax.trim());
    const totalWei = BigInt(totalWeiString);
    if (buyerWei + sellerWei !== totalWei) {
      return { error: "Buyer and seller allocations must sum exactly to the locked escrow amount." };
    }
    return { buyerWei, sellerWei };
  } catch {
    return { error: "Invalid AVAX allocation amount." };
  }
}

export async function listAssignedDisputes(): Promise<readonly DisputeDetail[]> {
  return apiRequest<readonly DisputeDetail[]>("/api/v1/arbitration/disputes");
}

export async function recordArbitrationResolution(
  disputeId: number,
  payload: { txHash: `0x${string}`; rationale: string }
): Promise<DisputeDetail> {
  return apiRequest<DisputeDetail>(`/api/v1/arbitration/disputes/${disputeId}/resolution`, {
    method: "POST",
    body: payload,
  });
}
