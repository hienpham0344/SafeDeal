use std::collections::HashMap;
use std::env;
use std::fmt;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use safedeal_application::auth::SiweSettings;
use safedeal_shared::EthFormatValidator;

const PLACEHOLDER_SECRET_WORDS: &[&str] = &[
    "change-me",
    "changeme",
    "replace-with",
    "placeholder",
    "dev-only",
    "test-only",
    "example",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CookieSameSite {
    Lax,
    Strict,
    None,
}

impl CookieSameSite {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lax => "Lax",
            Self::Strict => "Strict",
            Self::None => "None",
        }
    }

    pub fn parse(raw: &str) -> Result<Self, ConfigError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "lax" => Ok(Self::Lax),
            "strict" => Ok(Self::Strict),
            "none" => Ok(Self::None),
            other => Err(ConfigError::new(format!(
                "Invalid COOKIE_SAME_SITE value '{other}'. Allowed: Lax, Strict, None."
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub profiles: Vec<String>,
    pub server_host: String,
    pub server_port: u16,
    pub database: DatabaseConfig,
    pub auth: AuthSecurityConfig,
    pub cors: CorsConfig,
    pub blockchain: BlockchainConfig,
    pub evidence: EvidenceConfig,
    pub rate_limit: RateLimitConfig,
    pub swagger_ui_enabled: bool,
    pub api_docs_enabled: bool,
}

#[derive(Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout_ms: u64,
}

impl fmt::Debug for DatabaseConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DatabaseConfig")
            .field("url", &"<redacted>")
            .field("max_connections", &self.max_connections)
            .field("min_connections", &self.min_connections)
            .field("acquire_timeout_ms", &self.acquire_timeout_ms)
            .finish()
    }
}

#[derive(Clone)]
pub struct AuthSecurityConfig {
    pub jwt_secret: String,
    pub session_ttl_seconds: i64,
    pub nonce_ttl_seconds: i64,
    pub siwe_domain: String,
    pub siwe_uri: String,
    pub session_cookie_name: String,
    pub csrf_cookie_name: String,
    pub cookie_secure: bool,
    pub cookie_same_site: CookieSameSite,
}

