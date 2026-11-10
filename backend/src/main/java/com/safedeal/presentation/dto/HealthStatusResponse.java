package com.safedeal.presentation.dto;

public record HealthStatusResponse(
    String status,
    String service,
    long chainId,
    String chainName,
    boolean escrowContractConfigured
) {
}
