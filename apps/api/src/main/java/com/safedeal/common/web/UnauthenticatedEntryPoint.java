package com.safedeal.common.web;

import tools.jackson.databind.ObjectMapper;
import com.safedeal.common.error.ApiError;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

/** Returns the uniform {@link ApiError} body instead of an empty 401/403 page. */
@Component
public class UnauthenticatedEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    public UnauthenticatedEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), ApiError.of(
                HttpServletResponse.SC_UNAUTHORIZED,
                "UNAUTHENTICATED",
                "Authentication is required",
                request.getRequestURI()));
    }
}
