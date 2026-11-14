use alloy_primitives::U256;

use crate::error::DomainError;

pub const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";
pub const ZERO_BYTES32: &str = "0x0000000000000000000000000000000000000000000000000000000000000000";

pub struct EthFormatValidator;

impl EthFormatValidator {
    pub fn is_valid_address(raw: &str) -> bool {
        is_hex_prefixed_len(raw.trim(), 40)
    }

    pub fn is_zero_address(raw: &str) -> bool {
        raw.trim().eq_ignore_ascii_case(ZERO_ADDRESS)
    }

    pub fn require_address(raw: Option<&str>, field_name: &str) -> Result<String, DomainError> {
        let Some(raw) = raw else {
            return Err(DomainError::validation(format!(
                "Invalid EVM address for {field_name}"
            )));
        };
        let trimmed = raw.trim();
        if !is_hex_prefixed_len(trimmed, 40) {
            return Err(DomainError::validation(format!(
                "Invalid EVM address for {field_name}"
            )));
        }
        let normalized = trimmed.to_ascii_lowercase();
        if normalized == ZERO_ADDRESS {
            return Err(DomainError::validation(format!(
                "{field_name} cannot be the zero address"
            )));
        }
        Ok(normalized)
    }

    pub fn normalize_optional_address(
        raw: Option<&str>,
        field_name: &str,
    ) -> Result<Option<String>, DomainError> {
        let Some(raw) = raw else {
            return Ok(None);
        };
        if raw.trim().is_empty() {
            return Ok(None);
        }
        let normalized = Self::require_address_or_zero(Some(raw), field_name)?;
        if normalized == ZERO_ADDRESS {
            Ok(None)
        } else {
            Ok(Some(normalized))
        }
    }

    pub fn require_address_or_zero(
        raw: Option<&str>,
        field_name: &str,
    ) -> Result<String, DomainError> {
        let Some(raw) = raw else {
            return Err(DomainError::validation(format!(
                "Invalid EVM address for {field_name}"
            )));
        };
        let trimmed = raw.trim();
        if !is_hex_prefixed_len(trimmed, 40) {
            return Err(DomainError::validation(format!(
                "Invalid EVM address for {field_name}"
            )));
        }
        Ok(trimmed.to_ascii_lowercase())
    }

    pub fn require_bytes32(raw: Option<&str>, field_name: &str) -> Result<String, DomainError> {
        let Some(raw) = raw else {
            return Err(DomainError::validation(format!(
                "Invalid 32-byte hex value for {field_name}"
            )));
        };
        let trimmed = raw.trim();
        if !is_hex_prefixed_len(trimmed, 64) {
            return Err(DomainError::validation(format!(
                "Invalid 32-byte hex value for {field_name}"
            )));
        }
        Ok(trimmed.to_ascii_lowercase())
    }

    pub fn require_positive_wei(raw: Option<&str>, field_name: &str) -> Result<U256, DomainError> {
        let value = parse_decimal_u256(raw).ok_or_else(|| {
            DomainError::validation(format!(
                "{field_name} must be a positive base-10 integer string"
            ))
        })?;
        if value.is_zero() {
            return Err(DomainError::validation(format!(
                "{field_name} must be greater than zero"
            )));
        }
        Ok(value)
    }

    pub fn require_non_negative_wei(
        raw: Option<&str>,
        field_name: &str,
    ) -> Result<U256, DomainError> {
        parse_decimal_u256(raw).ok_or_else(|| {
            DomainError::validation(format!(
                "{field_name} must be a non-negative base-10 integer string"
            ))
        })
    }
}

fn is_hex_prefixed_len(s: &str, hex_digits: usize) -> bool {
    let Some(rest) = s.strip_prefix("0x") else {
        return false;
    };
    rest.len() == hex_digits && rest.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_decimal_u256(raw: Option<&str>) -> Option<U256> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    U256::from_str_radix(trimmed, 10).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_validation_and_normalization_parity() {
        let addr = EthFormatValidator::require_address(
            Some("  0x70997970C51812DC3A010C7D01B50E0D17DC79C8  "),
            "seller",
        )
        .unwrap();
        assert_eq!(addr, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8");

        let zero_err =
            EthFormatValidator::require_address(Some(ZERO_ADDRESS), "seller").unwrap_err();
        assert_eq!(zero_err.message(), "seller cannot be the zero address");

        assert_eq!(
            EthFormatValidator::normalize_optional_address(Some("   "), "buyer").unwrap(),
            None
        );
        assert_eq!(
            EthFormatValidator::normalize_optional_address(Some(ZERO_ADDRESS), "buyer").unwrap(),
            None
        );
    }

    #[test]
    fn wei_and_bytes32_validation_parity() {
        assert_eq!(
            EthFormatValidator::require_positive_wei(Some("1500000000000000000"), "amountWei")
                .unwrap(),
            U256::from(1_500_000_000_000_000_000u128)
        );
        let zero_wei =
            EthFormatValidator::require_positive_wei(Some("0"), "amountWei").unwrap_err();
        assert_eq!(zero_wei.message(), "amountWei must be greater than zero");
        assert!(EthFormatValidator::require_positive_wei(Some("-1"), "amountWei").is_err());
        assert_eq!(
            EthFormatValidator::require_non_negative_wei(Some("0"), "buyerAwardWei").unwrap(),
            U256::ZERO
        );
        let b32 = EthFormatValidator::require_bytes32(
            Some("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            "tradeId",
        )
        .unwrap();
        assert_eq!(b32, format!("0x{}", "a".repeat(64)));
    }
}
