use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use safedeal_domain::auth::{AuthNonce, AuthenticatedPrincipal};
use safedeal_domain::dispute::AuditLogEntry;
use safedeal_domain::ports::{in_tx, SignatureVerifierPort, UnitOfWork};
use safedeal_shared::{format_iso_utc, CorrelationIdContext, DomainError, EthFormatValidator};

const HEADER_SUFFIX: &str = " wants you to sign in with your Ethereum account:";
const DEFAULT_SIWE_STATEMENT: &str =
    "Sign in to SafeDeal to manage your Avalanche escrow deals securely.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiweSettings {
    pub siwe_domain: String,
    pub siwe_uri: String,
    pub chain_id: i64,
    pub nonce_ttl_seconds: i64,
    pub statement: String,
}

impl SiweSettings {
    pub fn new(
        siwe_domain: impl Into<String>,
        siwe_uri: impl Into<String>,
        chain_id: i64,
        nonce_ttl_seconds: i64,
    ) -> Self {
        Self {
            siwe_domain: siwe_domain.into(),
            siwe_uri: siwe_uri.into(),
            chain_id,
            nonce_ttl_seconds,
            statement: DEFAULT_SIWE_STATEMENT.to_string(),
        }
    }
}

/// Generates RFC 6265 `Set-Cookie` header strings for issuing and clearing SafeDeal cookies
/// without leaking HTTP framework types into the application layer.
pub trait SessionCookiePort: Send + Sync {
    fn session_cookie_headers(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Result<Vec<String>, DomainError>;
    fn clear_cookie_headers(&self) -> Vec<String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChallengeResult {
    pub nonce: String,
    pub domain: String,
    pub uri: String,
    pub chain_id: i64,
    pub issued_at: DateTime<Utc>,
    pub expiration_time: DateTime<Utc>,
    pub statement: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSiweMessage {
    pub domain: String,
    pub address: String,
    pub uri: String,
    pub version: String,
    pub chain_id: i64,
    pub nonce: String,
    pub issued_at: DateTime<Utc>,
    pub expiration_time: DateTime<Utc>,
}

pub struct SiweMessageParser;

impl SiweMessageParser {
    pub fn parse(raw_message: &str) -> Result<ParsedSiweMessage, DomainError> {
        if raw_message.trim().is_empty() {
            return Err(DomainError::unauthorized("Empty SIWE message."));
        }
        let normalized = raw_message.replace("\r\n", "\n");
        let lines: Vec<&str> = normalized.split('\n').collect();
        if lines.len() < 7 {
            return Err(DomainError::unauthorized(
                "Malformed SIWE message structure.",
            ));
        }

        let first_line = lines[0];
        let Some(domain_raw) = first_line.strip_suffix(HEADER_SUFFIX) else {
            return Err(DomainError::unauthorized("Invalid SIWE header line."));
        };
        let domain = domain_raw.trim();
        if domain.is_empty() {
            return Err(DomainError::unauthorized("Missing SIWE domain."));
        }

        let address = EthFormatValidator::require_address(Some(lines[1]), "SIWE address")
            .map_err(|_| DomainError::unauthorized("Invalid SIWE wallet address."))?;

        let mut uri: Option<String> = None;
        let mut version: Option<String> = None;
        let mut chain_id: Option<i64> = None;
        let mut nonce: Option<String> = None;
        let mut issued_at: Option<DateTime<Utc>> = None;
        let mut expiration_time: Option<DateTime<Utc>> = None;

        for line in lines.iter().skip(2) {
            if let Some(rest) = line.strip_prefix("URI: ") {
                if uri.is_some() {
                    return Err(DomainError::unauthorized("Duplicate SIWE field: URI."));
                }
                uri = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Version: ") {
                if version.is_some() {
                    return Err(DomainError::unauthorized("Duplicate SIWE field: Version."));
                }
                version = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Chain ID: ") {
                if chain_id.is_some() {
                    return Err(DomainError::unauthorized("Duplicate SIWE field: Chain ID."));
                }
                chain_id = Some(parse_i64(rest.trim(), "Chain ID")?);
            } else if let Some(rest) = line.strip_prefix("Nonce: ") {
                if nonce.is_some() {
                    return Err(DomainError::unauthorized("Duplicate SIWE field: Nonce."));
                }
                nonce = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Issued At: ") {
                if issued_at.is_some() {
                    return Err(DomainError::unauthorized(
                        "Duplicate SIWE field: Issued At.",
                    ));
                }
                issued_at = Some(parse_utc_timestamp(rest.trim(), "Issued At")?);
            } else if let Some(rest) = line.strip_prefix("Expiration Time: ") {
                if expiration_time.is_some() {
                    return Err(DomainError::unauthorized(
                        "Duplicate SIWE field: Expiration Time.",
                    ));
                }
                expiration_time = Some(parse_utc_timestamp(rest.trim(), "Expiration Time")?);
            }
        }

        let (
            Some(uri),
            Some(version),
            Some(chain_id),
            Some(nonce),
            Some(issued_at),
            Some(expiration_time),
        ) = (uri, version, chain_id, nonce, issued_at, expiration_time)
        else {
            return Err(DomainError::unauthorized(
                "SIWE message is missing required security fields.",
            ));
        };

        if version != "1" || nonce.trim().is_empty() {
            return Err(DomainError::unauthorized(
                "SIWE message is missing required security fields.",
            ));
        }

        Ok(ParsedSiweMessage {
            domain: domain.to_string(),
            address,
            uri,
            version,
            chain_id,
            nonce,
            issued_at,
            expiration_time,
        })
    }
}

fn parse_i64(value: &str, field: &str) -> Result<i64, DomainError> {
    value
        .parse::<i64>()
        .map_err(|_| DomainError::unauthorized(format!("Invalid numeric SIWE field: {field}")))
}

fn parse_utc_timestamp(value: &str, field: &str) -> Result<DateTime<Utc>, DomainError> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| DomainError::unauthorized(format!("Invalid timestamp SIWE field: {field}")))
}

fn truncate_millis(dt: DateTime<Utc>) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(dt.timestamp_millis()).unwrap_or(dt)
}

