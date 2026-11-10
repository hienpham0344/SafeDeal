package com.safedeal.application.authentication;

import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import jakarta.servlet.http.HttpServletResponse;

public interface SessionCookiePort {
    void writeSessionCookies(HttpServletResponse response, AuthenticatedPrincipal principal);

    void clearSessionCookies(HttpServletResponse response);
}
