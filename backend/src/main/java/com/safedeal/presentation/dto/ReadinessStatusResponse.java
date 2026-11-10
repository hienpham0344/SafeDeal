package com.safedeal.presentation.dto;

public record ReadinessStatusResponse(
    String status,
    String service,
    boolean databaseConnected,
    boolean evidenceStorageReady,
    boolean siweConfigured,
    boolean blockchainEnabled,
    boolean escrowContractConfigured,
    long chainId
) {
}
