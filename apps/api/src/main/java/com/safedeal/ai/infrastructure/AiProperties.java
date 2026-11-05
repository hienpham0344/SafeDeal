package com.safedeal.ai.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param provider  adapter selector: {@code mock} (default) or {@code http} (OpenAI-compatible endpoint)
 * @param endpoint  base URL of the provider, supplied via AI_API_ENDPOINT
 * @param apiKey    secret supplied via AI_API_KEY, never logged
 * @param model     model identifier supplied via AI_MODEL
 */
@ConfigurationProperties(prefix = "safedeal.ai")
public record AiProperties(String provider, String endpoint, String apiKey, String model) {

    public AiProperties {
        provider = (provider == null || provider.isBlank()) ? "mock" : provider;
    }

    @Override
    public String toString() {
        return "AiProperties[provider=" + provider + ", endpoint=" + endpoint + ", model=" + model + ", apiKey=***]";
    }
}
