package com.safedeal.infrastructure.configuration;

import jakarta.annotation.PostConstruct;
import jakarta.validation.constraints.NotBlank;
import java.util.Arrays;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "safedeal.cors")
public class CorsProperties {

    @NotBlank
    private String allowedOrigins = "http://localhost:5173";

    @PostConstruct
    void validateOrigins() {
        List<String> origins = getAllowedOriginsList();
        if (origins.isEmpty()) {
            throw new IllegalStateException("CORS_ALLOWED_ORIGINS cannot be empty.");
        }
        for (String origin : origins) {
            if ("*".equals(origin)) {
                throw new IllegalStateException("CORS wildcard '*' is forbidden when credentialed cookies are enabled.");
            }
        }
    }

    public String getAllowedOrigins() {
        return allowedOrigins;
    }

    public void setAllowedOrigins(String allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    public List<String> getAllowedOriginsList() {
        return Arrays.stream(allowedOrigins.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .toList();
    }
}
