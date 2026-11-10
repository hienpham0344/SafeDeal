package com.safedeal.domain.deal;

import java.time.Instant;

public record BlockchainTransaction(
    Long id,
    String tradeId,
    String txHash,
    String operation,
    String status,
    Long blockNumber,
    String submittedBy,
    Instant createdAt,
    Instant confirmedAt
) {
}
