package com.safedeal.presentation.dto;

import java.time.Instant;
import java.util.List;

public record ApiErrorPayload(
    String code,
    String message,
    String correlationId,
    Instant timestamp,
    List<ApiFieldError> fieldErrors
) {
    public record ApiFieldError(String field, String message) {
    }
}
