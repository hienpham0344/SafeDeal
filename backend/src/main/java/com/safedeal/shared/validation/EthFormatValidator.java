package com.safedeal.shared.validation;

import com.safedeal.shared.exception.ValidationException;
import java.math.BigInteger;
import java.util.Locale;
import java.util.regex.Pattern;

public final class EthFormatValidator {

    private static final Pattern ADDRESS_PATTERN = Pattern.compile("^0x[0-9a-fA-F]{40}$");
    private static final Pattern BYTES32_PATTERN = Pattern.compile("^0x[0-9a-fA-F]{64}$");
    private static final Pattern DECIMAL_INT_PATTERN = Pattern.compile("^[0-9]+$");
    public static final String ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    private EthFormatValidator() {
    }

    public static String requireAddress(String raw, String fieldName) {
        if (raw == null || !ADDRESS_PATTERN.matcher(raw.trim()).matches()) {
            throw new ValidationException("Invalid EVM address for " + fieldName);
        }
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        if (ZERO_ADDRESS.equals(normalized)) {
            throw new ValidationException(fieldName + " cannot be the zero address");
        }
        return normalized;
    }

    public static String normalizeOptionalAddress(String raw, String fieldName) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        String normalized = requireAddressOrZero(raw, fieldName);
        return ZERO_ADDRESS.equals(normalized) ? null : normalized;
    }

    public static String requireAddressOrZero(String raw, String fieldName) {
        if (raw == null || !ADDRESS_PATTERN.matcher(raw.trim()).matches()) {
            throw new ValidationException("Invalid EVM address for " + fieldName);
        }
        return raw.trim().toLowerCase(Locale.ROOT);
    }

    public static String requireBytes32(String raw, String fieldName) {
        if (raw == null || !BYTES32_PATTERN.matcher(raw.trim()).matches()) {
            throw new ValidationException("Invalid 32-byte hex value for " + fieldName);
        }
        return raw.trim().toLowerCase(Locale.ROOT);
    }

    public static BigInteger requirePositiveWei(String raw, String fieldName) {
        if (raw == null || !DECIMAL_INT_PATTERN.matcher(raw.trim()).matches()) {
            throw new ValidationException(fieldName + " must be a positive base-10 integer string");
        }
        BigInteger value = new BigInteger(raw.trim());
        if (value.compareTo(BigInteger.ZERO) <= 0) {
            throw new ValidationException(fieldName + " must be greater than zero");
        }
        return value;
    }

    public static BigInteger requireNonNegativeWei(String raw, String fieldName) {
        if (raw == null || !DECIMAL_INT_PATTERN.matcher(raw.trim()).matches()) {
            throw new ValidationException(fieldName + " must be a non-negative base-10 integer string");
        }
        return new BigInteger(raw.trim());
    }
}
