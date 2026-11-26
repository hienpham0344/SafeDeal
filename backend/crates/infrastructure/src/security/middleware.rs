use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::connect_info::MockConnectInfo;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::{self, HeaderName, HeaderValue};
use axum::http::{Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use chrono::Utc;
use safedeal_domain::auth::AuthenticatedPrincipal;
use safedeal_domain::ports::RevokedSessionRepository;
use safedeal_shared::{
    format_iso_utc, is_valid_correlation_id, with_correlation_id, CorrelationIdContext,
    CORRELATION_ID_HEADER,
};
use serde::Serialize;
use subtle::ConstantTimeEq;
use tower_http::cors::CorsLayer;
use tracing::Instrument;
use uuid::Uuid;

use crate::config::{AppConfig, CorsConfig};
use crate::security::jwt::JwtSessionService;
use crate::security::rate_limit::{
    AuthRateLimitState, WALLET_DEAL_DRAFTS_LIMIT_PER_MINUTE, WALLET_DEAL_SYNC_LIMIT_PER_MINUTE,
    WALLET_DISPUTE_EVIDENCE_LIMIT_PER_MINUTE,
};

#[derive(Clone, Copy, Debug)]
struct AuthSessionMeta {
    via_cookie: bool,
}

#[derive(Clone)]
pub struct SecurityMiddlewareState {
    pub jwt_service: JwtSessionService,
    pub rate_limiter: Arc<AuthRateLimitState>,
    pub revoked_sessions: Option<Arc<dyn RevokedSessionRepository>>,
    pub session_cookie_name: String,
    pub csrf_cookie_name: String,
    pub trust_proxy_headers: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityErrorPayload<'a> {
    code: &'a str,
    message: &'a str,
    correlation_id: String,
    timestamp: String,
    field_errors: Option<()>,
}

pub fn api_error_response(status: StatusCode, code: &str, message: &str) -> Response {
    let correlation_id = CorrelationIdContext::get_or_default("n/a");
    let body = SecurityErrorPayload {
        code,
        message,
        correlation_id,
        timestamp: format_iso_utc(Utc::now()),
        field_errors: None,
    };
    (status, Json(body)).into_response()
}

pub fn build_cors_layer(cors: &CorsConfig) -> Result<CorsLayer, String> {
    let mut origins = Vec::with_capacity(cors.allowed_origins.len());
    for origin in &cors.allowed_origins {
        let hv = HeaderValue::from_str(origin)
            .map_err(|e| format!("Invalid CORS origin '{origin}': {e}"))?;
        origins.push(hv);
    }

    Ok(CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("x-csrf-token"),
            HeaderName::from_static("x-correlation-id"),
        ])
        .expose_headers([HeaderName::from_static("x-correlation-id")])
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600)))
}

pub fn apply_security_layers(
    router: Router,
    config: &AppConfig,
    jwt_service: JwtSessionService,
    rate_limiter: Arc<AuthRateLimitState>,
) -> Result<Router, String> {
    apply_security_layers_with_revocation(router, config, jwt_service, rate_limiter, None)
}

pub fn apply_security_layers_with_revocation(
    router: Router,
    config: &AppConfig,
    jwt_service: JwtSessionService,
    rate_limiter: Arc<AuthRateLimitState>,
    revoked_sessions: Option<Arc<dyn RevokedSessionRepository>>,
) -> Result<Router, String> {
    let cors_layer = build_cors_layer(&config.cors)?;
    let state = Arc::new(SecurityMiddlewareState {
        jwt_service,
        rate_limiter,
        revoked_sessions,
        session_cookie_name: config.auth.session_cookie_name.clone(),
        csrf_cookie_name: config.auth.csrf_cookie_name.clone(),
        trust_proxy_headers: config.rate_limit.trust_proxy_headers,
    });

    Ok(router
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            wallet_rate_limit_middleware,
        ))
        .layer(middleware::from_fn(require_auth_middleware))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            double_submit_csrf_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            session_auth_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state,
            auth_rate_limit_middleware,
        ))
        .layer(cors_layer)
        .layer(middleware::from_fn(
            correlation_and_security_headers_middleware,
        )))
}

