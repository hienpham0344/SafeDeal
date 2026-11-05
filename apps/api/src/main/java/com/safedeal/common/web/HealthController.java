package com.safedeal.common.web;

import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class HealthController {

    private final String applicationName;

    public HealthController(@Value("${spring.application.name:safedeal-api}") String applicationName) {
        this.applicationName = applicationName;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "UP",
                "service", applicationName,
                "timestamp", Instant.now());
    }
}
