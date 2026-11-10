package com.safedeal.shared.exception;

public class ExternalServiceException extends DomainException {
    public ExternalServiceException(String message) {
        super("BLOCKCHAIN_RPC_ERROR", 502, message);
    }

    public ExternalServiceException(String message, Throwable cause) {
        super("BLOCKCHAIN_RPC_ERROR", 502, message, cause);
    }
}
