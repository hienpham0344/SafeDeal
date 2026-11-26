use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use safedeal_domain::auth::{AuthenticatedPrincipal, VerifiedSessionToken};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::config::AuthSecurityConfig;

type HmacSha256 = Hmac<Sha256>;

const HEADER_JSON: &[u8] = br#"{"alg":"HS256","typ":"JWT"}"#;
const MAX_CACHED_REVOKED_JTIS: usize = 16_384;

#[derive(Debug, Deserialize)]
struct JwtHeader {
    alg: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionClaims {
    pub sub: String,
    pub chain_id: i64,
    pub csrf: String,
    pub iat: i64,
    pub exp: i64,
    #[serde(default)]
    pub jti: String,
}

#[derive(Clone)]
pub struct JwtSessionService {
    hmac_key_bytes: Vec<u8>,
    session_ttl_seconds: i64,
    revoked_jtis: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
}

impl JwtSessionService {
    pub fn new(config: &AuthSecurityConfig) -> Self {
        Self {
            hmac_key_bytes: config.jwt_secret.as_bytes().to_vec(),
            session_ttl_seconds: config.session_ttl_seconds,
            revoked_jtis: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_token(&self, principal: &AuthenticatedPrincipal) -> Result<String, String> {
        let iat = principal.authenticated_at.timestamp();
        let exp = iat + self.session_ttl_seconds;
        let claims = SessionClaims {
            sub: principal.address.to_ascii_lowercase(),
            chain_id: principal.chain_id,
            csrf: principal.csrf_token.clone(),
            iat,
            exp,
            jti: Uuid::new_v4().to_string(),
        };
        let payload_json =
            serde_json::to_vec(&claims).map_err(|e| format!("Failed to encode JWT claims: {e}"))?;
        let header_b64 = URL_SAFE_NO_PAD.encode(HEADER_JSON);
        let payload_b64 = URL_SAFE_NO_PAD.encode(&payload_json);
        let signing_input = format!("{header_b64}.{payload_b64}");
        let sig = self.sign_hmac_sha256(signing_input.as_bytes())?;
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig);
        Ok(format!("{signing_input}.{sig_b64}"))
    }

    pub fn revoke_jti(&self, jti: &str, expires_at: DateTime<Utc>) {
        self.revoke_jti_at(jti, expires_at, Utc::now());
    }

    pub fn revoke_jti_at(&self, jti: &str, expires_at: DateTime<Utc>, now: DateTime<Utc>) {
        let trimmed = jti.trim();
        if trimmed.is_empty() || now >= expires_at {
            return;
        }
        let mut guard = self
            .revoked_jtis
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.len() >= MAX_CACHED_REVOKED_JTIS {
            guard.retain(|_, &mut exp| exp > now);
            if guard.len() >= MAX_CACHED_REVOKED_JTIS {
                if let Some(earliest_key) = guard
                    .iter()
                    .min_by_key(|(_, &exp)| exp)
                    .map(|(k, _)| k.clone())
                {
                    guard.remove(&earliest_key);
                }
            }
        }
        guard.insert(trimmed.to_string(), expires_at);
    }

    pub fn is_jti_revoked_at(&self, jti: &str, now: DateTime<Utc>) -> bool {
        let trimmed = jti.trim();
        if trimmed.is_empty() {
            return false;
        }
        let mut guard = self
            .revoked_jtis
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.get(trimmed).copied() {
            Some(exp) if exp > now => true,
            Some(_) => {
                guard.remove(trimmed);
                false
            }
            None => false,
        }
    }

    pub fn verify_token(&self, token: &str) -> Option<AuthenticatedPrincipal> {
        self.verify_session_token_at(token, Utc::now())
            .map(|s| s.principal)
    }

    pub fn verify_token_at(
        &self,
        token: &str,
        now: DateTime<Utc>,
    ) -> Option<AuthenticatedPrincipal> {
        self.verify_session_token_at(token, now)
            .map(|s| s.principal)
    }

    pub fn verify_session_token(&self, token: &str) -> Option<VerifiedSessionToken> {
        self.verify_session_token_at(token, Utc::now())
    }

    pub fn verify_session_token_at(
        &self,
        token: &str,
        now: DateTime<Utc>,
    ) -> Option<VerifiedSessionToken> {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return None;
        }
        let mut parts = trimmed.split('.');
        let header_part = parts.next()?;
        let payload_part = parts.next()?;
        let sig_part = parts.next()?;
        if parts.next().is_some() {
            return None;
        }

        let header_bytes = URL_SAFE_NO_PAD.decode(header_part).ok()?;
        let header: JwtHeader = serde_json::from_slice(&header_bytes).ok()?;
        if header.alg.as_deref() != Some("HS256") {
            return None;
        }

        let signing_input = format!("{header_part}.{payload_part}");
        let expected_sig = self.sign_hmac_sha256(signing_input.as_bytes()).ok()?;
        let actual_sig = URL_SAFE_NO_PAD.decode(sig_part).ok()?;
        if expected_sig.len() != actual_sig.len()
            || !bool::from(expected_sig.as_slice().ct_eq(actual_sig.as_slice()))
        {
            return None;
        }

        let payload_bytes = URL_SAFE_NO_PAD.decode(payload_part).ok()?;
        let claims: SessionClaims = serde_json::from_slice(&payload_bytes).ok()?;
        if claims.sub.trim().is_empty() || claims.csrf.trim().is_empty() {
            return None;
        }

        let exp = DateTime::from_timestamp(claims.exp, 0)?;
        if now >= exp {
            return None;
        }
        if self.is_jti_revoked_at(&claims.jti, now) {
            return None;
        }
        let iat = DateTime::from_timestamp(claims.iat, 0)?;

        Some(VerifiedSessionToken {
            principal: AuthenticatedPrincipal {
                address: claims.sub.to_ascii_lowercase(),
                chain_id: claims.chain_id,
                authenticated_at: iat,
                csrf_token: claims.csrf,
            },
            jti: claims.jti,
            expires_at: exp,
        })
    }

