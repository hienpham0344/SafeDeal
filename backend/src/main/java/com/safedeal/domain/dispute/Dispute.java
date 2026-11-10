package com.safedeal.domain.dispute;

import java.time.Instant;

public record Dispute(
    Long id,
    String tradeId,
    String openedBy,
    String reason,
    String summary,
    DisputeStatus status,
    String buyerAwardWei,
    String sellerAwardWei,
    String resolutionRationale,
    String openTxHash,
    String resolveTxHash,
    Instant createdAt,
    Instant resolvedAt
) {
}