impl fmt::Debug for AuthSecurityConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthSecurityConfig")
            .field("jwt_secret", &"<redacted>")
            .field("session_ttl_seconds", &self.session_ttl_seconds)
            .field("nonce_ttl_seconds", &self.nonce_ttl_seconds)
            .field("siwe_domain", &self.siwe_domain)
            .field("siwe_uri", &self.siwe_uri)
            .field("session_cookie_name", &self.session_cookie_name)
            .field("csrf_cookie_name", &self.csrf_cookie_name)
            .field("cookie_secure", &self.cookie_secure)
            .field("cookie_same_site", &self.cookie_same_site)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct CorsConfig {
    pub allowed_origins_raw: String,
    pub allowed_origins: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct BlockchainConfig {
    pub enabled: bool,
    pub chain_id: i64,
    pub chain_name: String,
    pub rpc_url: String,
    pub escrow_contract_address: String,
    pub deployment_block: i64,
    pub confirmations_required: i32,
    pub sync_batch_size: i64,
    pub poll_interval_ms: u64,
    pub rpc_timeout_ms: u64,
}

#[derive(Debug, Clone)]
pub struct EvidenceConfig {
    pub storage_dir: String,
    pub max_bytes: usize,
    pub max_request_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub enabled: bool,
    pub auth_requests_per_minute: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    message: String,
}

impl ConfigError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ConfigError {}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let map: HashMap<String, String> = env::vars().collect();
        Self::from_map(&map)
    }

    pub fn from_map(vars: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let profiles_raw = non_empty(vars, "APP_ENV")
            .or_else(|| non_empty(vars, "SPRING_PROFILES_ACTIVE"))
            .unwrap_or_else(|| "local".to_string());
        let profiles: Vec<String> = profiles_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let profiles = if profiles.is_empty() {
            vec!["local".to_string()]
        } else {
            profiles
        };
        let is_prod_or_staging = has_prod_or_staging(&profiles);

        let server_host = non_empty(vars, "SERVER_HOST").unwrap_or_else(|| "0.0.0.0".to_string());
        let server_port = parse_u16_with_fallback(vars, "SERVER_PORT", Some("PORT"), 8080)?;

        let db_url = build_postgres_url(
            non_empty(vars, "DATABASE_URL").or_else(|| non_empty(vars, "DB_URL")),
            non_empty(vars, "DB_USERNAME"),
            vars.get("DB_PASSWORD").cloned(),
            is_prod_or_staging,
        )?;
        let database = DatabaseConfig {
            url: db_url,
            max_connections: parse_u32(vars, "DB_POOL_MAX_CONNECTIONS", 20, 1)?,
            min_connections: parse_u32(vars, "DB_POOL_MIN_CONNECTIONS", 2, 0)?,
            acquire_timeout_ms: parse_u64(vars, "DB_ACQUIRE_TIMEOUT_MS", 5000, 500)?,
        };

        let jwt_secret = vars.get("JWT_SECRET").cloned().unwrap_or_default();
        let auth = AuthSecurityConfig {
            jwt_secret,
            session_ttl_seconds: parse_i64(vars, "SESSION_TTL_SECONDS", 86400, 60)?,
            nonce_ttl_seconds: parse_i64(vars, "NONCE_TTL_SECONDS", 300, 30)?,
            siwe_domain: non_empty(vars, "SIWE_DOMAIN")
                .unwrap_or_else(|| "localhost:5173".to_string()),
            siwe_uri: non_empty(vars, "SIWE_URI")
                .unwrap_or_else(|| "http://localhost:5173".to_string()),
            session_cookie_name: non_empty(vars, "SESSION_COOKIE_NAME")
                .unwrap_or_else(|| "safedeal_session".to_string()),
            csrf_cookie_name: non_empty(vars, "CSRF_COOKIE_NAME")
                .unwrap_or_else(|| "safedeal_csrf".to_string()),
            cookie_secure: parse_bool(vars, "COOKIE_SECURE", is_prod_or_staging)?,
            cookie_same_site: CookieSameSite::parse(
                &non_empty(vars, "COOKIE_SAME_SITE").unwrap_or_else(|| {
                    if is_prod_or_staging {
                        "None".to_string()
                    } else {
                        "Lax".to_string()
                    }
                }),
            )?,
        };

        let cors_raw = non_empty(vars, "CORS_ALLOWED_ORIGINS")
            .unwrap_or_else(|| "http://localhost:5173".to_string());
        let cors = CorsConfig::from_raw(&cors_raw);

        let blockchain = BlockchainConfig {
            enabled: parse_bool(vars, "BLOCKCHAIN_SYNC_ENABLED", true)?,
            chain_id: parse_i64(vars, "CHAIN_ID", 31337, 1)?,
            chain_name: non_empty(vars, "CHAIN_NAME")
                .unwrap_or_else(|| "Anvil Local".to_string()),
            rpc_url: non_empty(vars, "AVALANCHE_RPC_URL")
                .unwrap_or_else(|| "http://127.0.0.1:8545".to_string()),
            escrow_contract_address: vars
                .get("ESCROW_CONTRACT_ADDRESS")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            deployment_block: parse_i64(vars, "ESCROW_DEPLOYMENT_BLOCK", 0, 0)?,
            confirmations_required: parse_i32(vars, "BLOCKCHAIN_CONFIRMATIONS_REQUIRED", 1, 1)?,
            sync_batch_size: parse_i64(vars, "BLOCKCHAIN_SYNC_BATCH_SIZE", 1000, 1)?,
            poll_interval_ms: parse_u64(vars, "BLOCKCHAIN_POLL_INTERVAL_MS", 10000, 500)?,
            rpc_timeout_ms: parse_u64(vars, "BLOCKCHAIN_RPC_TIMEOUT_MS", 10000, 1000)?,
        };

        let evidence_max_bytes = parse_usize(vars, "EVIDENCE_MAX_BYTES", 5 * 1024 * 1024, 1024)?;
        let evidence_max_request_bytes =
            parse_usize(vars, "EVIDENCE_MAX_REQUEST_BYTES", 6 * 1024 * 1024, 1024)?;
        if evidence_max_request_bytes < evidence_max_bytes {
            return Err(ConfigError::new(
                "EVIDENCE_MAX_REQUEST_BYTES must be greater than or equal to EVIDENCE_MAX_BYTES.",
            ));
        }

        let evidence = EvidenceConfig {
            storage_dir: non_empty(vars, "EVIDENCE_STORAGE_DIR")
                .unwrap_or_else(|| "./storage/evidence".to_string()),
            max_bytes: evidence_max_bytes,
            max_request_bytes: evidence_max_request_bytes,
        };

        let rate_limit = RateLimitConfig {
            enabled: parse_bool(vars, "RATE_LIMIT_ENABLED", true)?,
            auth_requests_per_minute: parse_usize(vars, "AUTH_RATE_LIMIT_PER_MINUTE", 30, 1)?,
        };

        let swagger_ui_enabled = parse_bool(vars, "SWAGGER_UI_ENABLED", !is_prod_or_staging)?;
        let api_docs_enabled = parse_bool(vars, "API_DOCS_ENABLED", !is_prod_or_staging)?;

        let cfg = Self {
            profiles,
            server_host,
            server_port,
            database,
            auth,
            cors,
            blockchain,
            evidence,
            rate_limit,
            swagger_ui_enabled,
            api_docs_enabled,
        };
        cfg.validate()?;
        Ok(cfg)
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        validate_common_and_production(
            &self.auth,
            &self.cors,
            &self.blockchain,
            &self.evidence,
            &self.rate_limit,
            &self.profiles,
        )
    }

    pub fn is_prod_or_staging(&self) -> bool {
        has_prod_or_staging(&self.profiles)
    }

    pub fn siwe_settings(&self) -> SiweSettings {
        SiweSettings::new(
            self.auth.siwe_domain.clone(),
            self.auth.siwe_uri.clone(),
            self.blockchain.chain_id,
            self.auth.nonce_ttl_seconds,
        )
    }
}