/// Returns true iff `ip` belongs to loopback, RFC 1918 private IPv4 (`10/8`, `172.16/12`, `192.168/16`),
/// RFC 6598 Carrier-Grade NAT (`100.64.0.0/10` used by Railway internal load balancers),
/// or RFC 4193 unique-local IPv6 (`fc00::/7`).
pub fn is_trusted_proxy_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_loopback() || v4.is_private() {
                return true;
            }
            let octets = v4.octets();
            octets[0] == 100 && (octets[1] & 0b1100_0000) == 64
        }
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_trusted_proxy_peer(IpAddr::V4(mapped_v4));
            }
            v6.is_loopback() || (v6.octets()[0] & 0xfe) == 0xfc
        }
    }
}

pub fn extract_client_ip(req: &Request<Body>, trust_proxy_headers: bool) -> String {
    let peer_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip())
        .or_else(|| {
            req.extensions()
                .get::<MockConnectInfo<SocketAddr>>()
                .map(|ci| ci.0.ip())
        });

    if trust_proxy_headers && peer_ip.is_some_and(is_trusted_proxy_peer) {
        if let Some(xff_raw) = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
        {
            let parsed_hops: Vec<IpAddr> = xff_raw
                .split(',')
                .map(str::trim)
                .filter_map(|part| part.parse::<IpAddr>().ok())
                .collect();
            if let Some(client_ip) = parsed_hops
                .iter()
                .rev()
                .copied()
                .find(|&ip| !is_trusted_proxy_peer(ip))
                .or_else(|| parsed_hops.last().copied())
            {
                return client_ip.to_string();
            }
        }

        if let Some(real_ip) = req
            .headers()
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .and_then(|s| s.parse::<IpAddr>().ok())
        {
            return real_ip.to_string();
        }
    }

    peer_ip
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn wallet_mutation_rate_limit(method: &Method, path: &str) -> Option<(&'static str, usize)> {
    if *method != Method::POST {
        return None;
    }
    if path == "/api/v1/deals/drafts" {
        return Some(("deals_drafts", WALLET_DEAL_DRAFTS_LIMIT_PER_MINUTE));
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() == 6
        && parts[0].is_empty()
        && parts[1] == "api"
        && parts[2] == "v1"
        && !parts[4].is_empty()
    {
        if parts[3] == "deals" && parts[5] == "sync" {
            return Some(("deals_sync", WALLET_DEAL_SYNC_LIMIT_PER_MINUTE));
        }
        if parts[3] == "disputes" && parts[5] == "evidence" {
            return Some((
                "disputes_evidence",
                WALLET_DISPUTE_EVIDENCE_LIMIT_PER_MINUTE,
            ));
        }
    }
    None
}

async fn correlation_and_security_headers_middleware(req: Request<Body>, next: Next) -> Response {
    let incoming = req
        .headers()
        .get(CORRELATION_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim);
    let correlation_id = match incoming {
        Some(val) if is_valid_correlation_id(val) => val.to_string(),
        _ => Uuid::new_v4().to_string(),
    };

    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let span = tracing::info_span!(
        "http_request",
        correlation_id = %correlation_id,
        method = %method,
        path = %path
    );

    let mut response =
        with_correlation_id(correlation_id.clone(), next.run(req).instrument(span)).await;

    let headers = response.headers_mut();
    if let Ok(cid_header) = HeaderValue::from_str(&correlation_id) {
        headers.insert(HeaderName::from_static("x-correlation-id"), cid_header);
    }
    headers.insert(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=63072000; includeSubDomains"),
    );
    let is_swagger_asset =
        path == "/swagger-ui" || path == "/swagger-ui.html" || path.starts_with("/swagger-ui/");
    if is_swagger_asset {
        headers.insert(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static("frame-ancestors 'none'"),
        );
    } else {
        headers.insert(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
        );
    }
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    if path.starts_with("/api/v1/") && !path.starts_with("/api/v1/health") {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

async fn auth_rate_limit_middleware(
    State(state): State<Arc<SecurityMiddlewareState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if state.rate_limiter.is_enabled()
        && req.method() != Method::OPTIONS
        && AuthRateLimitState::is_rate_limited_path(path)
    {
        let key = extract_client_ip(&req, state.trust_proxy_headers);
        if !state.rate_limiter.allow_request(&key) {
            return api_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Too many authentication requests. Please retry in one minute.",
            );
        }
    }
    next.run(req).await
}

async fn wallet_rate_limit_middleware(
    State(state): State<Arc<SecurityMiddlewareState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if state.rate_limiter.is_enabled() {
        if let Some((bucket, max_per_minute)) =
            wallet_mutation_rate_limit(req.method(), req.uri().path())
        {
            if let Some(principal) = req.extensions().get::<AuthenticatedPrincipal>() {
                let wallet_key = format!("{bucket}:{}", principal.address.to_ascii_lowercase());
                if !state
                    .rate_limiter
                    .allow_wallet_request(&wallet_key, max_per_minute)
                {
                    return api_error_response(
                        StatusCode::TOO_MANY_REQUESTS,
                        "RATE_LIMITED",
                        "Too many requests for this wallet. Please retry in one minute.",
                    );
                }
            }
        }
    }
    next.run(req).await
}

async fn verify_token_not_revoked(
    state: &SecurityMiddlewareState,
    raw_token: &str,
) -> Option<AuthenticatedPrincipal> {
    let now = Utc::now();
    let session = state.jwt_service.verify_session_token_at(raw_token, now)?;
    if !session.jti.is_empty() {
        if let Some(ref repo) = state.revoked_sessions {
            match repo.is_revoked(&session.jti, now).await {
                Ok(true) => {
                    state
                        .jwt_service
                        .revoke_jti_at(&session.jti, session.expires_at, now);
                    return None;
                }
                Ok(false) => {}
                Err(err) => {
                    tracing::error!(error = %err, "Failed checking session revocation status");
                    return None;
                }
            }
        }
    }
    Some(session.principal)
}

async fn session_auth_middleware(
    State(state): State<Arc<SecurityMiddlewareState>>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let mut resolved: Option<(AuthenticatedPrincipal, bool)> = None;

    // 1. Check Authorization: Bearer FIRST (via_cookie = false) to avoid cross-origin 3P cookie CSRF race.
    if let Some(auth_val) = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(bearer) = auth_val.strip_prefix("Bearer ") {
            let trimmed = bearer.trim();
            if !trimmed.is_empty() {
                if let Some(principal) = verify_token_not_revoked(&state, trimmed).await {
                    resolved = Some((principal, false));
                }
            }
        }
    }

    // 2. Fall back to HttpOnly session cookie (via_cookie = true, requires double-submit CSRF on mutations).
    if resolved.is_none() {
        if let Some(cookie_tok) = extract_cookie(req.headers(), &state.session_cookie_name) {
            if let Some(principal) = verify_token_not_revoked(&state, &cookie_tok).await {
                resolved = Some((principal, true));
            }
        }
    }

    if let Some((principal, via_cookie)) = resolved {
        req.extensions_mut().insert(principal);
        req.extensions_mut().insert(AuthSessionMeta { via_cookie });
    }

    next.run(req).await
}

async fn double_submit_csrf_middleware(
    State(state): State<Arc<SecurityMiddlewareState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let via_cookie = req
        .extensions()
        .get::<AuthSessionMeta>()
        .is_some_and(|meta| meta.via_cookie);
    let path = req.uri().path();

    if matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS) {
        if *req.method() == Method::GET && via_cookie && path.ends_with("/download") {
            let is_cross_site = req
                .headers()
                .get("sec-fetch-site")
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("cross-site"));
            if is_cross_site {
                return api_error_response(
                    StatusCode::FORBIDDEN,
                    "CSRF_VALIDATION_FAILED",
                    "Cross-site cookie-authenticated downloads are forbidden.",
                );
            }
        }
        return next.run(req).await;
    }

    if path == "/api/v1/auth/nonce" || path == "/api/v1/auth/verify" {
        return next.run(req).await;
    }

    let principal = req.extensions().get::<AuthenticatedPrincipal>();

    if via_cookie {
        if let Some(principal) = principal {
            let header_token = req
                .headers()
                .get("x-csrf-token")
                .and_then(|v| v.to_str().ok());
            let cookie_token = extract_cookie(req.headers(), &state.csrf_cookie_name);

            let valid = match (header_token, cookie_token.as_deref()) {
                (Some(h), Some(c)) if !h.is_empty() && !c.is_empty() => {
                    ct_str_eq(h, c) && ct_str_eq(h, &principal.csrf_token)
                }
                _ => false,
            };

            if !valid {
                return api_error_response(
                    StatusCode::FORBIDDEN,
                    "CSRF_VALIDATION_FAILED",
                    "Missing or invalid CSRF protection token.",
                );
            }
        }
    }

    next.run(req).await
}

