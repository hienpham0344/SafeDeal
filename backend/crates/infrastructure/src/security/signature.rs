use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use safedeal_domain::ports::SignatureVerifierPort;
use safedeal_shared::DomainError;
use sha3::{Digest, Keccak256};

#[derive(Debug, Default, Clone, Copy)]
pub struct K256SignatureVerifier;

impl SignatureVerifierPort for K256SignatureVerifier {
    fn recover_address_from_personal_sign(
        &self,
        message: &str,
        signature_hex: &str,
    ) -> Result<String, DomainError> {
        let stripped = signature_hex
            .trim()
            .strip_prefix("0x")
            .or_else(|| signature_hex.trim().strip_prefix("0X"))
            .unwrap_or(signature_hex.trim());

        let sig_bytes = hex::decode(stripped)
            .map_err(|_| DomainError::unauthorized("Invalid EIP-191 signature length."))?;
        if sig_bytes.len() != 65 {
            return Err(DomainError::unauthorized(
                "Invalid EIP-191 signature length.",
            ));
        }

        let recovery_bit = match sig_bytes[64] {
            0 | 27 => 0u8,
            1 | 28 => 1u8,
            _ => {
                return Err(DomainError::unauthorized(
                    "Invalid EIP-191 signature recovery byte.",
                ))
            }
        };
        let recovery_id = RecoveryId::try_from(recovery_bit)
            .map_err(|_| DomainError::unauthorized("Invalid EIP-191 signature recovery byte."))?;

        let signature = Signature::from_slice(&sig_bytes[..64])
            .map_err(|_| DomainError::unauthorized("Invalid cryptographic wallet signature."))?;

        let msg_bytes = message.as_bytes();
        let mut hasher = Keccak256::new();
        hasher.update(b"\x19Ethereum Signed Message:\n");
        hasher.update(msg_bytes.len().to_string().as_bytes());
        hasher.update(msg_bytes);
        let digest = hasher.finalize();

        let verifying_key = VerifyingKey::recover_from_prehash(&digest, &signature, recovery_id)
            .map_err(|_| DomainError::unauthorized("Invalid cryptographic wallet signature."))?;

        let uncompressed = verifying_key.to_encoded_point(false);
        let pubkey_bytes = &uncompressed.as_bytes()[1..];
        let addr_hash = Keccak256::digest(pubkey_bytes);
        Ok(format!("0x{}", hex::encode(&addr_hash[12..])))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::SigningKey;

    fn sign_personal_test_message(signing_key: &SigningKey, message: &str) -> [u8; 65] {
        let msg_bytes = message.as_bytes();
        let mut hasher = Keccak256::new();
        hasher.update(b"\x19Ethereum Signed Message:\n");
        hasher.update(msg_bytes.len().to_string().as_bytes());
        hasher.update(msg_bytes);
        let digest = hasher.finalize();

        let (sig, rec_id) = signing_key.sign_prehash_recoverable(&digest).unwrap();
        let mut out = [0u8; 65];
        out[..64].copy_from_slice(&sig.to_bytes());
        out[64] = rec_id.to_byte() + 27;
        out
    }

    #[test]
    fn recovers_address_from_canonical_and_normalized_low_v_signatures() {
        let sk_bytes =
            hex::decode("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
                .unwrap();
        let signing_key = SigningKey::from_slice(&sk_bytes).unwrap();
        let expected = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
        let message = "SafeDeal authentication test";
        let canonical = sign_personal_test_message(&signing_key, message);

        let verifier = K256SignatureVerifier;
        assert_eq!(
            verifier
                .recover_address_from_personal_sign(
                    message,
                    &format!("0x{}", hex::encode(canonical))
                )
                .unwrap(),
            expected
        );

        let mut low_v = canonical;
        low_v[64] = canonical[64] - 27;
        assert_eq!(
            verifier
                .recover_address_from_personal_sign(message, &format!("0x{}", hex::encode(low_v)))
                .unwrap(),
            expected
        );
    }

    #[test]
    fn rejects_invalid_length_and_non_canonical_recovery_bytes() {
        let sk_bytes =
            hex::decode("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
                .unwrap();
        let signing_key = SigningKey::from_slice(&sk_bytes).unwrap();
        let message = "SafeDeal recovery rejection test";
        let mut raw = sign_personal_test_message(&signing_key, message);
        raw[64] = 0x80;

        let verifier = K256SignatureVerifier;
        assert!(matches!(
            verifier
                .recover_address_from_personal_sign(message, &format!("0x{}", hex::encode(raw))),
            Err(DomainError::Unauthorized { .. })
        ));
        assert!(matches!(
            verifier.recover_address_from_personal_sign(message, "0x1234"),
            Err(DomainError::Unauthorized { .. })
        ));
    }
}
