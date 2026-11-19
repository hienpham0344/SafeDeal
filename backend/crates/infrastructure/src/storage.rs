use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use safedeal_domain::ports::{EvidenceDownloadPayload, EvidenceStoragePort, StoredAttachment};
use safedeal_shared::DomainError;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::{EvidenceConfig, EvidenceStorageBackend};
pub use crate::storage_s3::S3EvidenceStorageAdapter;

/// Builds the configured evidence storage backend (`local` filesystem or `s3`-compatible object storage).
pub fn build_evidence_storage(
    config: &EvidenceConfig,
) -> Result<Arc<dyn EvidenceStoragePort>, String> {
    match config.backend {
        EvidenceStorageBackend::Local => {
            let adapter = LocalEvidenceStorageAdapter::new(config)
                .map_err(|e| format!("Cannot initialize local evidence storage: {e}"))?;
            Ok(Arc::new(adapter))
        }
        EvidenceStorageBackend::S3 => {
            let s3_cfg = config.s3.as_ref().ok_or_else(|| {
                "S3 configuration missing while EVIDENCE_STORAGE_BACKEND=s3".to_string()
            })?;
            let adapter = S3EvidenceStorageAdapter::new(s3_cfg, config.max_bytes)?;
            Ok(Arc::new(adapter))
        }
    }
}

pub(crate) struct ValidatedEvidencePayload {
    pub sanitized_file_name: String,
    pub mime_type: String,
    pub sha256_hex: String,
    pub storage_key: String,
    pub size_bytes: i64,
}

pub(crate) fn validate_evidence_payload(
    dispute_id: i64,
    original_filename: &str,
    declared_mime_type: Option<&str>,
    bytes: &[u8],
    max_bytes: usize,
) -> Result<ValidatedEvidencePayload, DomainError> {
    if bytes.is_empty() {
        return Err(DomainError::validation("Evidence file is empty."));
    }
    if bytes.len() > max_bytes {
        return Err(DomainError::validation(format!(
            "Evidence attachment exceeds max allowed bytes ({max_bytes})."
        )));
    }

    let mime = declared_mime_type
        .unwrap_or("")
        .split(';')
        .next()
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

    let sanitized_file_name = sanitize_filename(original_filename, extension);
    let storage_key = format!("{dispute_id}/{}{}", Uuid::new_v4(), extension);
    let sha256_hex = hex::encode(Sha256::digest(bytes));

    Ok(ValidatedEvidencePayload {
        sanitized_file_name,
        mime_type: mime,
        sha256_hex,
        storage_key,
        size_bytes: bytes.len() as i64,
    })
}

pub(crate) fn validate_storage_key(storage_key: &str) -> Result<Vec<String>, DomainError> {
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
    let mut segments = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(seg) => {
                let s = seg.to_str().ok_or_else(|| {
                    DomainError::validation("Invalid UTF-8 in evidence storage key.")
                })?;
                segments.push(s.to_string());
            }
            _ => {
                return Err(DomainError::validation(
                    "Storage path traversal attempt rejected.",
                ));
            }
        }
    }
    if segments.is_empty() {
        return Err(DomainError::validation("Invalid evidence storage key."));
    }
    Ok(segments)
}

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
        let segments = validate_storage_key(storage_key)?;
        let mut target = self.root_dir.clone();
        for seg in segments {
            target.push(seg);
        }
        if !target.starts_with(&self.root_dir) {
            return Err(DomainError::validation(
                "Storage path traversal attempt rejected.",
            ));
        }
        Ok(target)
    }

    pub fn resolve_attachment_path(&self, storage_key: &str) -> Result<PathBuf, DomainError> {
        let target = self.resolve_within_root(storage_key)?;
        let canonical_root = std::fs::canonicalize(&self.root_dir).map_err(|e| {
            DomainError::internal(format!("Evidence storage root unavailable: {e}"))
        })?;
        match std::fs::symlink_metadata(&target) {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(DomainError::not_found(
                    "Evidence file missing from storage.",
                ));
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
            _ => Err(DomainError::not_found(
                "Evidence file missing from storage.",
            )),
        }
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
        let validated = validate_evidence_payload(
            dispute_id,
            original_filename,
            declared_mime_type,
            bytes,
            self.max_bytes,
        )?;
        let target = self.resolve_within_root(&validated.storage_key)?;
        let canonical_root = std::fs::canonicalize(&self.root_dir).map_err(|e| {
            DomainError::internal(format!("Evidence storage root unavailable: {e}"))
        })?;

        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                DomainError::internal(format!("Failed to prepare evidence dir: {e}"))
            })?;
            let canonical_parent = std::fs::canonicalize(parent).map_err(|e| {
                DomainError::internal(format!("Failed to verify evidence dir: {e}"))
            })?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err(DomainError::validation(
                    "Storage path traversal attempt rejected.",
                ));
            }
        }
        tokio::fs::write(&target, bytes).await.map_err(|e| {
            DomainError::internal(format!("Failed to persist dispute evidence file: {e}"))
        })?;

        Ok(StoredAttachment {
            sanitized_file_name: validated.sanitized_file_name,
            mime_type: validated.mime_type,
            size_bytes: validated.size_bytes,
            sha256_hex: validated.sha256_hex,
            storage_key: validated.storage_key,
        })
    }

    async fn load(&self, storage_key: &str) -> Result<Vec<u8>, DomainError> {
        let target = self.resolve_attachment_path(storage_key)?;
        tokio::fs::read(&target)
            .await
            .map_err(|e| DomainError::internal(format!("Unable to read stored evidence file: {e}")))
    }

    async fn open_download(
        &self,
        storage_key: &str,
    ) -> Result<EvidenceDownloadPayload, DomainError> {
        let path = self.resolve_attachment_path(storage_key)?;
        Ok(EvidenceDownloadPayload::LocalFile(path))
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

    async fn is_storage_ready(&self) -> bool {
        match tokio::fs::metadata(&self.root_dir).await {
            Ok(meta) if meta.is_dir() && !meta.permissions().readonly() => {
                let probe = self.root_dir.join(format!(".ready_{}", Uuid::new_v4()));
                match tokio::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&probe)
                    .await
                {
                    Ok(_) => {
                        let _ = tokio::fs::remove_file(&probe).await;
                        true
                    }
                    Err(_) => false,
                }
            }
            _ => false,
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
    let file_name = normalized_slashes.rsplit('/').next().unwrap_or("").trim();
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
            backend: EvidenceStorageBackend::Local,
            storage_dir: dir.to_string_lossy().into_owned(),
            s3: None,
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
        assert!(matches!(
            storage.open_download(&stored.storage_key).await.unwrap(),
            EvidenceDownloadPayload::LocalFile(_)
        ));
        assert!(storage.is_storage_ready().await);
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
