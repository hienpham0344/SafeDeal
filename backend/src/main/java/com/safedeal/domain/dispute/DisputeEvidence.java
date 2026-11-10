package com.safedeal.domain.dispute;

import java.time.Instant;

public record DisputeEvidence(
    Long id,
    Long disputeId,
    String submittedBy,
    String title,
    String notes,
    String fileName,
    String mimeType,
    Long sizeBytes,
    String sha256Hex,
    String storageKey,
    Instant createdAt
) {
    public boolean hasAttachment() {
        return storageKey != null && !storageKey.isBlank();
    }
}
