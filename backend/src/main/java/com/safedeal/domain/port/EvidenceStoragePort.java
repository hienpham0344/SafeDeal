package com.safedeal.domain.port;

public interface EvidenceStoragePort {

    record StoredAttachment(
        String sanitizedFileName,
        String mimeType,
        long sizeBytes,
        String sha256Hex,
        String storageKey
    ) {
    }

    StoredAttachment store(Long disputeId, String originalFilename, String declaredMimeType, byte[] bytes);

    byte[] load(String storageKey);

    boolean isStorageReady();
}
