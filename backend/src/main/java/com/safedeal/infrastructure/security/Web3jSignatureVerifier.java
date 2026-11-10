package com.safedeal.infrastructure.security;

import com.safedeal.domain.port.SignatureVerifierPort;
import com.safedeal.shared.exception.UnauthorizedException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.SignatureException;
import java.util.Arrays;
import java.util.Locale;
import org.springframework.stereotype.Component;
import org.web3j.crypto.Keys;
import org.web3j.crypto.Sign;
import org.web3j.utils.Numeric;

@Component
public class Web3jSignatureVerifier implements SignatureVerifierPort {

    @Override
    public String recoverAddressFromPersonalSign(String message, String signatureHex) {
        if (message == null || signatureHex == null) {
            throw new UnauthorizedException("Message and signature are required.");
        }
        byte[] sigBytes = Numeric.hexStringToByteArray(signatureHex);
        if (sigBytes.length != 65) {
            throw new UnauthorizedException("Invalid EIP-191 signature length.");
        }
        int vInt = sigBytes[64] & 0xFF;
        if (vInt == 0 || vInt == 1) {
            vInt += 27;
        }
        if (vInt != 27 && vInt != 28) {
            throw new UnauthorizedException("Invalid EIP-191 signature recovery byte.");
        }
        byte v = (byte) vInt;
        byte[] r = Arrays.copyOfRange(sigBytes, 0, 32);
        byte[] s = Arrays.copyOfRange(sigBytes, 32, 64);

        try {
            Sign.SignatureData sigData = new Sign.SignatureData(v, r, s);
            BigInteger pubKey = Sign.signedPrefixedMessageToKey(message.getBytes(StandardCharsets.UTF_8), sigData);
            return "0x" + Keys.getAddress(pubKey).toLowerCase(Locale.ROOT);
        } catch (SignatureException | IllegalArgumentException ex) {
            throw new UnauthorizedException("Invalid cryptographic wallet signature.");
        }
    }
}
