package com.safedeal.blockchain.domain;

public record OnChainVerificationResult(
        boolean confirmed,
        BlockchainTransactionStatus observedStatus,
        Long blockNumber,
        String reason) {

    public static OnChainVerificationResult confirmed(long blockNumber) {
        return new OnChainVerificationResult(true, BlockchainTransactionStatus.CONFIRMED, blockNumber, null);
    }

    public static OnChainVerificationResult rejected(BlockchainTransactionStatus status, String reason) {
        return new OnChainVerificationResult(false, status, null, reason);
    }
}
