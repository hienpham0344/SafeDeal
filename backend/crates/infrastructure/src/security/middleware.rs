use std::net::SocketAddr;
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
use crate::security::rate_limit::AuthRateLimitState;

#[derive(Clone, Copy, Debug)]
struct AuthSessionMeta {
    via_cookie: bool,
}

#[derive(Clone)]
pub struct SecurityMiddlewareState {
    pub jwt_service: JwtSessionService,
    pub rate_limiter: Arc<AuthRateLimitState>,
    pub session_cookie_name: String,
    pub csrf_cookie_name: String,
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
    let cors_layer = build_cors_layer(&config.cors)?;
    let state = Arc::new(SecurityMiddlewareState {
        jwt_service,
        rate_limiter,
        session_cookie_name: config.auth.session_cookie_name.clone(),
        csrf_cookie_name: config.auth.csrf_cookie_name.clone(),
    });

    Ok(router
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

async fn correlation_and_security_headers_middleware(
    req: Request<Body>,
    next: Next,
) -> Response {
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

    let mut response = with_correlation_id(correlation_id.clone(), next.run(req).instrument(span)).await;

    let headers = response.headers_mut();
    if let Ok(cid_header) = HeaderValue::from_str(&correlation_id) {
        headers.insert(HeaderName::from_static("x-correlation-id"), cid_header);
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
        // Strictly key by TCP peer socket address and ignore spoofable X-Forwarded-For.
        let key = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ci| ci.0.ip().to_string())
            .or_else(|| {
                req.extensions()
                    .get::<MockConnectInfo<SocketAddr>>()
                    .map(|ci| ci.0.ip().to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());
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

async fn session_auth_middleware(
    State(state): State<Arc<SecurityMiddlewareState>>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let mut via_cookie = false;
    let mut token = extract_cookie(req.headers(), &state.session_cookie_name);
    if token.is_some() {
        via_cookie = true;
    } else if let Some(auth_val) = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(bearer) = auth_val.strip_prefix("Bearer ") {
            let trimmed = bearer.trim();
            if !trimmed.is_empty() {
                token = Some(trimmed.to_string());
            }
        }
    }

    if let Some(tok) = token {
        if let Some(principal) = state.jwt_service.verify_token(&tok) {
            req.extensions_mut().insert(principal);
            req.extensions_mut().insert(AuthSessionMeta { via_cookie });
        }
    }

    next.run(req).await
}

async fn double_submit_csrf_middleware(
    State(state): State<Arc<SecurityMiddlewareState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if matches!(
        *req.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) {
        return next.run(req).await;
    }

    let via_cookie = req
        .extensions()
        .get::<AuthSessionMeta>()
        .is_some_and(|meta| meta.via_cookie);
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

fn extract_cookie(headers: &axum::http::HeaderMap, target_name: &str) -> Option<String> {
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
    use std::net::{IpAddr, Ipv4Addr};
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
    async fn rate_limit_ignores_x_forwarded_for_and_sets_security_headers() {
        let cfg = test_config(2);
        let jwt = JwtSessionService::new(&cfg.auth);
        let limiter = Arc::new(AuthRateLimitState::new(&RateLimitConfig {
            enabled: true,
            auth_requests_per_minute: 2,
        }));
        let inner = Router::new()
            .route("/api/v1/auth/nonce", post(|| async { "ok" }))
            .route("/api/v1/auth/verify", post(|| async { "ok" }));
        let base_app = apply_security_layers(inner, &cfg, jwt, limiter).unwrap();
        let peer_a_app = base_app.clone().layer(MockConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(198, 51, 100, 10)),
            4444,
        )));

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

    #[tokio::test]
    async fn enforces_csrf_on_cookie_auth_only_and_rejects_unauthenticated_private_routes() {
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

        let inner = Router::new()
            .route("/api/v1/deals/drafts", post(|| async { "created" }))
            .route("/api/v1/auth/me", get(|| async { "me" }));
        let app = apply_security_layers(inner, &cfg, jwt, limiter).unwrap();

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
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        assert!(String::from_utf8(bytes.to_vec())
            .unwrap()
            .contains("CSRF_VALIDATION_FAILED"));

        // Cookie auth with valid double-submit CSRF -> 200
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
                    .header("X-CSRF-Token", "csrf_token_xyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // Bearer token auth does not need CSRF -> 200
        let res = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/deals/drafts")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
}
