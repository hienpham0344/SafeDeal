package com.safedeal.blockchain.domain;

/** Raised when the RPC node is unavailable or returns an unusable response. */
public class ChainGatewayException extends RuntimeException {

    public ChainGatewayException(String message, Throwable cause) {
        super(message, cause);
    }

    public ChainGatewayException(String message) {
        super(message);
    }
}
