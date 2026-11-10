package com.safedeal.domain.blockchain;

import java.util.List;

public record TransactionVerificationResult(
    String txHash,
    boolean succeeded,
    long blockNumber,
    String fromAddress,
    String toAddress,
    List<VerifiedChainEvent> decodedEvents
) {
}
