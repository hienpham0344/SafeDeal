package com.safedeal.domain.deal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * Deterministic RFC 8785 / ECMAScript JSON.stringify-compatible canonical JSON serializer
 * matching frontend canonical-terms.ts byte-for-byte.
 */
public final class CanonicalTermsHasher {

    private CanonicalTermsHasher() {
    }

    public record CanonicalInput(
        int version,
        long chainId,
        String seller,
        String buyer,
        String arbiter,
        String amountWei,
        long fundingDeadline,
        long deliveryDeadline,
        long inspectionWindowSeconds,
        String title,
        String description,
        String terms
    ) {
    }

    public record CanonicalResult(String canonicalJson, String termsHashHex) {
    }

    public static CanonicalResult compute(CanonicalInput input) {
        String canonicalJson = serializeCanonicalJson(input);
        String hashHex = sha256Hex(canonicalJson);
        return new CanonicalResult(canonicalJson, hashHex);
    }

    public static String serializeCanonicalJson(CanonicalInput input) {
        String normalizedSeller = input.seller().trim().toLowerCase(Locale.ROOT);
        String normalizedBuyer =
            (input.buyer() == null || input.buyer().trim().isEmpty())
                ? null
                : input.buyer().trim().toLowerCase(Locale.ROOT);
        String normalizedArbiter = input.arbiter().trim().toLowerCase(Locale.ROOT);
        String normalizedAmountWei = input.amountWei().trim();
        String normalizedTitle = input.title().trim();
        String normalizedDescription = input.description().trim();
        String normalizedTerms = input.terms().trim();

        // Keys sorted strictly lexicographically:
        // amountWei, arbiter, buyer, chainId, deliveryDeadline, description,
        // fundingDeadline, inspectionWindowSeconds, seller, terms, title, version
        StringBuilder sb = new StringBuilder(512);
        sb.append('{');
        appendStringField(sb, "amountWei", normalizedAmountWei).append(',');
        appendStringField(sb, "arbiter", normalizedArbiter).append(',');
        appendNullableStringField(sb, "buyer", normalizedBuyer).append(',');
        appendNumberField(sb, "chainId", input.chainId()).append(',');
        appendNumberField(sb, "deliveryDeadline", input.deliveryDeadline()).append(',');
        appendStringField(sb, "description", normalizedDescription).append(',');
        appendNumberField(sb, "fundingDeadline", input.fundingDeadline()).append(',');
        appendNumberField(sb, "inspectionWindowSeconds", input.inspectionWindowSeconds()).append(',');
        appendStringField(sb, "seller", normalizedSeller).append(',');
        appendStringField(sb, "terms", normalizedTerms).append(',');
        appendStringField(sb, "title", normalizedTitle).append(',');
        appendNumberField(sb, "version", input.version());
        sb.append('}');
        return sb.toString();
    }

    public static String sha256Hex(String utf8Text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(utf8Text.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(66);
            hex.append("0x");
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable in JVM", ex);
        }
    }

    private static StringBuilder appendStringField(StringBuilder sb, String key, String value) {
        quoteJsonString(sb, key);
        sb.append(':');
        quoteJsonString(sb, value);
        return sb;
    }

    private static StringBuilder appendNullableStringField(StringBuilder sb, String key, String value) {
        quoteJsonString(sb, key);
        sb.append(':');
        if (value == null) {
            sb.append("null");
        } else {
            quoteJsonString(sb, value);
        }
        return sb;
    }

    private static StringBuilder appendNumberField(StringBuilder sb, String key, long value) {
        quoteJsonString(sb, key);
        sb.append(':').append(value);
        return sb;
    }

    private static void quoteJsonString(StringBuilder sb, String value) {
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }
}
