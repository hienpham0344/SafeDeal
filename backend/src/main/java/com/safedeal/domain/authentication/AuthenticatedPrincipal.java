package com.safedeal.domain.authentication;

import java.time.Instant;

public record AuthenticatedPrincipal(
    String address,
    long chainId,
    Instant authenticatedAt,
    String csrfToken
) {
}
