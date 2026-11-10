package com.safedeal.infrastructure.security;

import com.safedeal.infrastructure.configuration.RateLimitProperties;
import com.safedeal.shared.validation.CorrelationIdContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

public class AuthRateLimitFilter extends OncePerRequestFilter {

    private static final long WINDOW_MILLIS = 60_000L;
    private static final int CLEANUP_INTERVAL = 256;

    private final RateLimitProperties props;
    private final Map<String, Deque<Long>> requestWindows = new ConcurrentHashMap<>();
    private final AtomicInteger callCounter = new AtomicInteger();

    public AuthRateLimitFilter(RateLimitProperties props) {
        this.props = props;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!props.isEnabled()) {
            return true;
        }
        String path = request.getRequestURI();
        return !("/api/v1/auth/nonce".equals(path) || "/api/v1/auth/verify".equals(path));
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String key = resolveClientKey(request);
        if (!allowRequest(key)) {
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            String correlationId = CorrelationIdContext.getOrDefault("n/a");
            response.getWriter().write(
                "{\"code\":\"RATE_LIMITED\",\"message\":\"Too many authentication requests. Please retry in one minute.\",\"correlationId\":\""
                    + correlationId + "\",\"timestamp\":\"" + Instant.now() + "\"}"
            );
            return;
        }
        filterChain.doFilter(request, response);
    }

    boolean allowRequest(String key) {
        long now = System.currentTimeMillis();
        if (callCounter.incrementAndGet() % CLEANUP_INTERVAL == 0) {
            evictExpiredWindows(now);
        }
        Deque<Long> timestamps = requestWindows.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (timestamps) {
            while (!timestamps.isEmpty() && now - timestamps.peekFirst() >= WINDOW_MILLIS) {
                timestamps.pollFirst();
            }
            if (timestamps.size() >= props.getAuthRequestsPerMinute()) {
                return false;
            }
            timestamps.addLast(now);
            return true;
        }
    }

    private void evictExpiredWindows(long now) {
        requestWindows.entrySet().removeIf(entry -> {
            Deque<Long> deque = entry.getValue();
            synchronized (deque) {
                while (!deque.isEmpty() && now - deque.peekFirst() >= WINDOW_MILLIS) {
                    deque.pollFirst();
                }
                return deque.isEmpty();
            }
        });
    }

    private String resolveClientKey(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();
        return (remoteAddr == null || remoteAddr.isBlank()) ? "unknown" : remoteAddr;
    }
}
