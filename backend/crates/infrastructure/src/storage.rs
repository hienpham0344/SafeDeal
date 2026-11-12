use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use safedeal_domain::ports::{EvidenceStoragePort, StoredAttachment};
use safedeal_shared::DomainError;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::EvidenceConfig;

pub struct LocalEvidenceStorageAdapter {
    root_dir: PathBuf,
    max_bytes: usize,
}

impl LocalEvidenceStorageAdapter {
    pub fn new(config: &EvidenceConfig) -> Result<Self, std::io::Error> {
        let configured = PathBuf::from(&config.storage_dir);
        std::fs::create_dir_all(&configured)?;
        let root_dir = std::fs::canonicalize(&configured).unwrap_or_else(|_| {
            if configured.is_absolute() {
                configured
            } else {
                std::env::current_dir()
                    .map(|cwd| cwd.join(&configured))
                    .unwrap_or(configured)
            }
        });
        Ok(Self {
            root_dir,
            max_bytes: config.max_bytes,
        })
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    fn resolve_within_root(&self, storage_key: &str) -> Result<PathBuf, DomainError> {
        let trimmed = storage_key.trim();
        if trimmed.is_empty() || trimmed.contains("..") || trimmed.contains('\\') {
            return Err(DomainError::validation("Invalid evidence storage key."));
        }
        let rel = Path::new(trimmed);
        if rel.is_absolute() {
            return Err(DomainError::validation(
                "Storage path traversal attempt rejected.",
            ));
        }
        let mut target = self.root_dir.clone();
        for comp in rel.components() {
            match comp {
                Component::Normal(seg) => target.push(seg),
                _ => {
                    return Err(DomainError::validation(
                        "Storage path traversal attempt rejected.",
                    ))
                }
            }
        }
        if !target.starts_with(&self.root_dir) {
            return Err(DomainError::validation(
                "Storage path traversal attempt rejected.",
            ));
        }
        Ok(target)
    }
}

#[async_trait]
impl EvidenceStoragePort for LocalEvidenceStorageAdapter {
    async fn store(
        &self,
        dispute_id: i64,
        original_filename: &str,
        declared_mime_type: Option<&str>,
        bytes: &[u8],
    ) -> Result<StoredAttachment, DomainError> {
        if bytes.is_empty() {
            return Err(DomainError::validation("Evidence file is empty."));
        }
        if bytes.len() > self.max_bytes {
            return Err(DomainError::validation(format!(
                "Evidence attachment exceeds max allowed bytes ({}).",
                self.max_bytes
            )));
        }

        let mime = declared_mime_type
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let extension = extension_for_mime(&mime).ok_or_else(|| {
            DomainError::validation(
                "Unsupported evidence MIME type. Allowed: image/png, image/jpeg, application/pdf, text/plain.",
            )
        })?;

        if !matches_magic_signature(&mime, bytes) {
            return Err(DomainError::validation(format!(
                "File contents do not match declared MIME type ({mime})."
            )));
        }

        let safe_original = sanitize_filename(original_filename, extension);
        let key = format!("{dispute_id}/{}{}", Uuid::new_v4(), extension);
        let target = self.resolve_within_root(&key)?;
        let canonical_root = std::fs::canonicalize(&self.root_dir)
            .map_err(|e| DomainError::internal(format!("Evidence storage root unavailable: {e}")))?;

        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| DomainError::internal(format!("Failed to prepare evidence dir: {e}")))?;
            let canonical_parent = std::fs::canonicalize(parent)
                .map_err(|e| DomainError::internal(format!("Failed to verify evidence dir: {e}")))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err(DomainError::validation(
                    "Storage path traversal attempt rejected.",
                ));
            }
        }
        tokio::fs::write(&target, bytes)
            .await
            .map_err(|e| DomainError::internal(format!("Failed to persist dispute evidence file: {e}")))?;

        let sha256_hex = hex::encode(Sha256::digest(bytes));
        Ok(StoredAttachment {
            sanitized_file_name: safe_original,
            mime_type: mime,
            size_bytes: bytes.len() as i64,
            sha256_hex,
            storage_key: key,
        })
    }

    async fn load(&self, storage_key: &str) -> Result<Vec<u8>, DomainError> {
        let target = self.resolve_attachment_path(storage_key)?;
        tokio::fs::read(&target)
            .await
            .map_err(|e| DomainError::internal(format!("Unable to read stored evidence file: {e}")))
    }

    async fn delete_best_effort(&self, storage_key: &str) {
        if let Ok(target) = self.resolve_within_root(storage_key) {
            if let Ok(meta) = tokio::fs::symlink_metadata(&target).await {
                if !meta.file_type().is_symlink() {
                    let _ = tokio::fs::remove_file(&target).await;
                }
            }
        }
    }

    fn resolve_attachment_path(&self, storage_key: &str) -> Result<PathBuf, DomainError> {
        let target = self.resolve_within_root(storage_key)?;
        let canonical_root = std::fs::canonicalize(&self.root_dir)
            .map_err(|e| DomainError::internal(format!("Evidence storage root unavailable: {e}")))?;
        match std::fs::symlink_metadata(&target) {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(DomainError::not_found("Evidence file missing from storage."));
            }
            Err(err) => {
                return Err(DomainError::internal(format!(
                    "Unable to inspect stored evidence metadata: {err}"
                )));
            }
        }
        let canonical_target = std::fs::canonicalize(&target).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                DomainError::not_found("Evidence file missing from storage.")
            } else {
                DomainError::internal(format!("Unable to resolve evidence path: {err}"))
            }
        })?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(DomainError::validation(
                "Storage path traversal attempt rejected.",
            ));
        }
        match std::fs::metadata(&canonical_target) {
            Ok(meta) if meta.is_file() => Ok(canonical_target),
            _ => Err(DomainError::not_found("Evidence file missing from storage.")),
        }
    }

    fn is_storage_ready(&self) -> bool {
        match std::fs::metadata(&self.root_dir) {
            Ok(meta) => meta.is_dir() && !meta.permissions().readonly(),
            Err(_) => false,
        }
    }
}

