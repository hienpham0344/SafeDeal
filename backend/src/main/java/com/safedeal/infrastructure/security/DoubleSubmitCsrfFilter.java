package com.safedeal.infrastructure.security;

import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.infrastructure.configuration.AuthSecurityProperties;
import com.safedeal.shared.validation.CorrelationIdContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class DoubleSubmitCsrfFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");
    private static final String CSRF_HEADER = "X-CSRF-Token";

    private final AuthSecurityProperties props;

    public DoubleSubmitCsrfFilter(AuthSecurityProperties props) {
        this.props = props;
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        if (SAFE_METHODS.contains(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        Object attr = request.getAttribute(CookieSessionAuthenticationFilter.ATTR_COOKIE_AUTHENTICATED);
        boolean viaCookie = Boolean.TRUE.equals(attr);
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();

        if (viaCookie && auth != null && auth.getPrincipal() instanceof AuthenticatedPrincipal principal) {
            String headerToken = request.getHeader(CSRF_HEADER);
            String cookieToken = readCookie(request, props.getCsrfCookieName());
            if (headerToken == null || cookieToken == null
                || !constantTimeEquals(headerToken, cookieToken)
                || !constantTimeEquals(headerToken, principal.csrfToken())) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                String correlationId = CorrelationIdContext.getOrDefault("n/a");
                response.getWriter().write(
                    "{\"code\":\"CSRF_VALIDATION_FAILED\",\"message\":\"Missing or invalid CSRF protection token.\",\"correlationId\":\""
                        + correlationId + "\",\"timestamp\":\"" + Instant.now() + "\"}"
                );
                return;
            }
        }

        filterChain.doFilter(request, response);
    }

    private String readCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(
            a.getBytes(StandardCharsets.UTF_8),
            b.getBytes(StandardCharsets.UTF_8)
        );
    }
}