pub struct SiweAuthService {
    uow: Arc<dyn UnitOfWork>,
    signature_verifier: Arc<dyn SignatureVerifierPort>,
    settings: SiweSettings,
}

impl SiweAuthService {
    pub fn new(
        uow: Arc<dyn UnitOfWork>,
        signature_verifier: Arc<dyn SignatureVerifierPort>,
        settings: SiweSettings,
    ) -> Self {
        Self {
            uow,
            signature_verifier,
            settings,
        }
    }

    pub fn settings(&self) -> &SiweSettings {
        &self.settings
    }

    pub async fn issue_challenge(
        &self,
        raw_address: &str,
        chain_id: i64,
    ) -> Result<ChallengeResult, DomainError> {
        let address = EthFormatValidator::require_address(Some(raw_address), "address")?;
        if chain_id != self.settings.chain_id {
            return Err(DomainError::validation_with_code(
                "CHAIN_MISMATCH",
                format!(
                    "Unsupported chain ID {chain_id}. Expected chain ID {}.",
                    self.settings.chain_id
                ),
            ));
        }

        let mut nonce_bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = hex::encode(nonce_bytes);

        let now = truncate_millis(Utc::now());
        let expires_at = now + Duration::seconds(self.settings.nonce_ttl_seconds);
        let message = self.build_eip4361_message(&address, chain_id, &nonce, now, expires_at);
        let correlation_id = CorrelationIdContext::get_or_default("n/a");

        let auth_nonce = AuthNonce {
            id: None,
            nonce: nonce.clone(),
            wallet_address: address.clone(),
            chain_id,
            siwe_message: message.clone(),
            issued_at: now,
            expires_at,
            consumed_at: None,
        };
        let audit = AuditLogEntry {
            id: None,
            action: "AUTH_NONCE_ISSUED".to_string(),
            actor_address: Some(address),
            resource_type: "AUTH_NONCE".to_string(),
            resource_id: nonce.clone(),
            correlation_id: Some(correlation_id),
            details: format!("Issued one-time SIWE login challenge for chainId={chain_id}"),
            created_at: now,
        };

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                repos.auth_nonces().save(&auth_nonce).await?;
                repos.audit_logs().append(&audit).await?;
                Ok(())
            })
        })
        .await?;

        Ok(ChallengeResult {
            nonce,
            domain: self.settings.siwe_domain.clone(),
            uri: self.settings.siwe_uri.clone(),
            chain_id,
            issued_at: now,
            expiration_time: expires_at,
            statement: self.settings.statement.clone(),
            message,
        })
    }

    pub async fn verify_and_authenticate(
        &self,
        message: &str,
        signature: &str,
    ) -> Result<AuthenticatedPrincipal, DomainError> {
        let sig_trimmed = signature.trim();
        if !is_hex_signature_65(sig_trimmed) {
            return Err(DomainError::unauthorized(
                "Invalid EIP-191 signature format.",
            ));
        }

        let parsed = SiweMessageParser::parse(message)?;
        if !self
            .settings
            .siwe_domain
            .eq_ignore_ascii_case(&parsed.domain)
        {
            return Err(DomainError::unauthorized("SIWE domain mismatch."));
        }
        if self.settings.siwe_uri != parsed.uri {
            return Err(DomainError::unauthorized("SIWE URI mismatch."));
        }
        if self.settings.chain_id != parsed.chain_id {
            return Err(DomainError::unauthorized("SIWE chain ID mismatch."));
        }

        let now = Utc::now();
        if parsed.issued_at > now + Duration::seconds(30) {
            return Err(DomainError::unauthorized(
                "SIWE Issued At timestamp is in the future.",
            ));
        }
        if now >= parsed.expiration_time {
            return Err(DomainError::unauthorized(
                "SIWE authentication challenge has expired.",
            ));
        }

        // Recover cryptographic signer strictly in memory before opening a DB transaction.
        let recovered_address = self
            .signature_verifier
            .recover_address_from_personal_sign(message, sig_trimmed)?;
        if !parsed.address.eq_ignore_ascii_case(&recovered_address) {
            return Err(DomainError::unauthorized(
                "Wallet signature verification failed.",
            ));
        }

        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        let parsed_for_tx = parsed.clone();
        let normalized_submitted_message = message.replace("\r\n", "\n");

        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let stored_nonce = repos
                    .auth_nonces()
                    .find_by_nonce(&parsed_for_tx.nonce)
                    .await?
                    .ok_or_else(|| DomainError::unauthorized("Invalid or unknown SIWE nonce."))?;

                let normalized_stored_message = stored_nonce.siwe_message.replace("\r\n", "\n");
                if normalized_submitted_message != normalized_stored_message
                    || !stored_nonce
                        .wallet_address
                        .eq_ignore_ascii_case(&parsed_for_tx.address)
                    || stored_nonce.chain_id != parsed_for_tx.chain_id
                    || stored_nonce.issued_at.timestamp_millis()
                        != parsed_for_tx.issued_at.timestamp_millis()
                    || stored_nonce.expires_at.timestamp_millis()
                        != parsed_for_tx.expiration_time.timestamp_millis()
                {
                    return Err(DomainError::unauthorized(
                        "SIWE challenge parameters do not match issued challenge.",
                    ));
                }

                if stored_nonce.is_expired(now) || stored_nonce.is_consumed() {
                    return Err(DomainError::unauthorized(
                        "SIWE challenge already consumed or expired.",
                    ));
                }

                let consumed = repos
                    .auth_nonces()
                    .consume_once(
                        &parsed_for_tx.nonce,
                        &parsed_for_tx.address,
                        parsed_for_tx.chain_id,
                        now,
                    )
                    .await?;
                if !consumed {
                    return Err(DomainError::unauthorized("SIWE nonce replay rejected."));
                }

                repos
                    .users()
                    .upsert_login(&parsed_for_tx.address, now)
                    .await?;
                repos
                    .audit_logs()
                    .append(&AuditLogEntry {
                        id: None,
                        action: "AUTH_LOGIN_VERIFIED".to_string(),
                        actor_address: Some(parsed_for_tx.address.clone()),
                        resource_type: "USER".to_string(),
                        resource_id: parsed_for_tx.address.clone(),
                        correlation_id: Some(correlation_id),
                        details: format!(
                            "Verified SIWE login on chainId={}",
                            parsed_for_tx.chain_id
                        ),
                        created_at: now,
                    })
                    .await?;

                let mut csrf_bytes = [0u8; 24];
                rand::thread_rng().fill_bytes(&mut csrf_bytes);
                Ok(AuthenticatedPrincipal {
                    address: parsed_for_tx.address,
                    chain_id: parsed_for_tx.chain_id,
                    authenticated_at: now,
                    csrf_token: hex::encode(csrf_bytes),
                })
            })
        })
        .await
    }

    fn build_eip4361_message(
        &self,
        address: &str,
        chain_id: i64,
        nonce: &str,
        issued_at: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> String {
        format!(
            "{} wants you to sign in with your Ethereum account:\n{}\n\n{}\n\nURI: {}\nVersion: 1\nChain ID: {}\nNonce: {}\nIssued At: {}\nExpiration Time: {}",
            self.settings.siwe_domain,
            address,
            self.settings.statement,
            self.settings.siwe_uri,
            chain_id,
            nonce,
            format_iso_utc(issued_at),
            format_iso_utc(expires_at)
        )
    }
}

