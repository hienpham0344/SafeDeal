package com.safedeal.infrastructure.security;

import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.infrastructure.configuration.AuthSecurityProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class CookieSessionAuthenticationFilter extends OncePerRequestFilter {

    public static final String ATTR_COOKIE_AUTHENTICATED = "safedeal.cookieAuthenticated";

    private final JwtSessionService jwtSessionService;
    private final AuthSecurityProperties props;

    public CookieSessionAuthenticationFilter(JwtSessionService jwtSessionService, AuthSecurityProperties props) {
        this.jwtSessionService = jwtSessionService;
        this.props = props;
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String token = extractCookieToken(request, props.getSessionCookieName());
        boolean viaCookie = false;
        if (token != null) {
            viaCookie = true;
        } else {
            String authHeader = request.getHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                token = authHeader.substring(7).trim();
            }
        }

        if (token != null) {
            var maybePrincipal = jwtSessionService.verifyToken(token);
            if (maybePrincipal.isPresent()) {
                AuthenticatedPrincipal principal = maybePrincipal.get();
                var authentication = new UsernamePasswordAuthenticationToken(
                    principal,
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_USER"))
                );
                SecurityContextHolder.getContext().setAuthentication(authentication);
                request.setAttribute(ATTR_COOKIE_AUTHENTICATED, viaCookie);
            }
        }

        filterChain.doFilter(request, response);
    }

    private String extractCookieToken(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName()) && cookie.getValue() != null && !cookie.getValue().isBlank()) {
                return cookie.getValue();
            }
        }
        return null;
    }
}
