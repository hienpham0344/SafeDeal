package com.safedeal.ai.application;

import com.safedeal.ai.domain.AiCompletion;
import com.safedeal.ai.domain.AiPrompt;
import com.safedeal.ai.domain.AiProvider;
import org.springframework.stereotype.Service;

/**
 * Orchestrates AI calls. Premium entitlement and usage-limit checks are added here later via the
 * subscription module's public application service (never by reading its tables directly).
 */
@Service
public class AiAssistantService {

    private final AiProvider provider;

    public AiAssistantService(AiProvider provider) {
        this.provider = provider;
    }

    public AiCompletion ask(String systemPrompt, String userPrompt) {
        return provider.complete(new AiPrompt(systemPrompt, userPrompt));
    }
}
