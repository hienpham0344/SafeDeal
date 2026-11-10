package com.safedeal.domain.blockchain;

import java.time.Instant;

public record ChainSyncState(
    int id,
    long chainId,
    String contractAddress,
    long lastSyncedBlock,
    Instant updatedAt
) {
}
