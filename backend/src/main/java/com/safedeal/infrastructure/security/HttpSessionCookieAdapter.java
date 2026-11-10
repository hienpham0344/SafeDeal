package com.safedeal.infrastructure.security;

import com.safedeal.application.authentication.SessionCookiePort;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.infrastructure.configuration.AuthSecurityProperties;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class HttpSessionCookieAdapter implements SessionCookiePort {

    private final JwtSessionService jwtSessionService;
    private final AuthSecurityProperties props;

    public HttpSessionCookieAdapter(JwtSessionService jwtSessionService, AuthSecurityProperties props) {
        this.jwtSessionService = jwtSessionService;
        this.props = props;
    }

    @Override
    public void writeSessionCookies(HttpServletResponse response, AuthenticatedPrincipal principal) {
        String jwt = jwtSessionService.createToken(principal);
        ResponseCookie sessionCookie = ResponseCookie.from(props.getSessionCookieName(), jwt)
            .httpOnly(true)
            .secure(props.isCookieSecure())
            .sameSite(props.getCookieSameSite())
            .path("/")
            .maxAge(props.getSessionTtlSeconds())
            .build();

        ResponseCookie csrfCookie = ResponseCookie.from(props.getCsrfCookieName(), principal.csrfToken())
            .httpOnly(false)
            .secure(props.isCookieSecure())
            .sameSite(props.getCookieSameSite())
            .path("/")
            .maxAge(props.getSessionTtlSeconds())
            .build();

        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookie.toString());
        response.addHeader(HttpHeaders.SET_COOKIE, csrfCookie.toString());
    }

    @Override
    public void clearSessionCookies(HttpServletResponse response) {
        ResponseCookie expiredSession = ResponseCookie.from(props.getSessionCookieName(), "")
            .httpOnly(true)
            .secure(props.isCookieSecure())
            .sameSite(props.getCookieSameSite())
            .path("/")
            .maxAge(0)
            .build();

        ResponseCookie expiredCsrf = ResponseCookie.from(props.getCsrfCookieName(), "")
            .httpOnly(false)
            .secure(props.isCookieSecure())
            .sameSite(props.getCookieSameSite())
            .path("/")
            .maxAge(0)
            .build();

        response.addHeader(HttpHeaders.SET_COOKIE, expiredSession.toString());
        response.addHeader(HttpHeaders.SET_COOKIE, expiredCsrf.toString());
    }
}
