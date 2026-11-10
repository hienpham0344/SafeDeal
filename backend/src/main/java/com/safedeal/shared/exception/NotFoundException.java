package com.safedeal.shared.exception;

public class NotFoundException extends DomainException {
    public NotFoundException(String message) {
        super("NOT_FOUND", 404, message);
    }
}
