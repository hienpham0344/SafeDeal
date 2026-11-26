use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::{Client, Method, StatusCode, Url};
use safedeal_domain::ports::{EvidenceDownloadPayload, EvidenceStoragePort, StoredAttachment};
use safedeal_shared::DomainError;
use sha2::{Digest, Sha256};

use crate::config::S3EvidenceConfig;
use crate::storage::{
    decrypt_evidence_bytes, encrypt_evidence_bytes, validate_evidence_payload,
    validate_storage_key, ENCRYPTED_EVIDENCE_OVERHEAD,
};

type HmacSha256 = Hmac<Sha256>;
const S3_READINESS_CACHE_TTL: Duration = Duration::from_secs(10);

/// RFC 3986 unreserved characters (`ALPHA / DIGIT / "-" / "." / "_" / "~"`).
const AWS_URI_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

const EMPTY_PAYLOAD_SHA256: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// S3-compatible object storage adapter using pure-Rust AWS Signature Version 4 (SigV4).
///
/// Compatible with AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, and Wasabi
/// without introducing native OpenSSL dependencies.
pub struct S3EvidenceStorageAdapter {
    client: Client,
    readiness_client: Client,
    endpoint: Url,
    bucket: String,
    region: String,
    access_key_id: String,
    secret_access_key: String,
    key_prefix: String,
    force_path_style: bool,
    server_side_encryption: bool,
    encryption_key: Option<[u8; 32]>,
    max_bytes: usize,
    readiness_cache: Mutex<Option<(Instant, bool)>>,
}

impl S3EvidenceStorageAdapter {
    pub fn new(config: &S3EvidenceConfig, max_bytes: usize) -> Result<Self, String> {
        Self::with_encryption(config, max_bytes, None)
    }

