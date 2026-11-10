package com.safedeal.shared.exception;

public class ForbiddenException extends DomainException {
    public ForbiddenException(String message) {
        super("FORBIDDEN", 403, message);
    }
}
