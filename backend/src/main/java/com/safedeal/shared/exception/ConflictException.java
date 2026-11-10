package com.safedeal.shared.exception;

public class ConflictException extends DomainException {
    public ConflictException(String message) {
        super("CONFLICT", 409, message);
    }
}