    fn sign_hmac_sha256(&self, input: &[u8]) -> Result<[u8; 32], String> {
        let mut mac = HmacSha256::new_from_slice(&self.hmac_key_bytes)
            .map_err(|e| format!("HMAC init error: {e}"))?;
        mac.update(input);
        Ok(mac.finalize().into_bytes().into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CookieSameSite;
    use chrono::Duration;

    fn test_service() -> JwtSessionService {
        JwtSessionService::new(&AuthSecurityConfig {
            jwt_secret: "unit-test-signing-key-0123456789abcdef0123456789abcdef".to_string(),
            session_ttl_seconds: 3600,
            nonce_ttl_seconds: 300,
            siwe_domain: "localhost:5173".to_string(),
            siwe_uri: "http://localhost:5173".to_string(),
            session_cookie_name: "safedeal_session".to_string(),
            csrf_cookie_name: "safedeal_csrf".to_string(),
            cookie_secure: false,
            cookie_same_site: CookieSameSite::Lax,
        })
    }

    #[test]
    fn round_trips_hs256_claims_and_rejects_alg_none_tampering_expiry_or_revoked_jti() {
        let svc = test_service();
        let now = DateTime::from_timestamp(1_770_000_000, 0).unwrap();
        let principal = AuthenticatedPrincipal {
            address: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            chain_id: 31337,
            authenticated_at: now,
            csrf_token: "csrf_abc123".to_string(),
        };

        let token = svc.create_token(&principal).unwrap();
        let session = svc
            .verify_session_token_at(&token, now + Duration::seconds(10))
            .unwrap();
        assert_eq!(
            session.principal.address,
            principal.address.to_ascii_lowercase()
        );
        assert_eq!(session.principal.chain_id, 31337);
        assert_eq!(session.principal.csrf_token, "csrf_abc123");
        assert!(Uuid::parse_str(&session.jti).is_ok());

        // Expired token rejected
        assert!(svc
            .verify_token_at(&token, now + Duration::seconds(3600))
            .is_none());

        // Alg=none forged token rejected
        let mut parts: Vec<&str> = token.split('.').collect();
        let none_header = URL_SAFE_NO_PAD.encode(br#"{"alg":"none","typ":"JWT"}"#);
        parts[0] = &none_header;
        let forged = format!("{}.{}.", parts[0], parts[1]);
        assert!(svc.verify_token_at(&forged, now).is_none());

        // Signed with wrong secret rejected
        let mut altered = token.clone();
        altered.pop();
        altered.push(if token.ends_with('A') { 'B' } else { 'A' });
        assert!(svc.verify_token_at(&altered, now).is_none());

        // Revoked jti immediately rejected across clones sharing the revocation cache
        let cloned_svc = svc.clone();
        svc.revoke_jti_at(&session.jti, session.expires_at, now);
        assert!(cloned_svc
            .verify_token_at(&token, now + Duration::seconds(15))
            .is_none());
    }
}
