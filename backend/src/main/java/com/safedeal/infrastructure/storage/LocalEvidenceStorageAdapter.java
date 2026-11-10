package com.safedeal.infrastructure.storage;

import com.safedeal.domain.port.EvidenceStoragePort;
import com.safedeal.infrastructure.configuration.EvidenceProperties;
import com.safedeal.shared.exception.NotFoundException;
import com.safedeal.shared.exception.ValidationException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class LocalEvidenceStorageAdapter implements EvidenceStoragePort {

    private static final Map<String, String> ALLOWED_EXTENSIONS = Map.of(
        "image/png", ".png",
        "image/jpeg", ".jpg",
        "application/pdf", ".pdf",
        "text/plain", ".txt"
    );

    private final Path rootDir;
    private final long maxBytes;

    public LocalEvidenceStorageAdapter(EvidenceProperties props) {
        this.rootDir = Path.of(props.getStorageDir()).toAbsolutePath().normalize();
        this.maxBytes = props.getMaxBytes();
        try {
            Files.createDirectories(this.rootDir);
        } catch (IOException ex) {
            throw new IllegalStateException("Cannot initialize evidence storage directory: " + this.rootDir, ex);
        }
    }

    @Override
    public StoredAttachment store(Long disputeId, String originalFilename, String declaredMimeType, byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw new ValidationException("Evidence file is empty.");
        }
        if (bytes.length > maxBytes) {
            throw new ValidationException("Evidence attachment exceeds max allowed bytes (" + maxBytes + ").");
        }
        String mime = declaredMimeType == null ? "" : declaredMimeType.toLowerCase().trim();
        String extension = ALLOWED_EXTENSIONS.get(mime);
        if (extension == null) {
            throw new ValidationException("Unsupported evidence MIME type. Allowed: image/png, image/jpeg, application/pdf, text/plain.");
        }
        if (!matchesMagicSignature(mime, bytes)) {
            throw new ValidationException("File contents do not match declared MIME type (" + mime + ").");
        }

        String safeOriginal = sanitizeFilename(originalFilename, extension);
        String key = disputeId + "/" + UUID.randomUUID() + extension;
        Path target = rootDir.resolve(key).normalize();
        if (!target.startsWith(rootDir)) {
            throw new ValidationException("Invalid storage path traversal attempt rejected.");
        }

        try {
            Files.createDirectories(target.getParent());
            Files.write(target, bytes);
        } catch (IOException ex) {
            throw new IllegalStateException("Failed to persist dispute evidence file", ex);
        }

        return new StoredAttachment(
            safeOriginal,
            mime,
            bytes.length,
            sha256Hex(bytes),
            key
        );
    }

    @Override
    public byte[] load(String storageKey) {
        if (storageKey == null || storageKey.isBlank() || storageKey.contains("..")) {
            throw new ValidationException("Invalid evidence storage key.");
        }
        Path target = rootDir.resolve(storageKey).normalize();
        if (!target.startsWith(rootDir)) {
            throw new ValidationException("Storage path traversal attempt rejected.");
        }
        if (!Files.exists(target) || !Files.isRegularFile(target)) {
            throw new NotFoundException("Evidence file missing from storage.");
        }
        try {
            return Files.readAllBytes(target);
        } catch (IOException ex) {
            throw new IllegalStateException("Unable to read stored evidence file", ex);
        }
    }

    @Override
    public boolean isStorageReady() {
        return Files.exists(rootDir) && Files.isDirectory(rootDir) && Files.isWritable(rootDir);
    }

    private boolean matchesMagicSignature(String mime, byte[] b) {
        return switch (mime) {
            case "image/png" -> b.length >= 8
                && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && (b[4] & 0xFF) == 0x0D && (b[5] & 0xFF) == 0x0A && (b[6] & 0xFF) == 0x1A && (b[7] & 0xFF) == 0x0A;
            case "image/jpeg" -> b.length >= 3
                && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF;
            case "application/pdf" -> b.length >= 5
                && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-';
            case "text/plain" -> isSafePlainText(b);
            default -> false;
        };
    }

    private boolean isSafePlainText(byte[] b) {
        for (byte value : b) {
            int unsigned = value & 0xFF;
            if (unsigned == 0) {
                return false;
            }
        }
        String decoded = new String(b, StandardCharsets.UTF_8);
        return !decoded.isBlank();
    }

    private String sanitizeFilename(String original, String fallbackExt) {
        if (original == null || original.isBlank()) {
            return "evidence" + fallbackExt;
        }
        String base = Path.of(original).getFileName().toString().replaceAll("[^a-zA-Z0-9._-]", "_");
        if (base.isBlank() || ".".equals(base) || "..".equals(base)) {
            return "evidence" + fallbackExt;
        }
        return base.length() > 120 ? base.substring(0, 120) : base;
    }

    private String sha256Hex(byte[] bytes) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(bytes);
            StringBuilder hex = new StringBuilder(64);
            for (byte v : digest) {
                hex.append(Character.forDigit((v >> 4) & 0xF, 16));
                hex.append(Character.forDigit(v & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }
}
