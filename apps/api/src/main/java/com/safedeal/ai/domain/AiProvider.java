package com.safedeal.ai.domain;

/**
 * Provider-agnostic text completion port. Adapters (OpenAI-compatible HTTP, mock, ...) implement it.
 * Domain services depend on this interface only, never on a vendor SDK.
 */
public interface AiProvider {

    String name();

    AiCompletion complete(AiPrompt prompt);
}
