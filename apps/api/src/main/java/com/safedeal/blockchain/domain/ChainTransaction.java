package com.safedeal.blockchain.domain;

import java.time.Instant;
import java.util.Optional;

/**
 * Aggregate root for an on-chain transaction initiated by SafeDeal.
 * The database row is the source of truth the backend reads; the chain is verified separately.
 */
public record ChainTransaction(
        Long id,
        BlockchainNetwork network,
        String txHash,
        BlockchainTransactionStatus status,
        Long blockNumber,
        Instant submittedAt,
        Instant confirmedAt) {

    public ChainTransaction {
        if (txHash == null || txHash.isBlank()) {
            throw new IllegalArgumentException("txHash is required");
        }
    }

    public boolean isConfirmed() {
        return status == BlockchainTransactionStatus.CONFIRMED;
    }

    public Optional<Long> block() {
        return Optional.ofNullable(blockNumber);
    }
}
