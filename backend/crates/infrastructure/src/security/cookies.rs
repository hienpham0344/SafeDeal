use safedeal_application::auth::SessionCookiePort;
use safedeal_domain::auth::AuthenticatedPrincipal;
use safedeal_shared::DomainError;

use crate::config::{AuthSecurityConfig, CookieSameSite};
use crate::security::jwt::JwtSessionService;

#[derive(Clone)]
pub struct HttpSessionCookieAdapter {
    jwt_service: JwtSessionService,
    session_cookie_name: String,
    csrf_cookie_name: String,
    session_ttl_seconds: i64,
    cookie_secure: bool,
    cookie_same_site: CookieSameSite,
}

impl HttpSessionCookieAdapter {
    pub fn new(jwt_service: JwtSessionService, config: &AuthSecurityConfig) -> Self {
        Self {
            jwt_service,
            session_cookie_name: config.session_cookie_name.clone(),
            csrf_cookie_name: config.csrf_cookie_name.clone(),
            session_ttl_seconds: config.session_ttl_seconds,
            cookie_secure: config.cookie_secure,
            cookie_same_site: config.cookie_same_site,
        }
    }

    fn format_cookie(&self, name: &str, value: &str, max_age: i64, http_only: bool) -> String {
        let mut parts = vec![
            format!("{name}={value}"),
            "Path=/".to_string(),
            format!("Max-Age={max_age}"),
            format!("SameSite={}", self.cookie_same_site.as_str()),
        ];
        if http_only {
            parts.push("HttpOnly".to_string());
        }
        if self.cookie_secure {
            parts.push("Secure".to_string());
        }
        parts.join("; ")
    }
}

impl SessionCookiePort for HttpSessionCookieAdapter {
    fn session_cookie_headers(
        &self,
        principal: &AuthenticatedPrincipal,
    ) -> Result<Vec<String>, DomainError> {
        let jwt = self
            .jwt_service
            .create_token(principal)
            .map_err(|e| DomainError::internal(format!("Failed to issue session JWT: {e}")))?;
        Ok(vec![
            self.format_cookie(
                &self.session_cookie_name,
                &jwt,
                self.session_ttl_seconds,
                true,
            ),
            self.format_cookie(
                &self.csrf_cookie_name,
                &principal.csrf_token,
                self.session_ttl_seconds,
                false,
            ),
        ])
    }

    fn clear_cookie_headers(&self) -> Vec<String> {
        vec![
            self.format_cookie(&self.session_cookie_name, "", 0, true),
            self.format_cookie(&self.csrf_cookie_name, "", 0, false),
        ]
    }
}