impl CorsConfig {
    pub fn from_raw(raw: &str) -> Self {
        let allowed_origins = raw
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .collect();
        Self {
            allowed_origins_raw: raw.to_string(),
            allowed_origins,
        }
    }
}

pub fn validate_common_and_production(
    auth: &AuthSecurityConfig,
    cors: &CorsConfig,
    chain: &BlockchainConfig,
    evidence: &EvidenceConfig,
    rate_limit: &RateLimitConfig,
    profiles: &[String],
) -> Result<(), ConfigError> {
    if auth.jwt_secret.trim().len() < 32 {
        return Err(ConfigError::new(
            "JWT_SECRET must be at least 32 characters long.",
        ));
    }
    if auth.session_ttl_seconds < 60 {
        return Err(ConfigError::new("SESSION_TTL_SECONDS must be >= 60."));
    }
    if auth.nonce_ttl_seconds < 30 {
        return Err(ConfigError::new("NONCE_TTL_SECONDS must be >= 30."));
    }
    if auth.siwe_domain.trim().is_empty() || auth.siwe_uri.trim().is_empty() {
        return Err(ConfigError::new("SIWE_DOMAIN and SIWE_URI cannot be blank."));
    }
    if auth.session_cookie_name.trim().is_empty() || auth.csrf_cookie_name.trim().is_empty() {
        return Err(ConfigError::new(
            "SESSION_COOKIE_NAME and CSRF_COOKIE_NAME cannot be blank.",
        ));
    }

    if cors.allowed_origins.is_empty() {
        return Err(ConfigError::new("CORS_ALLOWED_ORIGINS cannot be empty."));
    }
    for origin in &cors.allowed_origins {
        if origin == "*" {
            return Err(ConfigError::new(
                "CORS wildcard '*' is forbidden when credentialed cookies are enabled.",
            ));
        }
    }

    if chain.chain_id < 1 {
        return Err(ConfigError::new("CHAIN_ID must be >= 1."));
    }
    if chain.chain_name.trim().is_empty() {
        return Err(ConfigError::new("CHAIN_NAME cannot be blank."));
    }
    if chain.enabled {
        if !(chain.rpc_url.starts_with("http://") || chain.rpc_url.starts_with("https://")) {
            return Err(ConfigError::new(
                "AVALANCHE_RPC_URL must be an http/https URL when blockchain is enabled",
            ));
        }
        let contract = chain.escrow_contract_address.trim();
        if !EthFormatValidator::is_valid_address(contract)
            || EthFormatValidator::is_zero_address(contract)
        {
            return Err(ConfigError::new(
                "ESCROW_CONTRACT_ADDRESS must be configured as a valid non-zero EVM contract address when blockchain is enabled",
            ));
        }
    }

    if evidence.storage_dir.trim().is_empty() || evidence.max_bytes < 1024 {
        return Err(ConfigError::new(
            "EVIDENCE_STORAGE_DIR cannot be blank and EVIDENCE_MAX_BYTES must be >= 1024.",
        ));
    }
    if rate_limit.auth_requests_per_minute < 1 {
        return Err(ConfigError::new("AUTH_RATE_LIMIT_PER_MINUTE must be >= 1."));
    }

    validate_production_configuration(auth, cors, chain, profiles)
}

