package com.safedeal.application.authentication;

import com.safedeal.domain.authentication.AuthNonce;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.domain.dispute.AuditLogEntry;
import com.safedeal.domain.port.AuditLogRepository;
import com.safedeal.domain.port.AuthNonceRepository;
import com.safedeal.domain.port.SignatureVerifierPort;
import com.safedeal.domain.port.UserRepository;
import com.safedeal.shared.exception.UnauthorizedException;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.CorrelationIdContext;
import com.safedeal.shared.validation.EthFormatValidator;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SiweAuthService {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final HexFormat HEX_FORMAT = HexFormat.of();

    public record ChallengeResult(
        String nonce,
        String domain,
        String uri,
        long chainId,
        Instant issuedAt,
        Instant expirationTime,
        String statement,
        String message
    ) {
    }

    private final AuthNonceRepository nonceRepository;
    private final UserRepository userRepository;
    private final AuditLogRepository auditLogRepository;
    private final SignatureVerifierPort signatureVerifier;
    private final SiweSettings settings;
    private final Clock clock;

    public SiweAuthService(
        AuthNonceRepository nonceRepository,
        UserRepository userRepository,
        AuditLogRepository auditLogRepository,
        SignatureVerifierPort signatureVerifier,
        SiweSettings settings,
        Clock clock
    ) {
        this.nonceRepository = nonceRepository;
        this.userRepository = userRepository;
        this.auditLogRepository = auditLogRepository;
        this.signatureVerifier = signatureVerifier;
        this.settings = settings;
        this.clock = clock;
    }

    @Transactional
    public ChallengeResult issueChallenge(String rawAddress, long chainId) {
        String address = EthFormatValidator.requireAddress(rawAddress, "address");
        if (chainId != settings.chainId()) {
            throw new ValidationException(
                "CHAIN_MISMATCH",
                "Unsupported chain ID " + chainId + ". Expected chain ID " + settings.chainId() + "."
            );
        }

        byte[] nonceBytes = new byte[16];
        SECURE_RANDOM.nextBytes(nonceBytes);
        String nonce = HEX_FORMAT.formatHex(nonceBytes);

        Instant now = Instant.now(clock).truncatedTo(ChronoUnit.MILLIS);
        Instant expiresAt = now.plusSeconds(settings.nonceTtlSeconds());
        String message = buildEip4361Message(address, chainId, nonce, now, expiresAt);

        nonceRepository.save(new AuthNonce(null, nonce, address, chainId, message, now, expiresAt, null));
        auditLogRepository.append(new AuditLogEntry(
            null,
            "AUTH_NONCE_ISSUED",
            address,
            "AUTH_NONCE",
            nonce,
            CorrelationIdContext.getOrDefault("n/a"),
            "Issued one-time SIWE login challenge for chainId=" + chainId,
            now
        ));

        return new ChallengeResult(
            nonce,
            settings.siweDomain(),
            settings.siweUri(),
            chainId,
            now,
            expiresAt,
            settings.statement(),
            message
        );
    }

    @Transactional
    public AuthenticatedPrincipal verifyAndAuthenticate(String message, String signature) {
        if (signature == null || !signature.trim().matches("^0x[0-9a-fA-F]{130}$")) {
            throw new UnauthorizedException("Invalid EIP-191 signature format.");
        }

        SiweMessageParser.ParsedSiweMessage parsed = SiweMessageParser.parse(message);
        if (!settings.siweDomain().equalsIgnoreCase(parsed.domain())) {
            throw new UnauthorizedException("SIWE domain mismatch.");
        }
        if (!settings.siweUri().equals(parsed.uri())) {
            throw new UnauthorizedException("SIWE URI mismatch.");
        }
        if (settings.chainId() != parsed.chainId()) {
            throw new UnauthorizedException("SIWE chain ID mismatch.");
        }

        Instant now = Instant.now(clock);
        if (parsed.issuedAt().isAfter(now.plusSeconds(30))) {
            throw new UnauthorizedException("SIWE Issued At timestamp is in the future.");
        }
        if (!now.isBefore(parsed.expirationTime())) {
            throw new UnauthorizedException("SIWE authentication challenge has expired.");
        }

        AuthNonce storedNonce = nonceRepository.findByNonce(parsed.nonce())
            .orElseThrow(() -> new UnauthorizedException("Invalid or unknown SIWE nonce."));

        if (!storedNonce.walletAddress().equalsIgnoreCase(parsed.address())
            || storedNonce.chainId() != parsed.chainId()
            || !storedNonce.issuedAt().truncatedTo(ChronoUnit.MILLIS).equals(parsed.issuedAt().truncatedTo(ChronoUnit.MILLIS))
            || !storedNonce.expiresAt().truncatedTo(ChronoUnit.MILLIS).equals(parsed.expirationTime().truncatedTo(ChronoUnit.MILLIS))) {
            throw new UnauthorizedException("SIWE challenge parameters do not match issued challenge.");
        }

        if (storedNonce.isExpired(now) || storedNonce.isConsumed()) {
            throw new UnauthorizedException("SIWE challenge already consumed or expired.");
        }

        // Verify cryptographic EIP-191 signature BEFORE consuming nonce (Wait: consuming first avoids parallel race brute-force too!)
        // Check signature recovers to exact address first so bad signature returns clean 401; consumeOnce prevents replay race!
        String recoveredAddress = signatureVerifier.recoverAddressFromPersonalSign(message, signature.trim());
        if (!parsed.address().equalsIgnoreCase(recoveredAddress)) {
            throw new UnauthorizedException("Wallet signature verification failed.");
        }

        boolean consumed = nonceRepository.consumeOnce(parsed.nonce(), parsed.address(), parsed.chainId(), now);
        if (!consumed) {
            throw new UnauthorizedException("SIWE nonce replay rejected.");
        }

        userRepository.upsertLogin(parsed.address(), now);
        auditLogRepository.append(new AuditLogEntry(
            null,
            "AUTH_LOGIN_VERIFIED",
            parsed.address(),
            "USER",
            parsed.address(),
            CorrelationIdContext.getOrDefault("n/a"),
            "Verified SIWE login on chainId=" + parsed.chainId(),
            now
        ));

        byte[] csrfBytes = new byte[24];
        SECURE_RANDOM.nextBytes(csrfBytes);
        String csrfToken = HEX_FORMAT.formatHex(csrfBytes);
        return new AuthenticatedPrincipal(parsed.address(), parsed.chainId(), now, csrfToken);
    }

    private String buildEip4361Message(
        String address,
        long chainId,
        String nonce,
        Instant issuedAt,
        Instant expiresAt
    ) {
        return settings.siweDomain()
            + " wants you to sign in with your Ethereum account:\n"
            + address
            + "\n\n"
            + settings.statement()
            + "\n\n"
            + "URI: " + settings.siweUri() + "\n"
            + "Version: 1\n"
            + "Chain ID: " + chainId + "\n"
            + "Nonce: " + nonce + "\n"
            + "Issued At: " + issuedAt.toString() + "\n"
            + "Expiration Time: " + expiresAt.toString();
    }
}
