package com.safedeal.infrastructure.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.safedeal.infrastructure.configuration.EvidenceProperties;
import com.safedeal.shared.exception.ValidationException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalEvidenceStorageAdapterTest {

    @TempDir
    Path tempDir;

    private LocalEvidenceStorageAdapter adapter(long maxBytes) {
        EvidenceProperties props = new EvidenceProperties();
        props.setStorageDir(tempDir.toString());
        props.setMaxBytes(maxBytes);
        return new LocalEvidenceStorageAdapter(props);
    }

    @Test
    void storesValidPngAndComputesSha256WithSanitizedFilename() {
        byte[] pngBytes = new byte[] {
            (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01
        };
        var stored = adapter(1024).store(42L, "../../evil name?.png", "image/png", pngBytes);

        assertThat(stored.sanitizedFileName()).isEqualTo("evil_name_.png");
        assertThat(stored.mimeType()).isEqualTo("image/png");
        assertThat(stored.sizeBytes()).isEqualTo(pngBytes.length);
        assertThat(stored.sha256Hex()).hasSize(64);
        assertThat(stored.storageKey()).startsWith("42/").endsWith(".png");

        byte[] loaded = adapter(1024).load(stored.storageKey());
        assertThat(loaded).isEqualTo(pngBytes);
    }

    @Test
    void rejectsSpoofedMagicBytesUnsupportedMimeOversizedFilesAndPathTraversal() {
        var storage = adapter(20);

        byte[] fakePng = "not-really-png".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> storage.store(1L, "a.png", "image/png", fakePng))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("do not match declared MIME type");

        assertThatThrownBy(() -> storage.store(1L, "x.sh", "application/x-sh", "#!/bin/sh".getBytes(StandardCharsets.UTF_8)))
            .isInstanceOf(ValidationException.class);

        assertThatThrownBy(() -> storage.store(1L, "big.txt", "text/plain", "123456789012345678901".getBytes(StandardCharsets.UTF_8)))
            .isInstanceOf(ValidationException.class);

        assertThatThrownBy(() -> storage.load("../etc/passwd"))
            .isInstanceOf(ValidationException.class);
    }
}