pub fn validate_production_configuration(
    auth: &AuthSecurityConfig,
    cors: &CorsConfig,
    chain: &BlockchainConfig,
    profiles: &[String],
) -> Result<(), ConfigError> {
    if !has_prod_or_staging(profiles) {
        return Ok(());
    }

    let lower_secret = auth.jwt_secret.to_ascii_lowercase();
    if PLACEHOLDER_SECRET_WORDS
        .iter()
        .any(|word| lower_secret.contains(word))
    {
        return Err(ConfigError::new(
            "Production/staging profiles forbid placeholder JWT_SECRET values.",
        ));
    }
    if !auth.cookie_secure {
        return Err(ConfigError::new(
            "COOKIE_SECURE must be true in staging/production profiles.",
        ));
    }
    if is_loopback_host_or_url(&auth.siwe_domain) || is_loopback_host_or_url(&auth.siwe_uri) {
        return Err(ConfigError::new(
            "SIWE_DOMAIN and SIWE_URI cannot point to localhost/loopback in staging/production.",
        ));
    }
    if !auth
        .siwe_uri
        .trim()
        .to_ascii_lowercase()
        .starts_with("https://")
    {
        return Err(ConfigError::new(
            "SIWE_URI must use https:// in staging/production profiles.",
        ));
    }
    for origin in &cors.allowed_origins {
        if is_loopback_host_or_url(origin) {
            return Err(ConfigError::new(
                "CORS_ALLOWED_ORIGINS cannot include localhost/loopback in staging/production.",
            ));
        }
        if !origin.trim().to_ascii_lowercase().starts_with("https://") {
            return Err(ConfigError::new(
                "CORS_ALLOWED_ORIGINS must use https:// in staging/production profiles.",
            ));
        }
    }
    if chain.enabled && is_loopback_host_or_url(&chain.rpc_url) {
        return Err(ConfigError::new(
            "AVALANCHE_RPC_URL cannot point to localhost/loopback in staging/production.",
        ));
    }

    Ok(())
}

fn has_prod_or_staging(profiles: &[String]) -> bool {
    profiles
        .iter()
        .any(|p| p.eq_ignore_ascii_case("prod") || p.eq_ignore_ascii_case("staging"))
}

fn is_loopback_host_or_url(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    let without_scheme = trimmed.split_once("://").map_or(trimmed, |(_, rest)| rest);
    let authority = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if authority.is_empty() {
        return false;
    }

    let hostport = authority
        .rsplit_once('@')
        .map_or(authority, |(_, right)| right);

    let host = if let Some(after_open) = hostport.strip_prefix('[') {
        let Some((bracketed, _)) = after_open.split_once(']') else {
            return false;
        };
        bracketed.split('%').next().unwrap_or(bracketed)
    } else if hostport.parse::<std::net::IpAddr>().is_ok() {
        hostport
    } else if let Some((h, port)) = hostport.rsplit_once(':') {
        if !h.contains(':') && !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
            h
        } else {
            hostport
        }
    } else {
        hostport
    };

    let host_lower = host.trim_end_matches('.').to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return true;
    }

    if let Ok(ip) = host_lower.parse::<std::net::IpAddr>() {
        return is_loopback_or_unspecified_ip(ip);
    }

    false
}

fn is_loopback_or_unspecified_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_unspecified(),
        std::net::IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return v4.is_loopback() || v4.is_unspecified();
            }
            let seg = v6.segments();
            seg[..6] == [0, 0, 0, 0, 0, 0] && ((seg[6] >> 8) == 127 || (seg[6] == 0 && seg[7] == 0))
        }
    }
}