fn is_hex_signature_65(s: &str) -> bool {
    let Some(hex_part) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) else {
        return false;
    };
    hex_part.len() == 130 && hex_part.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_eip4361_message_including_crlf() {
        let msg = "localhost:5173 wants you to sign in with your Ethereum account:\r\n0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\r\n\r\nSign in to SafeDeal\r\n\r\nURI: http://localhost:5173\r\nVersion: 1\r\nChain ID: 31337\r\nNonce: deadbeef0123456789abcdef01234567\r\nIssued At: 2026-01-01T00:00:00Z\r\nExpiration Time: 2026-01-01T00:05:00Z";
        let parsed = SiweMessageParser::parse(msg).unwrap();
        assert_eq!(parsed.domain, "localhost:5173");
        assert_eq!(parsed.address, "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
        assert_eq!(parsed.chain_id, 31337);
        assert_eq!(parsed.nonce, "deadbeef0123456789abcdef01234567");
        assert_eq!(parsed.version, "1");
    }

    #[test]
    fn rejects_malformed_or_missing_version_siwe_messages() {
        assert!(matches!(
            SiweMessageParser::parse(""),
            Err(DomainError::Unauthorized { .. })
        ));
        let bad_version = "localhost:5173 wants you to sign in with your Ethereum account:\n0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\n\nURI: http://localhost:5173\nVersion: 2\nChain ID: 31337\nNonce: abc\nIssued At: 2026-01-01T00:00:00Z\nExpiration Time: 2026-01-01T00:05:00Z";
        assert!(matches!(
            SiweMessageParser::parse(bad_version),
            Err(DomainError::Unauthorized { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_siwe_security_fields_and_accepts_uppercase_0x_signature_prefix() {
        let dup_nonce = "localhost:5173 wants you to sign in with your Ethereum account:\n0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\n\nNonce: injected\n\nURI: http://localhost:5173\nVersion: 1\nChain ID: 31337\nNonce: realnonce\nIssued At: 2026-01-01T00:00:00Z\nExpiration Time: 2026-01-01T00:05:00Z";
        assert!(matches!(
            SiweMessageParser::parse(dup_nonce),
            Err(DomainError::Unauthorized { .. })
        ));
        assert!(is_hex_signature_65(&format!("0X{}", "a".repeat(130))));
        assert!(is_hex_signature_65(&format!("0x{}", "a".repeat(130))));
    }
}
