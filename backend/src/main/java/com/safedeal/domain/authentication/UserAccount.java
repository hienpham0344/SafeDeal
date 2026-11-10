package com.safedeal.domain.authentication;

import java.time.Instant;

public record UserAccount(
    Long id,
    String walletAddress,
    Instant createdAt,
    Instant lastLoginAt
) {
}