    pub fn with_encryption(
        config: &S3EvidenceConfig,
        max_bytes: usize,
        encryption_key: Option<[u8; 32]>,
    ) -> Result<Self, String> {
        let trimmed_endpoint = config.endpoint.trim().trim_end_matches('/');
        let endpoint = Url::parse(trimmed_endpoint)
            .map_err(|e| format!("Invalid EVIDENCE_S3_ENDPOINT URL: {e}"))?;
        if endpoint.scheme() != "http" && endpoint.scheme() != "https" {
            return Err("EVIDENCE_S3_ENDPOINT must use http:// or https://".to_string());
        }
        if endpoint.host_str().is_none() {
            return Err("EVIDENCE_S3_ENDPOINT is missing a host".to_string());
        }

        let bucket = config.bucket.trim().to_string();
        if bucket.is_empty() {
            return Err("EVIDENCE_S3_BUCKET cannot be empty".to_string());
        }

        let client = Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms))
            .build()
            .map_err(|e| format!("Failed to construct S3 HTTP client: {e}"))?;
        let readiness_timeout = Duration::from_millis(config.timeout_ms.min(3_000));
        let readiness_client = Client::builder()
            .timeout(readiness_timeout)
            .build()
            .map_err(|e| format!("Failed to construct S3 readiness HTTP client: {e}"))?;

        Ok(Self {
            client,
            readiness_client,
            endpoint,
            bucket,
            region: config.region.trim().to_string(),
            access_key_id: config.access_key_id.trim().to_string(),
            secret_access_key: config.secret_access_key.clone(),
            key_prefix: config.key_prefix.trim().trim_matches('/').to_string(),
            force_path_style: config.force_path_style,
            server_side_encryption: config.server_side_encryption,
            encryption_key,
            max_bytes,
            readiness_cache: Mutex::new(None),
        })
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    fn build_object_url(
        &self,
        key_segments: &[String],
    ) -> Result<(Url, String, String), DomainError> {
        let mut all_segments: Vec<String> = Vec::new();
        if !self.key_prefix.is_empty() {
            for seg in self.key_prefix.split('/').filter(|s| !s.is_empty()) {
                all_segments.push(seg.to_string());
            }
        }
        all_segments.extend(key_segments.iter().cloned());
        self.build_url_for_segments(Some(&all_segments))
    }

    fn build_bucket_url(&self) -> Result<(Url, String, String), DomainError> {
        self.build_url_for_segments(None)
    }

    fn build_url_for_segments(
        &self,
        object_segments: Option<&[String]>,
    ) -> Result<(Url, String, String), DomainError> {
        let mut url = self.endpoint.clone();
        if !self.force_path_style {
            let base_host = url
                .host_str()
                .ok_or_else(|| DomainError::internal("S3 endpoint host missing"))?
                .to_string();
            let virtual_host = format!("{}.{base_host}", self.bucket);
            url.set_host(Some(&virtual_host))
                .map_err(|e| DomainError::internal(format!("Invalid virtual S3 host: {e}")))?;
        }

        let mut path_parts: Vec<String> = url
            .path()
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| utf8_percent_encode(s, AWS_URI_ENCODE_SET).to_string())
            .collect();

        if self.force_path_style {
            path_parts.push(utf8_percent_encode(&self.bucket, AWS_URI_ENCODE_SET).to_string());
        }
        if let Some(segments) = object_segments {
            for seg in segments {
                path_parts.push(utf8_percent_encode(seg, AWS_URI_ENCODE_SET).to_string());
            }
        }

        let canonical_uri = if path_parts.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", path_parts.join("/"))
        };
        url.set_path(&canonical_uri);
        url.set_query(None);

        let host_header = format_host_header(&url)?;
        Ok((url, canonical_uri, host_header))
    }

    fn sign_request(
        &self,
        method: &Method,
        canonical_uri: &str,
        host_header: &str,
        payload_sha256: &str,
        extra_headers: &[(&str, &str)],
        now: DateTime<Utc>,
    ) -> Result<SigV4Headers, DomainError> {
        compute_sigv4_headers(
            method.as_str(),
            canonical_uri,
            host_header,
            payload_sha256,
            extra_headers,
            &self.region,
            &self.access_key_id,
            &self.secret_access_key,
            now,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SigV4Headers {
    amz_date: String,
    payload_sha256: String,
    authorization: String,
}

#[allow(clippy::too_many_arguments)]
fn compute_sigv4_headers(
    method: &str,
    canonical_uri: &str,
    host_header: &str,
    payload_sha256: &str,
    extra_headers: &[(&str, &str)],
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    now: DateTime<Utc>,
) -> Result<SigV4Headers, DomainError> {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();

    let mut headers: BTreeMap<String, String> = BTreeMap::new();
    headers.insert("host".to_string(), host_header.trim().to_string());
    headers.insert(
        "x-amz-content-sha256".to_string(),
        payload_sha256.trim().to_string(),
    );
    headers.insert("x-amz-date".to_string(), amz_date.clone());
    for (k, v) in extra_headers {
        headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
    }

    let mut canonical_headers = String::new();
    let mut signed_headers_list = Vec::with_capacity(headers.len());
    for (k, v) in &headers {
        canonical_headers.push_str(k);
        canonical_headers.push(':');
        canonical_headers.push_str(v);
        canonical_headers.push('\n');
        signed_headers_list.push(k.as_str());
    }
    let signed_headers = signed_headers_list.join(";");

    let canonical_request = format!(
        "{method}\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_sha256}"
    );
    let canonical_request_hash = hex::encode(Sha256::digest(canonical_request.as_bytes()));
    let credential_scope = format!("{date_stamp}/{region}/s3/aws4_request");
    let string_to_sign =
        format!("AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{canonical_request_hash}");

    let k_date = hmac_sha256(
        format!("AWS4{secret_access_key}").as_bytes(),
        date_stamp.as_bytes(),
    )?;
    let k_region = hmac_sha256(&k_date, region.as_bytes())?;
    let k_service = hmac_sha256(&k_region, b"s3")?;
    let k_signing = hmac_sha256(&k_service, b"aws4_request")?;
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes())?);

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );

    Ok(SigV4Headers {
        amz_date,
        payload_sha256: payload_sha256.to_string(),
        authorization,
    })
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Result<Vec<u8>, DomainError> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| DomainError::internal(format!("HMAC initialization error: {e}")))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn format_host_header(url: &Url) -> Result<String, DomainError> {
    let host = url
        .host_str()
        .ok_or_else(|| DomainError::internal("S3 request URL is missing host"))?;
    match url.port() {
        Some(port) => Ok(format!("{host}:{port}")),
        None => Ok(host.to_string()),
    }
}

#[async_trait]
impl EvidenceStoragePort for S3EvidenceStorageAdapter {
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
        let key_segments = validate_storage_key(&validated.storage_key)?;
        let (url, canonical_uri, host_header) = self.build_object_url(&key_segments)?;

        let body_bytes = encrypt_evidence_bytes(bytes, self.encryption_key.as_ref())?;
        let payload_sha256 = if self.encryption_key.is_some() {
            hex::encode(Sha256::digest(&body_bytes))
        } else {
            validated.sha256_hex.clone()
        };

