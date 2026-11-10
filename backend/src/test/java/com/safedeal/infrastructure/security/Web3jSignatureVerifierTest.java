package com.safedeal.infrastructure.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.safedeal.shared.exception.UnauthorizedException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.web3j.crypto.ECKeyPair;
import org.web3j.crypto.Keys;
import org.web3j.crypto.Sign;
import org.web3j.utils.Numeric;

class Web3jSignatureVerifierTest {

    private final Web3jSignatureVerifier verifier = new Web3jSignatureVerifier();

    @Test
    void recoversAddressFromCanonicalAndNormalizedLowVSigBytes() throws Exception {
        ECKeyPair keyPair = Keys.createEcKeyPair();
        String expected = ("0x" + Keys.getAddress(keyPair)).toLowerCase();
        String message = "SafeDeal authentication test";

        Sign.SignatureData sig = Sign.signPrefixedMessage(message.getBytes(StandardCharsets.UTF_8), keyPair);
        byte[] raw = new byte[65];
        System.arraycopy(sig.getR(), 0, raw, 0, 32);
        System.arraycopy(sig.getS(), 0, raw, 32, 32);
        raw[64] = sig.getV()[0];

        assertThat(verifier.recoverAddressFromPersonalSign(message, Numeric.toHexString(raw)))
            .isEqualTo(expected);

        byte[] lowV = raw.clone();
        lowV[64] = (byte) ((sig.getV()[0] & 0xFF) - 27);
        assertThat(verifier.recoverAddressFromPersonalSign(message, Numeric.toHexString(lowV)))
            .isEqualTo(expected);
    }

    @Test
    void rejectsInvalidLengthAndNonCanonicalRecoveryBytes() throws Exception {
        ECKeyPair keyPair = Keys.createEcKeyPair();
        String message = "SafeDeal recovery rejection test";
        Sign.SignatureData sig = Sign.signPrefixedMessage(message.getBytes(StandardCharsets.UTF_8), keyPair);

        byte[] raw = new byte[65];
        System.arraycopy(sig.getR(), 0, raw, 0, 32);
        System.arraycopy(sig.getS(), 0, raw, 32, 32);
        raw[64] = (byte) 0x80;

        assertThatThrownBy(() -> verifier.recoverAddressFromPersonalSign(message, Numeric.toHexString(raw)))
            .isInstanceOf(UnauthorizedException.class);

        assertThatThrownBy(() -> verifier.recoverAddressFromPersonalSign(message, "0x1234"))
            .isInstanceOf(UnauthorizedException.class);
    }
}
