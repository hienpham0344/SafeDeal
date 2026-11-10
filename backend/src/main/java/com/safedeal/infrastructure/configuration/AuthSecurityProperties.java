package com.safedeal.infrastructure.configuration;

import jakarta.annotation.PostConstruct;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "safedeal.auth")
public class AuthSecurityProperties {

    @NotBlank
    private String jwtSecret;
    @Min(60)
    private long sessionTtlSeconds = 86400;
    @Min(30)
    private long nonceTtlSeconds = 300;
    @NotBlank
    private String siweDomain = "localhost:5173";
    @NotBlank
    private String siweUri = "http://localhost:5173";
    @NotBlank
    private String sessionCookieName = "safedeal_session";
    @NotBlank
    private String csrfCookieName = "safedeal_csrf";
    private boolean cookieSecure = false;
    @NotBlank
    private String cookieSameSite = "Lax";

    @PostConstruct
    void validateJwtSecretLength() {
        if (jwtSecret == null || jwtSecret.trim().length() < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 characters long.");
        }
    }

    public String getJwtSecret() {
        return jwtSecret;
    }

    public void setJwtSecret(String jwtSecret) {
        this.jwtSecret = jwtSecret;
    }

    public long getSessionTtlSeconds() {
        return sessionTtlSeconds;
    }

    public void setSessionTtlSeconds(long sessionTtlSeconds) {
        this.sessionTtlSeconds = sessionTtlSeconds;
    }

    public long getNonceTtlSeconds() {
        return nonceTtlSeconds;
    }

    public void setNonceTtlSeconds(long nonceTtlSeconds) {
        this.nonceTtlSeconds = nonceTtlSeconds;
    }

    public String getSiweDomain() {
        return siweDomain;
    }

    public void setSiweDomain(String siweDomain) {
        this.siweDomain = siweDomain;
    }

    public String getSiweUri() {
        return siweUri;
    }

    public void setSiweUri(String siweUri) {
        this.siweUri = siweUri;
    }

    public String getSessionCookieName() {
        return sessionCookieName;
    }

    public void setSessionCookieName(String sessionCookieName) {
        this.sessionCookieName = sessionCookieName;
    }

    public String getCsrfCookieName() {
        return csrfCookieName;
    }

    public void setCsrfCookieName(String csrfCookieName) {
        this.csrfCookieName = csrfCookieName;
    }

    public boolean isCookieSecure() {
        return cookieSecure;
    }

    public void setCookieSecure(boolean cookieSecure) {
        this.cookieSecure = cookieSecure;
    }

    public String getCookieSameSite() {
        return cookieSameSite;
    }

    public void setCookieSameSite(String cookieSameSite) {
        this.cookieSameSite = cookieSameSite;
    }
}
