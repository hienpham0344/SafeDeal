import { describe, expect, it } from "vitest";
import { loadFrontendEnv } from "@/config/env";
import { validateSplitAllocation } from "@/features/arbitration/api/arbitration-api";
import { createDealSchema } from "@/features/deals/schemas/create-deal.schema";
import { validateEvidenceFile } from "@/features/disputes/schemas/dispute.schema";
import { ApiClientError, shouldRetryQueryError } from "@/services/http/api-client";
import { formatAvax, parseAvaxToWei, shortenAddress } from "@/utils/format";

describe("format and validation schemas", () => {
  it("rejects zero addresses in optional frontend env address variables", () => {
    const zero = "0x0000000000000000000000000000000000000000";
    const parsed = loadFrontendEnv({
      VITE_ESCROW_CONTRACT_ADDRESS: zero,
      VITE_DEFAULT_ARBITER_ADDRESS: zero,
    });
    expect(parsed.escrowContractAddress).toBeUndefined();
    expect(parsed.defaultArbiterAddress).toBeUndefined();
    expect(parsed.configErrors).toContain("VITE_ESCROW_CONTRACT_ADDRESS cannot be the zero address");
    expect(parsed.configErrors).toContain("VITE_DEFAULT_ARBITER_ADDRESS cannot be the zero address");
  });

  it("parses exact AVAX strings into wei without floating-point inaccuracy", () => {
    expect(parseAvaxToWei("0.1")).toBe(100000000000000000n);
    expect(parseAvaxToWei("1.234567890123456789")).toBe(1234567890123456789n);
    expect(parseAvaxToWei("0")).toBeNull();
    expect(parseAvaxToWei("-1")).toBeNull();
    expect(parseAvaxToWei("1e18")).toBeNull();
  });

  it("formats wei and shortens addresses safely", () => {
    expect(formatAvax("500000000000000000")).toBe("0.5 AVAX");
    expect(shortenAddress(null)).toContain("Open");
    expect(shortenAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe("0xf39F...2266");
  });

  it("validates arbiter split allocations strictly equal to locked escrow wei", () => {
    const ok = validateSplitAllocation("0.25", "0.75", "1000000000000000000");
    expect(ok).toEqual({
      buyerWei: 250000000000000000n,
      sellerWei: 750000000000000000n,
    });

    const mismatch = validateSplitAllocation("0.3", "0.75", "1000000000000000000");
    expect("error" in mismatch).toBe(true);

    const neg = validateSplitAllocation("-0.5", "1.5", "1000000000000000000");
    expect("error" in neg).toBe(true);
  });

  it("validates create deal schema deadline order, title length cap (160), and non-zero address separation", () => {
    const future1 = new Date(Date.now() + 3600_000).toISOString();
    const future2 = new Date(Date.now() + 7200_000).toISOString();
    const zero = "0x0000000000000000000000000000000000000000";

    const valid160 = createDealSchema.safeParse({
      title: "A".repeat(160),
      description: "Valid deal description longer than ten chars",
      amountAvax: "1.5",
      buyerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      arbiterAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      fundingDeadline: future1,
      deliveryDeadline: future2,
      inspectionHours: 24,
      terms: "Goods delivered in original sealed packaging",
    });
    expect(valid160.success).toBe(true);

    const over160 = createDealSchema.safeParse({
      title: "A".repeat(161),
      description: "Valid deal description longer than ten chars",
      amountAvax: "1.5",
      buyerAddress: "",
      arbiterAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      fundingDeadline: future1,
      deliveryDeadline: future2,
      inspectionHours: 24,
      terms: "Goods delivered in original sealed packaging",
    });
    expect(over160.success).toBe(false);

    const zeroBuyer = createDealSchema.safeParse({
      title: "Valid Deal Title",
      description: "Valid deal description longer than ten chars",
      amountAvax: "1.5",
      buyerAddress: zero,
      arbiterAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      fundingDeadline: future1,
      deliveryDeadline: future2,
      inspectionHours: 24,
      terms: "Goods delivered in original sealed packaging",
    });
    expect(zeroBuyer.success).toBe(false);

    const zeroArbiter = createDealSchema.safeParse({
      title: "Valid Deal Title",
      description: "Valid deal description longer than ten chars",
      amountAvax: "1.5",
      buyerAddress: "",
      arbiterAddress: zero,
      fundingDeadline: future1,
      deliveryDeadline: future2,
      inspectionHours: 24,
      terms: "Goods delivered in original sealed packaging",
    });
    expect(zeroArbiter.success).toBe(false);

    const sameBuyerArbiter = createDealSchema.safeParse({
      title: "Invalid Conflict",
      description: "Valid deal description longer than ten chars",
      amountAvax: "1.5",
      buyerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      arbiterAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      fundingDeadline: future1,
      deliveryDeadline: future2,
      inspectionHours: 24,
      terms: "Goods delivered in original sealed packaging",
    });
    expect(sameBuyerArbiter.success).toBe(false);

    const reversedDeadlines = createDealSchema.safeParse({
      title: "Invalid Timing",
      description: "Valid deal description longer than ten chars",
      amountAvax: "1.5",
      buyerAddress: "",
      arbiterAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      fundingDeadline: future2,
      deliveryDeadline: future1,
      inspectionHours: 24,
      terms: "Goods delivered in original sealed packaging",
    });
    expect(reversedDeadlines.success).toBe(false);
  });

  it("enforces MIME type allowlist, non-empty size, and byte cap on evidence attachments", () => {
    const validPdf = new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" });
    expect(validateEvidenceFile(validPdf)).toBeNull();

    const emptyFile = new File([], "empty.png", { type: "image/png" });
    expect(validateEvidenceFile(emptyFile)).toContain("empty");

    const executable = new File(["#!/bin/sh"], "malware.sh", { type: "application/x-sh" });
    expect(validateEvidenceFile(executable)).toContain("Unsupported file type");

    const huge = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });
    expect(validateEvidenceFile(huge)).toContain("exceeds maximum size");
  });

  it("fast-fails non-retryable 4xx/429 query errors and retries 5xx/network errors twice", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetryQueryError(0, new ApiClientError(status, "client error", `ERR_${status}`))).toBe(false);
    }

    expect(shouldRetryQueryError(0, new ApiClientError(503, "down", "SERVICE_UNAVAILABLE"))).toBe(true);
    expect(shouldRetryQueryError(1, new ApiClientError(503, "down", "SERVICE_UNAVAILABLE"))).toBe(true);
    expect(shouldRetryQueryError(2, new ApiClientError(503, "down", "SERVICE_UNAVAILABLE"))).toBe(false);

    expect(shouldRetryQueryError(0, new Error("Network timeout"))).toBe(true);
    expect(shouldRetryQueryError(2, new Error("Network timeout"))).toBe(false);
  });
});
