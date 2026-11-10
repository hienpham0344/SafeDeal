package com.safedeal.infrastructure.configuration;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "safedeal.rate-limit")
public class RateLimitProperties {

    private boolean enabled = true;
    @Min(1)
    private int authRequestsPerMinute = 30;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getAuthRequestsPerMinute() {
        return authRequestsPerMinute;
    }

    public void setAuthRequestsPerMinute(int authRequestsPerMinute) {
        this.authRequestsPerMinute = authRequestsPerMinute;
    }
}
