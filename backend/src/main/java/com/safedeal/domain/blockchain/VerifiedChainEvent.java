package com.safedeal.domain.blockchain;

public record VerifiedChainEvent(
    String txHash,
    int logIndex,
    long blockNumber,
    long blockTimestampEpoch,
    String contractAddress,
    OnChainEventType eventType,
    String tradeId,
    String actorAddress,
    String buyerAddress,
    String amountWei,
    String buyerAwardWei,
    String sellerAwardWei,
    String termsHash
) {
}
