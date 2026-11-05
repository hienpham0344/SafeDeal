package com.safedeal.ai.domain;

public class AiProviderException extends RuntimeException {

    public AiProviderException(String message, Throwable cause) {
        super(message, cause);
    }

    public AiProviderException(String message) {
        super(message);
    }
}
