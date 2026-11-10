package com.safedeal.shared.exception;

public class ValidationException extends DomainException {
    public ValidationException(String message) {
        super("VALIDATION_ERROR", 400, message);
    }

    public ValidationException(String errorCode, String message) {
        super(errorCode, 400, message);
    }
}