        let dispute_id_str = dispute_id.to_string();
        let mut extra = vec![
            ("content-type", validated.mime_type.as_str()),
            ("x-amz-meta-safedeal-dispute-id", dispute_id_str.as_str()),
            ("x-amz-meta-safedeal-sha256", validated.sha256_hex.as_str()),
        ];
        if self.server_side_encryption {
            extra.push(("x-amz-server-side-encryption", "AES256"));
        }
        let sig = self.sign_request(
            &Method::PUT,
            &canonical_uri,
            &host_header,
            &payload_sha256,
            &extra,
            Utc::now(),
        )?;

        let mut req_builder = self
            .client
            .put(url)
            .header("content-type", &validated.mime_type)
            .header("x-amz-date", &sig.amz_date)
            .header("x-amz-content-sha256", &sig.payload_sha256)
            .header("x-amz-meta-safedeal-dispute-id", &dispute_id_str)
            .header("x-amz-meta-safedeal-sha256", &validated.sha256_hex);
        if self.server_side_encryption {
            req_builder = req_builder.header("x-amz-server-side-encryption", "AES256");
        }
        let response = req_builder
            .header("authorization", &sig.authorization)
            .body(body_bytes)
            .send()
            .await
            .map_err(|e| {
                DomainError::external_service(format!(
                    "Failed to upload dispute evidence to object storage: {e}"
                ))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            tracing::warn!(
                status = %status,
                storage_key = %validated.storage_key,
                "S3 evidence upload returned non-success status"
            );
            return Err(DomainError::external_service(format!(
                "Object storage rejected evidence upload with HTTP {status}."
            )));
        }

        Ok(StoredAttachment {
            sanitized_file_name: validated.sanitized_file_name,
            mime_type: validated.mime_type,
            size_bytes: validated.size_bytes,
            sha256_hex: validated.sha256_hex,
            storage_key: validated.storage_key,
        })
    }

    async fn load(&self, storage_key: &str) -> Result<Vec<u8>, DomainError> {
        let key_segments = validate_storage_key(storage_key)?;
        let (url, canonical_uri, host_header) = self.build_object_url(&key_segments)?;
        let sig = self.sign_request(
            &Method::GET,
            &canonical_uri,
            &host_header,
            EMPTY_PAYLOAD_SHA256,
            &[],
            Utc::now(),
        )?;

        let mut response = self
            .client
            .get(url)
            .header("x-amz-date", &sig.amz_date)
            .header("x-amz-content-sha256", &sig.payload_sha256)
            .header("authorization", &sig.authorization)
            .send()
            .await
            .map_err(|e| {
                DomainError::external_service(format!(
                    "Failed to fetch dispute evidence from object storage: {e}"
                ))
            })?;

        match response.status() {
            StatusCode::OK => {}
            StatusCode::NOT_FOUND => {
                return Err(DomainError::not_found(
                    "Evidence file missing from storage.",
                ));
            }
            status => {
                return Err(DomainError::external_service(format!(
                    "Object storage returned HTTP {status} when reading evidence."
                )));
            }
        }

        let max_stored_bytes = if self.encryption_key.is_some() {
            self.max_bytes.saturating_add(ENCRYPTED_EVIDENCE_OVERHEAD)
        } else {
            self.max_bytes
        };

        if let Some(declared_len) = response.content_length() {
            if declared_len > max_stored_bytes as u64 {
                return Err(DomainError::internal(
                    "Stored evidence object exceeds maximum configured evidence byte limit.",
                ));
            }
        }

        let mut out = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| {
            DomainError::external_service(format!("Failed streaming evidence object bytes: {e}"))
        })? {
            if out.len().saturating_add(chunk.len()) > max_stored_bytes {
                return Err(DomainError::internal(
                    "Stored evidence object exceeds maximum configured evidence byte limit.",
                ));
            }
            out.extend_from_slice(&chunk);
        }

        let plaintext = decrypt_evidence_bytes(&out, self.encryption_key.as_ref())?;
        if plaintext.len() > self.max_bytes {
            return Err(DomainError::internal(
                "Stored evidence object exceeds maximum configured evidence byte limit.",
            ));
        }

