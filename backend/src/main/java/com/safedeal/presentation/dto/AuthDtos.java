package com.safedeal.presentation.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record NonceRequest(
        @NotBlank(message = "address is required") String address,
        @NotNull(message = "chainId is required") @Min(1) Long chainId
    ) {
    }

    public record NonceResponse(
        String nonce,
        String domain,
        String uri,
        long chainId,
        Instant issuedAt,
        Instant expirationTime,
        String statement,
        String message
    ) {
    }

    public record VerifyRequest(
        @NotBlank(message = "SIWE message is required") String message,
        @NotBlank(message = "Wallet signature is required") String signature
    ) {
    }

    public record SessionUserResponse(
        String address,
        long chainId,
        Instant authenticatedAt,
        String csrfToken
    ) {
    }
}
