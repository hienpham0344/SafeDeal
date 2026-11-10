package com.safedeal.presentation.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class DisputeDtos {

    private DisputeDtos() {
    }

    public record OpenDisputeRequest(
        @NotBlank @Size(min = 5, max = 200) String reason,
        @NotBlank @Size(min = 10, max = 4000) String summary,
        String txHash
    ) {
    }

    public record ResolveDisputeRequest(
        @NotBlank(message = "txHash is required") String txHash,
        @NotBlank @Size(min = 10, max = 4000) String rationale
    ) {
    }

    public record DisputeDetailResponse(
        Long id,
        String tradeId,
        String dealTitle,
        String dealAmountWei,
        String seller,
        String buyer,
        String arbiter,
        String openedBy,
        String reason,
        String summary,
        String status,
        String buyerAwardWei,
        String sellerAwardWei,
        String resolutionRationale,
        String openTxHash,
        String resolveTxHash,
        Instant createdAt,
        Instant resolvedAt
    ) {
    }

    public record DisputeEvidenceResponse(
        Long id,
        Long disputeId,
        String submittedBy,
        String title,
        String notes,
        String fileName,
        String mimeType,
        Long sizeBytes,
        String sha256Hex,
        boolean hasAttachment,
        Instant createdAt
    ) {
    }
}