        Ok(plaintext)
    }

    async fn open_download(
        &self,
        storage_key: &str,
    ) -> Result<EvidenceDownloadPayload, DomainError> {
        let bytes = self.load(storage_key).await?;
        Ok(EvidenceDownloadPayload::Bytes(bytes))
    }

    async fn delete_best_effort(&self, storage_key: &str) {
        let Ok(key_segments) = validate_storage_key(storage_key) else {
            return;
        };
        let Ok((url, canonical_uri, host_header)) = self.build_object_url(&key_segments) else {
            return;
        };
        let Ok(sig) = self.sign_request(
            &Method::DELETE,
            &canonical_uri,
            &host_header,
            EMPTY_PAYLOAD_SHA256,
            &[],
            Utc::now(),
        ) else {
            return;
        };

        match self
            .client
            .delete(url)
            .header("x-amz-date", &sig.amz_date)
            .header("x-amz-content-sha256", &sig.payload_sha256)
            .header("authorization", &sig.authorization)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() || resp.status() == StatusCode::NOT_FOUND => {}
            Ok(resp) => {
                tracing::warn!(
                    status = %resp.status(),
                    storage_key,
                    "Best-effort S3 evidence deletion returned non-success status"
                );
            }
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    storage_key,
                    "Best-effort S3 evidence deletion failed"
                );
            }
        }
    }

    async fn is_storage_ready(&self) -> bool {
        if let Ok(guard) = self.readiness_cache.lock() {
            if let Some((checked_at, ready)) = *guard {
                if checked_at.elapsed() < S3_READINESS_CACHE_TTL {
                    return ready;
                }
            }
        }

        let ready = async {
            let Ok((url, canonical_uri, host_header)) = self.build_bucket_url() else {
                return false;
            };
            let Ok(sig) = self.sign_request(
                &Method::HEAD,
                &canonical_uri,
                &host_header,
                EMPTY_PAYLOAD_SHA256,
                &[],
                Utc::now(),
            ) else {
                return false;
            };

            match self
                .readiness_client
                .head(url)
                .header("x-amz-date", &sig.amz_date)
                .header("x-amz-content-sha256", &sig.payload_sha256)
                .header("authorization", &sig.authorization)
                .send()
                .await
            {
                Ok(resp) => resp.status().is_success(),
                Err(_) => false,
            }
        }
        .await;

        if let Ok(mut guard) = self.readiness_cache.lock() {
            *guard = Some((Instant::now(), ready));
        }

        ready
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use wiremock::matchers::{header, header_exists, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn test_s3_config(endpoint: String) -> S3EvidenceConfig {
        S3EvidenceConfig {
            endpoint,
            bucket: "safedeal-evidence".to_string(),
            region: "auto".to_string(),
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string(),
            key_prefix: "evidence".to_string(),
            force_path_style: true,
            timeout_ms: 5_000,
            server_side_encryption: false,
        }
    }

    #[test]
    fn computes_deterministic_aws_sigv4_signature_matching_official_vector() {
        // Official AWS SigV4 GET Object test vector (us-east-1, examplebucket/test.txt)
        // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
        let ts = Utc.with_ymd_and_hms(2013, 5, 24, 0, 0, 0).unwrap();
        let sig = compute_sigv4_headers(
            "GET",
            "/test.txt",
            "examplebucket.s3.amazonaws.com",
            EMPTY_PAYLOAD_SHA256,
            &[("range", "bytes=0-9")],
            "us-east-1",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            ts,
        )
        .unwrap();

        assert_eq!(sig.amz_date, "20130524T000000Z");
        assert_eq!(
            sig.authorization,
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
    }

    #[tokio::test]
    async fn stores_downloads_deletes_and_checks_readiness_against_s3_compatible_endpoint() {
        let server = MockServer::start().await;
        let adapter = S3EvidenceStorageAdapter::new(&test_s3_config(server.uri()), 1024).unwrap();
        let png_bytes = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02];
        let expected_sha = hex::encode(Sha256::digest(png_bytes));

        Mock::given(method("HEAD"))
            .and(path("/safedeal-evidence"))
            .and(header_exists("authorization"))
            .and(header("x-amz-content-sha256", EMPTY_PAYLOAD_SHA256))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        assert!(adapter.is_storage_ready().await);

        Mock::given(method("PUT"))
            .and(header("content-type", "image/png"))
            .and(header("x-amz-content-sha256", expected_sha.as_str()))
            .and(header("x-amz-meta-safedeal-dispute-id", "42"))
            .and(header("x-amz-meta-safedeal-sha256", expected_sha.as_str()))
            .and(header_exists("authorization"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        let stored = adapter
            .store(42, "../../receipt?.png", Some("image/png"), &png_bytes)
            .await
            .unwrap();
        assert_eq!(stored.sanitized_file_name, "receipt_.png");
        assert_eq!(stored.mime_type, "image/png");
        assert_eq!(stored.size_bytes, png_bytes.len() as i64);
        assert_eq!(stored.sha256_hex, expected_sha);
        assert!(stored.storage_key.starts_with("42/"));

        let expected_object_path = format!("/safedeal-evidence/evidence/{}", stored.storage_key);
        Mock::given(method("GET"))
            .and(path(expected_object_path.as_str()))
            .and(header_exists("authorization"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(png_bytes.to_vec()))
            .expect(1)
            .mount(&server)
            .await;

        let payload = adapter.open_download(&stored.storage_key).await.unwrap();
        assert_eq!(payload, EvidenceDownloadPayload::Bytes(png_bytes.to_vec()));

        Mock::given(method("DELETE"))
            .and(path(expected_object_path.as_str()))
            .and(header_exists("authorization"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;

        adapter.delete_best_effort(&stored.storage_key).await;
    }

    #[tokio::test]
    async fn enforces_bounds_maps_404_and_rejects_traversal_in_s3_adapter() {
        let server = MockServer::start().await;
        let adapter = S3EvidenceStorageAdapter::new(&test_s3_config(server.uri()), 16).unwrap();

        // Rejects spoofed magic bytes before making any HTTP call
        let err = adapter
            .store(7, "fake.png", Some("image/png"), b"not-a-png")
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));

        // Rejects path traversal keys before making any HTTP call
        let err = adapter.load("../etc/passwd").await.unwrap_err();
        assert!(matches!(err, DomainError::Validation { .. }));

        // Maps 404 to DomainError::NotFound
        Mock::given(method("GET"))
            .and(path("/safedeal-evidence/evidence/7/missing.png"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let err = adapter.load("7/missing.png").await.unwrap_err();
        assert!(matches!(err, DomainError::NotFound { .. }));

        // Rejects remote objects larger than max_bytes
        Mock::given(method("GET"))
            .and(path("/safedeal-evidence/evidence/7/huge.txt"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'a'; 32]))
            .mount(&server)
            .await;
        let err = adapter.load("7/huge.txt").await.unwrap_err();
        assert!(matches!(err, DomainError::Internal { .. }));

        // Readiness returns false on 403/500
        Mock::given(method("HEAD"))
            .and(path("/safedeal-evidence"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        assert!(!adapter.is_storage_ready().await);
    }

    #[tokio::test]
    async fn caches_s3_readiness_for_ten_seconds_and_supports_aes256_gcm_and_sse_header() {
        let server = MockServer::start().await;
        let mut cfg = test_s3_config(server.uri());
        cfg.server_side_encryption = true;
        let key = [0x55u8; 32];
        let adapter = S3EvidenceStorageAdapter::with_encryption(&cfg, 64, Some(key)).unwrap();

        Mock::given(method("HEAD"))
            .and(path("/safedeal-evidence"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        assert!(adapter.is_storage_ready().await);
        // Second readiness check within 10s uses cached result without a second HEAD call
        assert!(adapter.is_storage_ready().await);

        let plain_txt = b"confidential S3 arbitration attachment";
        let expected_plain_sha = hex::encode(Sha256::digest(plain_txt));

        Mock::given(method("PUT"))
            .and(header("x-amz-server-side-encryption", "AES256"))
            .and(header(
                "x-amz-meta-safedeal-sha256",
                expected_plain_sha.as_str(),
            ))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        let stored = adapter
            .store(77, "note.txt", Some("text/plain"), plain_txt)
            .await
            .unwrap();
        assert_eq!(stored.sha256_hex, expected_plain_sha);

        let requests = server.received_requests().await.unwrap();
        let put_req = requests.iter().find(|r| r.method == "PUT").unwrap();
        assert!(put_req.body.starts_with(b"SDE1"));
        let encrypted_uploaded = put_req.body.clone();

        let expected_object_path = format!("/safedeal-evidence/evidence/{}", stored.storage_key);
        Mock::given(method("GET"))
            .and(path(expected_object_path.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(encrypted_uploaded))
            .expect(1)
            .mount(&server)
            .await;

        let loaded = adapter.load(&stored.storage_key).await.unwrap();
        assert_eq!(loaded, plain_txt);
    }
}