async fn require_auth_middleware(req: Request<Body>, next: Next) -> Response {
    let method = req.method();
    let path = req.uri().path();
    let is_public = *method == Method::OPTIONS
        || matches!(
            path,
            "/api/v1/health"
                | "/api/v1/health/ready"
                | "/actuator/health"
                | "/actuator/health/readiness"
                | "/actuator/health/liveness"
                | "/actuator/info"
                | "/v3/api-docs"
                | "/swagger-ui"
                | "/swagger-ui.html"
        )
        || path.starts_with("/v3/api-docs/")
        || path.starts_with("/swagger-ui/")
        || (*method == Method::POST
            && matches!(
                path,
                "/api/v1/auth/nonce" | "/api/v1/auth/verify" | "/api/v1/auth/logout"
            ));

    if !is_public && req.extensions().get::<AuthenticatedPrincipal>().is_none() {
        return api_error_response(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Wallet authentication required.",
        );
    }

    next.run(req).await
}

fn ct_str_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    ab.len() == bb.len() && bool::from(ab.ct_eq(bb))
}

pub fn extract_cookie(headers: &axum::http::HeaderMap, target_name: &str) -> Option<String> {
    for hv in headers.get_all(header::COOKIE) {
        let Ok(raw) = hv.to_str() else {
            continue;
        };
        for pair in raw.split(';') {
            let trimmed = pair.trim();
            if let Some((name, val)) = trimmed.split_once('=') {
                if name.trim() == target_name {
                    let v = val.trim();
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthSecurityConfig, CookieSameSite, RateLimitConfig};
    use axum::extract::connect_info::MockConnectInfo;
    use axum::routing::{get, post};
    use http_body_util::BodyExt;
    use std::collections::HashMap;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use tower::ServiceExt;

    fn test_config(auth_rpm: usize) -> AppConfig {
        let mut vars = HashMap::new();
        vars.insert(
            "JWT_SECRET".to_string(),
            "unit-test-signing-key-0123456789abcdef0123456789abcdef".to_string(),
        );
        vars.insert("BLOCKCHAIN_SYNC_ENABLED".to_string(), "false".to_string());
        vars.insert(
            "AUTH_RATE_LIMIT_PER_MINUTE".to_string(),
            auth_rpm.to_string(),
        );
        AppConfig::from_map(&vars).unwrap()
    }

    #[tokio::test]
    async fn rate_limit_ignores_x_forwarded_for_from_untrusted_peers_and_sets_security_headers() {
        let cfg = test_config(2);
        let jwt = JwtSessionService::new(&cfg.auth);
        let limiter = Arc::new(AuthRateLimitState::new(&RateLimitConfig {
            enabled: true,
            auth_requests_per_minute: 2,
            trust_proxy_headers: false,
        }));
        let inner = Router::new()
            .route("/api/v1/health", get(|| async { "up" }))
            .route("/api/v1/auth/nonce", post(|| async { "ok" }))
            .route("/api/v1/auth/verify", post(|| async { "ok" }));
        let base_app = apply_security_layers(inner, &cfg, jwt, limiter).unwrap();
        let peer_a_app = base_app.clone().layer(MockConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(198, 51, 100, 10)),
            4444,
        )));

        // Health endpoint sets HSTS/CSP/Referrer-Policy without Cache-Control: no-store
        let health_res = peer_a_app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health_res.status(), StatusCode::OK);
        assert_eq!(
            health_res
                .headers()
                .get("strict-transport-security")
                .unwrap(),
            "max-age=63072000; includeSubDomains"
        );
        assert_eq!(
            health_res.headers().get("content-security-policy").unwrap(),
            "default-src 'none'; frame-ancestors 'none'"
        );
        assert!(health_res.headers().get(header::CACHE_CONTROL).is_none());

        for i in 0..2 {
            let req = Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/nonce")
                .header("X-Forwarded-For", format!("203.0.113.{}", i + 1))
                .body(Body::empty())
                .unwrap();
            let res = peer_a_app.clone().oneshot(req).await.unwrap();
            assert_eq!(res.status(), StatusCode::OK);
            assert_eq!(res.headers().get("x-frame-options").unwrap(), "DENY");
            assert_eq!(
                res.headers().get("x-content-type-options").unwrap(),
                "nosniff"
            );
            assert_eq!(
                res.headers().get("referrer-policy").unwrap(),
                "strict-origin-when-cross-origin"
            );
            assert_eq!(
                res.headers().get(header::CACHE_CONTROL).unwrap(),
                "no-store"
            );
            assert!(res.headers().get("x-correlation-id").is_some());
        }

        let spoofed = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/auth/verify")
            .header("X-Forwarded-For", "203.0.113.99")
            .body(Body::empty())
            .unwrap();
        let res = peer_a_app.oneshot(spoofed).await.unwrap();
        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let txt = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(txt.contains("RATE_LIMITED"));

        let other_peer_app = base_app.layer(MockConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(198, 51, 100, 11)),
            4445,
        )));
        let other_req = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/auth/nonce")
            .body(Body::empty())
            .unwrap();
        let other_res = other_peer_app.oneshot(other_req).await.unwrap();
        assert_eq!(other_res.status(), StatusCode::OK);
    }

    #[test]
    fn trusts_proxy_headers_only_from_loopback_private_cgnat_or_ula_peers() {
        assert!(is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            10, 0, 1, 5
        ))));
        assert!(is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            172, 16, 5, 1
        ))));
        assert!(is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            192, 168, 1, 10
        ))));
        // Railway internal CGNAT 100.64.0.0/10
        assert!(is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            100, 64, 0, 1
        ))));
        assert!(is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            100, 127, 255, 254
        ))));
        assert!(!is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            100, 128, 0, 1
        ))));
        assert!(!is_trusted_proxy_peer(IpAddr::V4(Ipv4Addr::new(
            198, 51, 100, 10
        ))));
        // IPv6 loopback and fc00::/7 ULA
        assert!(is_trusted_proxy_peer(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_trusted_proxy_peer("fd12:3456::1".parse().unwrap()));
        assert!(!is_trusted_proxy_peer(
            "2001:db8::1".parse::<IpAddr>().unwrap()
        ));

        // Railway CGNAT peer + spoofed client XFF -> selects rightmost non-proxy client IP
        let mut req_cgnat = Request::builder()
            .header("X-Forwarded-For", "1.1.1.1, 203.0.113.42, 100.64.2.9")
            .body(Body::empty())
            .unwrap();
        req_cgnat
            .extensions_mut()
            .insert(MockConnectInfo(SocketAddr::new(
                IpAddr::V4(Ipv4Addr::new(100, 64, 1, 2)),
                8080,
            )));
        assert_eq!(extract_client_ip(&req_cgnat, true), "203.0.113.42");
        assert_eq!(extract_client_ip(&req_cgnat, false), "100.64.1.2");

        // Public direct peer with trust_proxy_headers=true MUST NOT trust spoofed X-Forwarded-For
        let mut req_public = Request::builder()
            .header("X-Forwarded-For", "203.0.113.42")
            .header("X-Real-Ip", "203.0.113.43")
            .body(Body::empty())
            .unwrap();
        req_public
            .extensions_mut()
            .insert(MockConnectInfo(SocketAddr::new(
                IpAddr::V4(Ipv4Addr::new(198, 51, 100, 77)),
                8080,
            )));
        assert_eq!(extract_client_ip(&req_public, true), "198.51.100.77");
    }

    #[tokio::test]
    async fn prioritizes_bearer_over_cookie_blocks_cross_site_cookie_downloads_revokes_jti_and_rate_limits_wallets(
    ) {
        let mut cfg = test_config(30);
        cfg.auth = AuthSecurityConfig {
            jwt_secret: "unit-test-signing-key-0123456789abcdef0123456789abcdef".to_string(),
            session_ttl_seconds: 3600,
            nonce_ttl_seconds: 300,
            siwe_domain: "localhost:5173".to_string(),
            siwe_uri: "http://localhost:5173".to_string(),
            session_cookie_name: "safedeal_session".to_string(),
            csrf_cookie_name: "safedeal_csrf".to_string(),
            cookie_secure: false,
            cookie_same_site: CookieSameSite::Lax,
        };
        let jwt = JwtSessionService::new(&cfg.auth);
        let limiter = Arc::new(AuthRateLimitState::new(&cfg.rate_limit));
        let principal = AuthenticatedPrincipal {
            address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".to_string(),
            chain_id: 31337,
            authenticated_at: Utc::now(),
            csrf_token: "csrf_token_xyz".to_string(),
        };
        let token = jwt.create_token(&principal).unwrap();
        let session_info = jwt.verify_session_token(&token).unwrap();

        let inner = Router::new()
            .route("/api/v1/deals/drafts", post(|| async { "created" }))
            .route(
                "/api/v1/disputes/{disputeId}/evidence",
                post(|| async { "uploaded" }),
            )
            .route(
                "/api/v1/disputes/{disputeId}/evidence/{evidenceId}/download",
                get(|| async { "bytes" }),
            )
            .route("/api/v1/auth/me", get(|| async { "me" }));
        let app = apply_security_layers(inner, &cfg, jwt.clone(), limiter).unwrap();

        // Unauthenticated -> 401
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

        // Cookie auth missing CSRF -> 403 CSRF_VALIDATION_FAILED
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/deals/drafts")
                    .header(
                        header::COOKIE,
                        format!("safedeal_session={token}; safedeal_csrf=csrf_token_xyz"),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // Cross-origin reload race: BOTH valid Cookie AND valid Bearer WITHOUT X-CSRF-Token -> 200 OK (Bearer wins!)
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/deals/drafts")
                    .header(header::COOKIE, format!("safedeal_session={token}"))
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // Cookie-authenticated GET /download with Sec-Fetch-Site: cross-site -> 403 FORBIDDEN
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/v1/disputes/1/evidence/1/download")
                    .header(header::COOKIE, format!("safedeal_session={token}"))
                    .header("Sec-Fetch-Site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // Bearer-authenticated GET /download with Sec-Fetch-Site: cross-site -> 200 OK
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/v1/disputes/1/evidence/1/download")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .header("Sec-Fetch-Site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // Per-wallet evidence upload limit: 20 allowed, 21st rejected with 429 RATE_LIMITED
        for _ in 0..20 {
            let ok_res = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/v1/disputes/1/evidence")
                        .header(header::AUTHORIZATION, format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(ok_res.status(), StatusCode::OK);
        }
        let limited_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/disputes/1/evidence")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(limited_res.status(), StatusCode::TOO_MANY_REQUESTS);

        // Revoking jti causes BOTH Bearer and Cookie requests to fail immediately with 401 UNAUTHORIZED
        jwt.revoke_jti(&session_info.jti, session_info.expires_at);

        let revoked_bearer = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked_bearer.status(), StatusCode::UNAUTHORIZED);

        let revoked_cookie = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(header::COOKIE, format!("safedeal_session={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked_cookie.status(), StatusCode::UNAUTHORIZED);
    }
}
