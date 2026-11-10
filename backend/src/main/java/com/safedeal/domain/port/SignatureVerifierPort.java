package com.safedeal.domain.port;

public interface SignatureVerifierPort {
    String recoverAddressFromPersonalSign(String message, String signatureHex);
}
