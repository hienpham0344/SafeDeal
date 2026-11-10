package com.safedeal.domain.port;

import com.safedeal.domain.authentication.AuthNonce;
import java.time.Instant;
import java.util.Optional;

public interface AuthNonceRepository {
    AuthNonce save(AuthNonce nonce);

    Optional<AuthNonce> findByNonce(String nonce);

    /**
     * Atomically marks the nonce consumed iff it exists, matches wallet + chain, is unconsumed,
     * and has not expired yet. Returns true only on the first consumption (prevents race replay).
     */
    boolean consumeOnce(String nonce, String walletAddress, long chainId, Instant now);
}
