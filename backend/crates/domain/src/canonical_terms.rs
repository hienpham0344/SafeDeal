use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalInput<'a> {
    pub version: i32,
    pub chain_id: i64,
    pub seller: &'a str,
    pub buyer: Option<&'a str>,
    pub arbiter: &'a str,
    pub amount_wei: &'a str,
    pub funding_deadline: i64,
    pub delivery_deadline: i64,
    pub inspection_window_seconds: i64,
    pub title: &'a str,
    pub description: &'a str,
    pub terms: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalResult {
    pub canonical_json: String,
    pub terms_hash_hex: String,
}

/// Matches ECMAScript `String.prototype.trim()` whitespace code points (excluding `U+0085` NEL,
/// which Rust's `char::is_whitespace` strips by default).
pub fn trim_js_whitespace(value: &str) -> &str {
    value.trim_matches(|c: char| {
        matches!(
            c,
            '\u{0009}'
                | '\u{000A}'
                | '\u{000B}'
                | '\u{000C}'
                | '\u{000D}'
                | '\u{0020}'
                | '\u{00A0}'
                | '\u{1680}'
                | '\u{2000}'
                ..='\u{200A}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202F}'
                    | '\u{205F}'
                    | '\u{3000}'
                    | '\u{FEFF}'
        )
    })
}

/// Deterministic RFC 8785 / ECMAScript `JSON.stringify`-compatible canonical JSON serializer
/// matching frontend `canonical-terms.ts` and legacy Java `CanonicalTermsHasher` byte-for-byte.
pub struct CanonicalTermsHasher;

impl CanonicalTermsHasher {
    pub fn compute(input: &CanonicalInput<'_>) -> CanonicalResult {
        let canonical_json = Self::serialize_canonical_json(input);
        let terms_hash_hex = Self::sha256_hex(&canonical_json);
        CanonicalResult {
            canonical_json,
            terms_hash_hex,
        }
    }

    pub fn serialize_canonical_json(input: &CanonicalInput<'_>) -> String {
        let normalized_seller = trim_js_whitespace(input.seller).to_ascii_lowercase();
        let normalized_buyer = input
            .buyer
            .map(trim_js_whitespace)
            .filter(|b| !b.is_empty())
            .map(|b| b.to_ascii_lowercase());
        let normalized_arbiter = trim_js_whitespace(input.arbiter).to_ascii_lowercase();
        let normalized_amount_wei = trim_js_whitespace(input.amount_wei);
        let normalized_title = trim_js_whitespace(input.title);
        let normalized_description = trim_js_whitespace(input.description);
        let normalized_terms = trim_js_whitespace(input.terms);

        // Keys strictly in lexicographical order:
        // amountWei, arbiter, buyer, chainId, deliveryDeadline, description,
        // fundingDeadline, inspectionWindowSeconds, seller, terms, title, version
        let mut sb = String::with_capacity(512);
        sb.push('{');
        append_string_field(&mut sb, "amountWei", normalized_amount_wei);
        sb.push(',');
        append_string_field(&mut sb, "arbiter", &normalized_arbiter);
        sb.push(',');
        append_nullable_string_field(&mut sb, "buyer", normalized_buyer.as_deref());
        sb.push(',');
        append_number_field(&mut sb, "chainId", input.chain_id);
        sb.push(',');
        append_number_field(&mut sb, "deliveryDeadline", input.delivery_deadline);
        sb.push(',');
        append_string_field(&mut sb, "description", normalized_description);
        sb.push(',');
        append_number_field(&mut sb, "fundingDeadline", input.funding_deadline);
        sb.push(',');
        append_number_field(
            &mut sb,
            "inspectionWindowSeconds",
            input.inspection_window_seconds,
        );
        sb.push(',');
        append_string_field(&mut sb, "seller", &normalized_seller);
        sb.push(',');
        append_string_field(&mut sb, "terms", normalized_terms);
        sb.push(',');
        append_string_field(&mut sb, "title", normalized_title);
        sb.push(',');
        append_number_field(&mut sb, "version", i64::from(input.version));
        sb.push('}');
        sb
    }

    pub fn sha256_hex(utf8_text: &str) -> String {
        let digest = Sha256::digest(utf8_text.as_bytes());
        format!("0x{}", hex::encode(digest))
    }
}

fn append_string_field(sb: &mut String, key: &str, value: &str) {
    quote_json_string(sb, key);
    sb.push(':');
    quote_json_string(sb, value);
}

fn append_nullable_string_field(sb: &mut String, key: &str, value: Option<&str>) {
    quote_json_string(sb, key);
    sb.push(':');
    match value {
        None => sb.push_str("null"),
        Some(v) => quote_json_string(sb, v),
    }
}

fn append_number_field(sb: &mut String, key: &str, value: i64) {
    quote_json_string(sb, key);
    sb.push(':');
    use std::fmt::Write;
    let _ = write!(sb, "{value}");
}

