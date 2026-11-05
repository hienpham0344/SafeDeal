package com.safedeal.common.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Allowed browser origins. Configured through {@code safedeal.cors.allowed-origins}.
 */
@ConfigurationProperties(prefix = "safedeal.cors")
public record CorsProperties(List<String> allowedOrigins) {
}
