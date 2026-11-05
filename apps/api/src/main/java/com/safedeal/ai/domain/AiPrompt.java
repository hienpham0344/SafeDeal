package com.safedeal.ai.domain;

public record AiPrompt(String system, String user) {

    public AiPrompt {
        if (user == null || user.isBlank()) {
            throw new IllegalArgumentException("user prompt is required");
        }
    }
}
