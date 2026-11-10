package com.safedeal.domain.port;

import com.safedeal.domain.blockchain.VerifiedChainEvent;

public interface ChainEventRepository {
    /**
     * Inserts the event iff (txHash, logIndex) has not yet been processed.
     * Returns true when inserted, false when already processed (idempotent dedup).
     */
    boolean recordIfAbsent(VerifiedChainEvent event);
}