pub fn build_postgres_url(
    raw_url: Option<String>,
    username: Option<String>,
    password: Option<String>,
    is_prod_or_staging: bool,
) -> Result<String, ConfigError> {
    let url = match raw_url {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ if !is_prod_or_staging => "postgresql://localhost:5432/safedeal".to_string(),
        _ => {
            return Err(ConfigError::new(
                "DATABASE_URL or DB_URL must be configured in staging/prod.",
            ))
        }
    };

    let stripped = url.strip_prefix("jdbc:").unwrap_or(&url);
    let (scheme, rest) = if let Some(r) = stripped.strip_prefix("postgresql://") {
        ("postgresql://", r)
    } else if let Some(r) = stripped.strip_prefix("postgres://") {
        ("postgres://", r)
    } else {
        return Err(ConfigError::new(
            "Database URL must start with postgres://, postgresql://, or jdbc:postgresql://.",
        ));
    };

    let (authority, path_and_query) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };

    if authority.contains('@') {
        if is_prod_or_staging {
            let (userinfo, hostport) = authority.rsplit_once('@').unwrap_or(("", ""));
            let has_nonempty_creds = userinfo
                .split_once(':')
                .is_some_and(|(u, p)| !u.is_empty() && !p.is_empty());
            if !has_nonempty_creds || hostport.is_empty() {
                return Err(ConfigError::new(
                    "Database URL must include non-empty username and password in staging/prod.",
                ));
            }
        }
        return Ok(format!("{scheme}{rest}"));
    }

    let effective_user = match username {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ if !is_prod_or_staging => "safedeal".to_string(),
        _ => {
            return Err(ConfigError::new(
                "Database URL must include user credentials or DB_USERNAME in staging/prod.",
            ))
        }
    };
    let effective_pass = match password {
        Some(p) if !is_prod_or_staging || !p.trim().is_empty() => p,
        None if !is_prod_or_staging => "safedeal".to_string(),
        _ => {
            return Err(ConfigError::new(
                "DB_PASSWORD must be non-empty in staging/prod.",
            ))
        }
    };

    let enc_user = utf8_percent_encode(&effective_user, NON_ALPHANUMERIC).to_string();
    if effective_pass.is_empty() {
        Ok(format!("{scheme}{enc_user}@{authority}{path_and_query}"))
    } else {
        let enc_pass = utf8_percent_encode(&effective_pass, NON_ALPHANUMERIC).to_string();
        Ok(format!(
            "{scheme}{enc_user}:{enc_pass}@{authority}{path_and_query}"
        ))
    }
}

fn non_empty(vars: &HashMap<String, String>, key: &str) -> Option<String> {
    vars.get(key)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn parse_bool(vars: &HashMap<String, String>, key: &str, default: bool) -> Result<bool, ConfigError> {
    match non_empty(vars, key) {
        None => Ok(default),
        Some(v) => match v.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" => Ok(false),
            other => Err(ConfigError::new(format!(
                "Invalid boolean env {key}='{other}'."
            ))),
        },
    }
}

fn parse_u16_with_fallback(
    vars: &HashMap<String, String>,
    primary: &str,
    fallback: Option<&str>,
    default: u16,
) -> Result<u16, ConfigError> {
    let selected = non_empty(vars, primary)
        .map(|v| (primary, v))
        .or_else(|| fallback.and_then(|fb| non_empty(vars, fb).map(|v| (fb, v))));
    match selected {
        None => Ok(default),
        Some((key, v)) => v
            .parse::<u16>()
            .map_err(|_| ConfigError::new(format!("Invalid u16 env {key}='{v}'."))),
    }
}

fn parse_u32(
    vars: &HashMap<String, String>,
    key: &str,
    default: u32,
    min: u32,
) -> Result<u32, ConfigError> {
    let val = match non_empty(vars, key) {
        None => default,
        Some(v) => v
            .parse::<u32>()
            .map_err(|_| ConfigError::new(format!("Invalid u32 env {key}='{v}'.")))?,
    };
    if val < min {
        return Err(ConfigError::new(format!("{key} must be >= {min}.")));
    }
    Ok(val)
}

fn parse_i32(
    vars: &HashMap<String, String>,
    key: &str,
    default: i32,
    min: i32,
) -> Result<i32, ConfigError> {
    let val = match non_empty(vars, key) {
        None => default,
        Some(v) => v
            .parse::<i32>()
            .map_err(|_| ConfigError::new(format!("Invalid i32 env {key}='{v}'.")))?,
    };
    if val < min {
        return Err(ConfigError::new(format!("{key} must be >= {min}.")));
    }
    Ok(val)
}

