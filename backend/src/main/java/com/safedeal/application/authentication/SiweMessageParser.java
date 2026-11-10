package com.safedeal.application.authentication;

import com.safedeal.shared.exception.UnauthorizedException;
import com.safedeal.shared.validation.EthFormatValidator;
import java.time.Instant;
import java.time.format.DateTimeParseException;

public final class SiweMessageParser {

    private static final String HEADER_SUFFIX = " wants you to sign in with your Ethereum account:";

    public record ParsedSiweMessage(
        String domain,
        String address,
        String uri,
        String version,
        long chainId,
        String nonce,
        Instant issuedAt,
        Instant expirationTime
    ) {
    }

    private SiweMessageParser() {
    }

    public static ParsedSiweMessage parse(String rawMessage) {
        if (rawMessage == null || rawMessage.isBlank()) {
            throw new UnauthorizedException("Empty SIWE message.");
        }
        String normalized = rawMessage.replace("\r\n", "\n");
        String[] lines = normalized.split("\n", -1);
        if (lines.length < 7) {
            throw new UnauthorizedException("Malformed SIWE message structure.");
        }

        String firstLine = lines[0];
        if (!firstLine.endsWith(HEADER_SUFFIX)) {
            throw new UnauthorizedException("Invalid SIWE header line.");
        }
        String domain = firstLine.substring(0, firstLine.length() - HEADER_SUFFIX.length()).trim();
        if (domain.isEmpty()) {
            throw new UnauthorizedException("Missing SIWE domain.");
        }

        String address;
        try {
            address = EthFormatValidator.requireAddress(lines[1], "SIWE address");
        } catch (RuntimeException ex) {
            throw new UnauthorizedException("Invalid SIWE wallet address.");
        }

        String uri = null;
        String version = null;
        Long chainId = null;
        String nonce = null;
        Instant issuedAt = null;
        Instant expirationTime = null;

        for (int i = 2; i < lines.length; i++) {
            String line = lines[i];
            if (line.startsWith("URI: ")) {
                uri = line.substring(5).trim();
            } else if (line.startsWith("Version: ")) {
                version = line.substring(9).trim();
            } else if (line.startsWith("Chain ID: ")) {
                chainId = parseLong(line.substring(10).trim(), "Chain ID");
            } else if (line.startsWith("Nonce: ")) {
                nonce = line.substring(7).trim();
            } else if (line.startsWith("Issued At: ")) {
                issuedAt = parseInstant(line.substring(11).trim(), "Issued At");
            } else if (line.startsWith("Expiration Time: ")) {
                expirationTime = parseInstant(line.substring(17).trim(), "Expiration Time");
            }
        }

        if (uri == null || !"1".equals(version) || chainId == null || nonce == null || nonce.isBlank()
            || issuedAt == null || expirationTime == null) {
            throw new UnauthorizedException("SIWE message is missing required security fields.");
        }

        return new ParsedSiweMessage(domain, address, uri, version, chainId, nonce, issuedAt, expirationTime);
    }

    private static long parseLong(String value, String field) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ex) {
            throw new UnauthorizedException("Invalid numeric SIWE field: " + field);
        }
    }

    private static Instant parseInstant(String value, String field) {
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ex) {
            throw new UnauthorizedException("Invalid timestamp SIWE field: " + field);
        }
    }
}