fn quote_json_string(sb: &mut String, value: &str) {
    sb.push('"');
    for c in value.chars() {
        match c {
            '"' => sb.push_str("\\\""),
            '\\' => sb.push_str("\\\\"),
            '\u{0008}' => sb.push_str("\\b"),
            '\u{000c}' => sb.push_str("\\f"),
            '\n' => sb.push_str("\\n"),
            '\r' => sb.push_str("\\r"),
            '\t' => sb.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                use std::fmt::Write;
                let _ = write!(sb, "\\u{:04x}", c as u32);
            }
            c => sb.push(c),
        }
    }
    sb.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_frontend_rfc8785_canonical_json_and_sha256_vector() {
        let input1 = CanonicalInput {
            version: 1,
            chain_id: 43113,
            seller: "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
            buyer: Some("   "),
            arbiter: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
            amount_wei: "1500000000000000000",
            funding_deadline: 1800000000,
            delivery_deadline: 1800086400,
            inspection_window_seconds: 259200,
            title: "  Hardware Wallet Sale  ",
            description: "Sealed device with tracking",
            terms: "Shipped within 24 hours",
        };
        let input2 = CanonicalInput {
            version: 1,
            chain_id: 43113,
            seller: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
            buyer: None,
            arbiter: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
            amount_wei: "1500000000000000000",
            funding_deadline: 1800000000,
            delivery_deadline: 1800086400,
            inspection_window_seconds: 259200,
            title: "Hardware Wallet Sale",
            description: "Sealed device with tracking",
            terms: "Shipped within 24 hours",
        };

        let r1 = CanonicalTermsHasher::compute(&input1);
        let r2 = CanonicalTermsHasher::compute(&input2);

        let expected_json = "{\"amountWei\":\"1500000000000000000\",\"arbiter\":\"0x90f79bf6eb2c4f870365e785982e1f101e93b906\",\"buyer\":null,\"chainId\":43113,\"deliveryDeadline\":1800086400,\"description\":\"Sealed device with tracking\",\"fundingDeadline\":1800000000,\"inspectionWindowSeconds\":259200,\"seller\":\"0x70997970c51812dc3a010c7d01b50e0d17dc79c8\",\"terms\":\"Shipped within 24 hours\",\"title\":\"Hardware Wallet Sale\",\"version\":1}";

        assert_eq!(r1.canonical_json, expected_json);
        assert_eq!(r2.canonical_json, expected_json);
        assert_eq!(r1.terms_hash_hex, r2.terms_hash_hex);
        assert_eq!(
            r1.terms_hash_hex,
            "0xbf5ef59687168af6140d2ebd15e63b94df1ac4d3206e45f3a2f681cb962ade62"
        );
    }

    #[test]
    fn properly_escapes_control_characters_quotes_and_slashes_like_ecmascript_json_stringify() {
        let input = CanonicalInput {
            version: 1,
            chain_id: 31337,
            seller: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            buyer: None,
            arbiter: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
            amount_wei: "1000",
            funding_deadline: 1800000000,
            delivery_deadline: 1800086400,
            inspection_window_seconds: 3600,
            title: "Quote \"and\" Slash / Test",
            description: "Line1\nLine2\tTab",
            terms: "Back\\Slash",
        };
        let json = CanonicalTermsHasher::serialize_canonical_json(&input);
        assert!(json.contains("\"title\":\"Quote \\\"and\\\" Slash / Test\""));
        assert!(json.contains("\"description\":\"Line1\\nLine2\\tTab\""));
        assert!(json.contains("\"terms\":\"Back\\\\Slash\""));
    }

    #[test]
    fn escapes_control_chars_and_preserves_utf8_characters() {
        let input = CanonicalInput {
            version: 1,
            chain_id: 43113,
            seller: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            buyer: Some("0x70997970C51812DC3A010C7D01B50E0D17DC79C8"),
            arbiter: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
            amount_wei: "1000",
            funding_deadline: 1800000000,
            delivery_deadline: 1800086400,
            inspection_window_seconds: 3600,
            title: "Kiểm thử \x08\x0c\rEnd",
            description: "Ctrl\u{0001}char",
            terms: "Ok 🚀",
        };
        let json = CanonicalTermsHasher::serialize_canonical_json(&input);
        assert!(json.contains("\"title\":\"Kiểm thử \\b\\f\\rEnd\""));
        assert!(json.contains("\"description\":\"Ctrl\\u0001char\""));
        assert!(json.contains("\"terms\":\"Ok 🚀\""));
    }

    #[test]
    fn matches_ecmascript_trim_for_bom_nbsp_and_preserves_nel() {
        let input = CanonicalInput {
            version: 1,
            chain_id: 43113,
            seller: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            buyer: None,
            arbiter: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
            amount_wei: "1000",
            funding_deadline: 1800000000,
            delivery_deadline: 1800086400,
            inspection_window_seconds: 3600,
            title: "\u{feff}\u{00a0}Trimmed Like JS\u{2003}",
            description: "\u{0085}NEL kept like ECMAScript",
            terms: "  Standard\u{3000}",
        };
        let json = CanonicalTermsHasher::serialize_canonical_json(&input);
        assert!(json.contains("\"title\":\"Trimmed Like JS\""));
        assert!(json.contains("\"description\":\"\u{0085}NEL kept like ECMAScript\""));
        assert!(json.contains("\"terms\":\"Standard\""));
    }
}
