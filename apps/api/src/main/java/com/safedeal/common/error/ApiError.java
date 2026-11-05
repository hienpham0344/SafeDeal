package com.safedeal.common.error;

import java.time.Instant;

/**
 * Uniform error payload returned by every REST endpoint.
 * {@code code} is a stable machine-readable identifier for clients.
 */
public record ApiError(
        Instant timestamp,
        int status,
        String code,
        String message,
        String path) {

    public static ApiError of(int status, String code, String message, String path) {
        return new ApiError(Instant.now(), status, code, message, path);
    }
}
