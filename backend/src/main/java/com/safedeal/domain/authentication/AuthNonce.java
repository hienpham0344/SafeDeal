package com.safedeal.domain.authentication;

import java.time.Instant;

public record AuthNonce(
    Long id,
    String nonce,
    String walletAddress,
    long chainId,
    String siweMessage,
    Instant issuedAt,
    Instant expiresAt,
    Instant consumedAt
) {
    public boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    public boolean isConsumed() {
        return consumedAt != null;
    }
}
