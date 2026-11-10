package com.safedeal.shared.exception;

public class UnauthorizedException extends DomainException {
    public UnauthorizedException(String message) {
        super("UNAUTHORIZED", 401, message);
    }
}
