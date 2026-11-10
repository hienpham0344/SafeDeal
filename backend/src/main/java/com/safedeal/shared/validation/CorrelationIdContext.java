package com.safedeal.shared.validation;

public final class CorrelationIdContext {
    public static final String HEADER_NAME = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private CorrelationIdContext() {
    }

    public static void set(String id) {
        CURRENT.set(id);
    }

    public static String getOrDefault(String fallback) {
        String id = CURRENT.get();
        return id != null ? id : fallback;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
