package com.safedeal.infrastructure.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.infrastructure.configuration.AuthSecurityProperties;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
public class JwtSessionService {

    private static final String HEADER_JSON = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
    private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder URL_DECODER = Base64.getUrlDecoder();

    private final byte[] hmacKeyBytes;
    private final AuthSecurityProperties props;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public JwtSessionService(AuthSecurityProperties props, ObjectMapper objectMapper, Clock clock) {
        this.props = props;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.hmacKeyBytes = props.getJwtSecret().getBytes(StandardCharsets.UTF_8);
    }

    public String createToken(AuthenticatedPrincipal principal) {
        try {
            Instant issuedAt = principal.authenticatedAt();
            Instant expiresAt = issuedAt.plusSeconds(props.getSessionTtlSeconds());
            Map<String, Object> claims = Map.of(
                "sub", principal.address().toLowerCase(),
                "chainId", principal.chainId(),
                "csrf", principal.csrfToken(),
                "iat", issuedAt.getEpochSecond(),
                "exp", expiresAt.getEpochSecond()
            );
            String headerB64 = URL_ENCODER.encodeToString(HEADER_JSON.getBytes(StandardCharsets.UTF_8));
            String payloadB64 = URL_ENCODER.encodeToString(objectMapper.writeValueAsBytes(claims));
            String signingInput = headerB64 + "." + payloadB64;
            String signatureB64 = URL_ENCODER.encodeToString(signHmacSha256(signingInput));
            return signingInput + "." + signatureB64;
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to sign session JWT", ex);
        }
    }

    public Optional<AuthenticatedPrincipal> verifyToken(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return Optional.empty();
        }
        try {
            Map<String, Object> header = objectMapper.readValue(
                URL_DECODER.decode(parts[0]),
                new TypeReference<Map<String, Object>>() {}
            );
            if (!"HS256".equals(header.get("alg"))) {
                return Optional.empty();
            }

            String signingInput = parts[0] + "." + parts[1];
            byte[] expectedSig = signHmacSha256(signingInput);
            byte[] actualSig = URL_DECODER.decode(parts[2]);
            if (!MessageDigest.isEqual(expectedSig, actualSig)) {
                return Optional.empty();
            }

            Map<String, Object> claims = objectMapper.readValue(
                URL_DECODER.decode(parts[1]),
                new TypeReference<Map<String, Object>>() {}
            );

            Object sub = claims.get("sub");
            Object chainIdObj = claims.get("chainId");
            Object csrfObj = claims.get("csrf");
            Object iatObj = claims.get("iat");
            Object expObj = claims.get("exp");
            if (!(sub instanceof String address) || !(chainIdObj instanceof Number chainNum)
                || !(csrfObj instanceof String csrfToken)
                || !(iatObj instanceof Number iatNum) || !(expObj instanceof Number expNum)) {
                return Optional.empty();
            }

            Instant now = Instant.now(clock);
            Instant exp = Instant.ofEpochSecond(expNum.longValue());
            if (!now.isBefore(exp)) {
                return Optional.empty();
            }
            Instant iat = Instant.ofEpochSecond(iatNum.longValue());
            return Optional.of(new AuthenticatedPrincipal(address.toLowerCase(), chainNum.longValue(), iat, csrfToken));
        } catch (Exception ex) {
            return Optional.empty();
        }
    }

    private byte[] signHmacSha256(String input) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(hmacKeyBytes, "HmacSHA256"));
        return mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
    }
}
