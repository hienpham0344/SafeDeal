package com.safedeal.domain.deal;

import java.time.Instant;

public record DealEvent(
    Long id,
    String tradeId,
    String eventType,
    String actorAddress,
    String txHash,
    Long blockNumber,
    Integer logIndex,
    String details,
    Instant createdAt
) {
}