fn extension_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some(".png"),
        "image/jpeg" => Some(".jpg"),
        "application/pdf" => Some(".pdf"),
        "text/plain" => Some(".txt"),
        _ => None,
    }
}

fn matches_magic_signature(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "text/plain" => is_safe_plain_text(bytes),
        _ => false,
    }
}

fn is_safe_plain_text(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return false;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => !text.trim().is_empty(),
        Err(_) => false,
    }
}

fn sanitize_filename(original: &str, fallback_ext: &str) -> String {
    if original.trim().is_empty() {
        return format!("evidence{fallback_ext}");
    }
    let normalized_slashes = original.replace('\\', "/");
    let file_name = normalized_slashes
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim();
    let sanitized: String = file_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return format!("evidence{fallback_ext}");
    }
    if sanitized.len() > 120 {
        sanitized[..120].to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn adapter(dir: &Path, max_bytes: usize) -> LocalEvidenceStorageAdapter {
        LocalEvidenceStorageAdapter::new(&EvidenceConfig {
            storage_dir: dir.to_string_lossy().into_owned(),
            max_bytes,
            max_request_bytes: max_bytes + 1024,
        })
        .unwrap()
    }

    #[tokio::test]
    async fn stores_valid_png_and_computes_sha256_with_sanitized_filename() {
        let dir = TempDir::new().unwrap();
        let storage = adapter(dir.path(), 1024);
        let png_bytes = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01];

        let stored = storage
            .store(42, "../../evil name?.png", Some("image/png"), &png_bytes)
            .await
            .unwrap();

        assert_eq!(stored.sanitized_file_name, "evil_name_.png");
        assert_eq!(stored.mime_type, "image/png");
        assert_eq!(stored.size_bytes, png_bytes.len() as i64);
        assert_eq!(stored.sha256_hex.len(), 64);
        assert!(stored.storage_key.starts_with("42/"));
        assert!(stored.storage_key.ends_with(".png"));

        let loaded = storage.load(&stored.storage_key).await.unwrap();
        assert_eq!(loaded, png_bytes);
        assert!(storage.is_storage_ready());
    }

    #[tokio::test]
    async fn rejects_spoofed_magic_bytes_unsupported_mime_oversized_and_traversal() {
        let dir = TempDir::new().unwrap();
        let storage = adapter(dir.path(), 20);

        let err = storage
            .store(1, "a.png", Some("image/png"), b"not-really-png")
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));
        assert!(err.message().contains("do not match declared MIME type"));

        let err = storage
            .store(1, "x.sh", Some("application/x-sh"), b"#!/bin/sh")
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));

        let err = storage
            .store(1, "big.txt", Some("text/plain"), b"123456789012345678901")
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));

        let err = storage.load("../etc/passwd").await.unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlink_escape_outside_root_and_cleans_up_best_effort() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let secret_file = outside.path().join("secret.txt");
        std::fs::write(&secret_file, b"top-secret").unwrap();

        let storage = adapter(root.path(), 1024);
        let dispute_dir = root.path().join("99");
        std::fs::create_dir_all(&dispute_dir).unwrap();
        let link_path = dispute_dir.join("escape.txt");
        std::os::unix::fs::symlink(&secret_file, &link_path).unwrap();

        let err = storage.load("99/escape.txt").await.unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));
        assert!(err.message().contains("traversal"));

        // Normal file deletion cleans up regular stored artifacts without touching targets outside root
        let stored = storage
            .store(99, "note.txt", Some("text/plain"), b"clean-evidence")
            .await
            .unwrap();
        assert!(storage.resolve_attachment_path(&stored.storage_key).is_ok());
        storage.delete_best_effort(&stored.storage_key).await;
        assert!(matches!(
            storage.resolve_attachment_path(&stored.storage_key),
            Err(DomainError::NotFound { .. })
        ));
    }
}
