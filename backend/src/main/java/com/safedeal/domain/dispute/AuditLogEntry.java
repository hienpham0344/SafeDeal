package com.safedeal.domain.dispute;

import java.time.Instant;

public record AuditLogEntry(
    Long id,
    String action,
    String actorAddress,
    String resourceType,
    String resourceId,
    String correlationId,
    String details,
    Instant createdAt
) {
}
