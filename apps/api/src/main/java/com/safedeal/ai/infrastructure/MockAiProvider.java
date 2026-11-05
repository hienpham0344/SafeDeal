package com.safedeal.ai.infrastructure;

import com.safedeal.ai.domain.AiCompletion;
import com.safedeal.ai.domain.AiPrompt;
import com.safedeal.ai.domain.AiProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Deterministic provider for local development and tests. Active when safedeal.ai.provider=mock. */
@Component
@ConditionalOnProperty(prefix = "safedeal.ai", name = "provider", havingValue = "mock", matchIfMissing = true)
public class MockAiProvider implements AiProvider {

    @Override
    public String name() {
        return "mock";
    }

    @Override
    public AiCompletion complete(AiPrompt prompt) {
        return new AiCompletion("[mock-ai] " + prompt.user(), "mock-model", name());
    }
}