fn parse_i64(
    vars: &HashMap<String, String>,
    key: &str,
    default: i64,
    min: i64,
) -> Result<i64, ConfigError> {
    let val = match non_empty(vars, key) {
        None => default,
        Some(v) => v
            .parse::<i64>()
            .map_err(|_| ConfigError::new(format!("Invalid i64 env {key}='{v}'.")))?,
    };
    if val < min {
        return Err(ConfigError::new(format!("{key} must be >= {min}.")));
    }
    Ok(val)
}

fn parse_u64(
    vars: &HashMap<String, String>,
    key: &str,
    default: u64,
    min: u64,
) -> Result<u64, ConfigError> {
    let val = match non_empty(vars, key) {
        None => default,
        Some(v) => v
            .parse::<u64>()
            .map_err(|_| ConfigError::new(format!("Invalid u64 env {key}='{v}'.")))?,
    };
    if val < min {
        return Err(ConfigError::new(format!("{key} must be >= {min}.")));
    }
    Ok(val)
}

fn parse_usize(
    vars: &HashMap<String, String>,
    key: &str,
    default: usize,
    min: usize,
) -> Result<usize, ConfigError> {
    let val = match non_empty(vars, key) {
        None => default,
        Some(v) => v
            .parse::<usize>()
            .map_err(|_| ConfigError::new(format!("Invalid usize env {key}='{v}'.")))?,
    };
    if val < min {
        return Err(ConfigError::new(format!("{key} must be >= {min}.")));
    }
    Ok(val)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_prod_auth() -> AuthSecurityConfig {
        AuthSecurityConfig {
            jwt_secret: format!("unit-test-signing-key-{}", "0123456789abcdef".repeat(2)),
            session_ttl_seconds: 86400,
            nonce_ttl_seconds: 300,
            siwe_domain: "app.safedeal.network".to_string(),
            siwe_uri: "https://app.safedeal.network".to_string(),
            session_cookie_name: "safedeal_session".to_string(),
            csrf_cookie_name: "safedeal_csrf".to_string(),
            cookie_secure: true,
            cookie_same_site: CookieSameSite::None,
        }
    }

    fn valid_prod_cors() -> CorsConfig {
        CorsConfig::from_raw("https://app.safedeal.network")
    }

    fn valid_prod_chain() -> BlockchainConfig {
        BlockchainConfig {
            enabled: true,
            chain_id: 43113,
            chain_name: "Avalanche Fuji".to_string(),
            rpc_url: "https://api.avax-test.network/ext/bc/C/rpc".to_string(),
            escrow_contract_address: "0x5FbDB2315678afecb367f032d93F642f64180aa3".to_string(),
            deployment_block: 0,
            confirmations_required: 1,
            sync_batch_size: 1000,
            poll_interval_ms: 10000,
            rpc_timeout_ms: 10000,
        }
    }

    #[test]
    fn rejects_placeholder_jwt_and_loopback_urls_in_prod_and_staging() {
        let mut replace_with = valid_prod_auth();
        replace_with.jwt_secret =
            "replace-with-a-cryptographically-random-secret-at-least-32-chars".to_string();
        let err = validate_production_configuration(
            &replace_with,
            &valid_prod_cors(),
            &valid_prod_chain(),
            &["prod".to_string()],
        )
        .unwrap_err();
        assert!(err.to_string().contains("JWT_SECRET"));

        let mut local_siwe = valid_prod_auth();
        local_siwe.siwe_uri = "http://localhost:5173".to_string();
        let err = validate_production_configuration(
            &local_siwe,
            &valid_prod_cors(),
            &valid_prod_chain(),
            &["staging".to_string()],
        )
        .unwrap_err();
        assert!(err.to_string().contains("SIWE"));

        let local_cors = CorsConfig::from_raw("http://127.0.0.1:5173");
        let err = validate_production_configuration(
            &valid_prod_auth(),
            &local_cors,
            &valid_prod_chain(),
            &["prod".to_string()],
        )
        .unwrap_err();
        assert!(err.to_string().contains("CORS_ALLOWED_ORIGINS"));

        let mut local_rpc = valid_prod_chain();
        local_rpc.rpc_url = "http://127.0.0.1:8545".to_string();
        let err = validate_production_configuration(
            &valid_prod_auth(),
            &valid_prod_cors(),
            &local_rpc,
            &["prod".to_string()],
        )
        .unwrap_err();
        assert!(err.to_string().contains("AVALANCHE_RPC_URL"));

        validate_production_configuration(
            &valid_prod_auth(),
            &valid_prod_cors(),
            &valid_prod_chain(),
            &["prod".to_string()],
        )
        .unwrap();

        validate_production_configuration(
            &replace_with,
            &local_cors,
            &local_rpc,
            &["local".to_string()],
        )
        .unwrap();
    }

    #[test]
    fn normalizes_jdbc_and_database_url_with_credentials() {
        assert_eq!(
            build_postgres_url(
                Some("jdbc:postgresql://127.0.0.1:15433/safedeal?sslmode=disable".to_string()),
                Some("safedeal".to_string()),
                Some("p@ss/word".to_string()),
                false
            )
            .unwrap(),
            "postgresql://safedeal:p%40ss%2Fword@127.0.0.1:15433/safedeal?sslmode=disable"
        );
        assert_eq!(
            build_postgres_url(
                Some("postgresql://pguser:pgpass@db.internal:5432/prod".to_string()),
                Some("ignored".to_string()),
                Some("ignored".to_string()),
                true
            )
            .unwrap(),
            "postgresql://pguser:pgpass@db.internal:5432/prod"
        );
    }

    #[test]
    fn loads_defaults_from_minimal_local_map_and_rejects_short_jwt_or_wildcard_cors() {
        let mut vars = HashMap::new();
        vars.insert(
            "JWT_SECRET".to_string(),
            "0123456789abcdef0123456789abcdef".to_string(),
        );
        vars.insert("BLOCKCHAIN_SYNC_ENABLED".to_string(), "false".to_string());
        let cfg = AppConfig::from_map(&vars).unwrap();
        assert_eq!(cfg.profiles, vec!["local"]);
        assert!(cfg.swagger_ui_enabled);
        assert!(!cfg.auth.cookie_secure);
        assert_eq!(cfg.auth.cookie_same_site, CookieSameSite::Lax);

        assert_eq!(cfg.server_port, 8080);

        vars.insert("PORT".to_string(), "9090".to_string());
        let port_cfg = AppConfig::from_map(&vars).unwrap();
        assert_eq!(port_cfg.server_port, 9090);

        vars.insert("SERVER_PORT".to_string(), "8085".to_string());
        let override_cfg = AppConfig::from_map(&vars).unwrap();
        assert_eq!(override_cfg.server_port, 8085);

        vars.insert("CORS_ALLOWED_ORIGINS".to_string(), "*".to_string());
        assert!(AppConfig::from_map(&vars).is_err());
    }

    #[test]
    fn enforces_https_and_rejects_loopback_variants_and_empty_db_password_in_prod() {
        assert!(is_loopback_host_or_url("localhost:5173"));
        assert!(is_loopback_host_or_url("http://sub.localhost.:8080/api"));
        assert!(is_loopback_host_or_url("http://127.0.0.2:8545"));
        assert!(is_loopback_host_or_url("http://0.0.0.0:8080"));
        assert!(is_loopback_host_or_url("http://[::1]:5173"));
        assert!(is_loopback_host_or_url("http://[::ffff:127.0.0.1]:8545"));
        assert!(!is_loopback_host_or_url("https://not-localhost.example.com"));
        assert!(!is_loopback_host_or_url("app.safedeal.network"));

        let mut http_siwe = valid_prod_auth();
        http_siwe.siwe_uri = "http://app.safedeal.network".to_string();
        let err = validate_production_configuration(
            &http_siwe,
            &valid_prod_cors(),
            &valid_prod_chain(),
            &["prod".to_string()],
        )
        .unwrap_err();
        assert!(err.to_string().contains("https://"));

        let http_cors = CorsConfig::from_raw("http://app.safedeal.network");
        let err = validate_production_configuration(
            &valid_prod_auth(),
            &http_cors,
            &valid_prod_chain(),
            &["staging".to_string()],
        )
        .unwrap_err();
        assert!(err.to_string().contains("https://"));

        assert!(build_postgres_url(
            Some("postgresql://db.internal:5432/prod".to_string()),
            Some("pguser".to_string()),
            None,
            true,
        )
        .is_err());
        assert!(build_postgres_url(
            Some("postgresql://pguser@db.internal:5432/prod".to_string()),
            None,
            None,
            true,
        )
        .is_err());
    }
}
