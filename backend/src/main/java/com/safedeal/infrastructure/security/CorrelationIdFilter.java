package com.safedeal.infrastructure.security;

import com.safedeal.shared.validation.CorrelationIdContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

public class CorrelationIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String incoming = request.getHeader(CorrelationIdContext.HEADER_NAME);
        String correlationId = (incoming != null && incoming.matches("^[a-zA-Z0-9_-]{8,64}$"))
            ? incoming
            : UUID.randomUUID().toString();

        CorrelationIdContext.set(correlationId);
        MDC.put(CorrelationIdContext.MDC_KEY, correlationId);
        response.setHeader(CorrelationIdContext.HEADER_NAME, correlationId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(CorrelationIdContext.MDC_KEY);
            CorrelationIdContext.clear();
        }
    }
}
