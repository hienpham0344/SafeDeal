package com.safedeal.blockchain.domain;

/**
 * A frontend claim that a transaction happened. It is a claim only — never trusted on its own.
 */
public record ChainVerificationRequest(
        BlockchainNetwork network,
        String txHash,
        String expectedEventSignature) {

    public ChainVerificationRequest {
        if (txHash == null || !txHash.matches("^0x[0-9a-fA-F]{64}$")) {
            throw new IllegalArgumentException("txHash must be a 0x-prefixed 32-byte hash");
        }
        if (expectedEventSignature == null || expectedEventSignature.isBlank()) {
            throw new IllegalArgumentException("expectedEventSignature is required");
        }
    }
}
