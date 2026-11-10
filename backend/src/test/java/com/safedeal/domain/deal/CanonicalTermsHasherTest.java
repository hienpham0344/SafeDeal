package com.safedeal.domain.deal;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.junit.jupiter.api.Test;

class CanonicalTermsHasherTest {

    @Test
    void matchesFrontendRfc8785CanonicalJsonAndSha256Vector() throws Exception {
        CanonicalTermsHasher.CanonicalInput input1 = new CanonicalTermsHasher.CanonicalInput(
            1,
            43113L,
            "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
            "   ",
            "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
            "1500000000000000000",
            1800000000L,
            1800086400L,
            259200L,
            "  Hardware Wallet Sale  ",
            "Sealed device with tracking",
            "Shipped within 24 hours"
        );

        CanonicalTermsHasher.CanonicalInput input2 = new CanonicalTermsHasher.CanonicalInput(
            1,
            43113L,
            "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
            null,
            "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
            "1500000000000000000",
            1800000000L,
            1800086400L,
            259200L,
            "Hardware Wallet Sale",
            "Sealed device with tracking",
            "Shipped within 24 hours"
        );

        var r1 = CanonicalTermsHasher.compute(input1);
        var r2 = CanonicalTermsHasher.compute(input2);

        String expectedJson =
            "{\"amountWei\":\"1500000000000000000\",\"arbiter\":\"0x90f79bf6eb2c4f870365e785982e1f101e93b906\",\"buyer\":null,\"chainId\":43113,\"deliveryDeadline\":1800086400,\"description\":\"Sealed device with tracking\",\"fundingDeadline\":1800000000,\"inspectionWindowSeconds\":259200,\"seller\":\"0x70997970c51812dc3a010c7d01b50e0d17dc79c8\",\"terms\":\"Shipped within 24 hours\",\"title\":\"Hardware Wallet Sale\",\"version\":1}";

        assertThat(r1.canonicalJson()).isEqualTo(expectedJson);
        assertThat(r2.canonicalJson()).isEqualTo(expectedJson);
        assertThat(r1.termsHashHex()).isEqualTo(r2.termsHashHex());
        assertThat(r1.termsHashHex()).isEqualTo("0xbf5ef59687168af6140d2ebd15e63b94df1ac4d3206e45f3a2f681cb962ade62");
        assertThat(r1.termsHashHex()).matches("^0x[0-9a-f]{64}$");

        byte[] digest = MessageDigest.getInstance("SHA-256").digest(expectedJson.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder("0x");
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        assertThat(r1.termsHashHex()).isEqualTo(sb.toString());
    }

    @Test
    void properlyEscapesControlCharactersQuotesAndSlashesLikeEcmascriptJsonStringify() {
        CanonicalTermsHasher.CanonicalInput input = new CanonicalTermsHasher.CanonicalInput(
            1,
            31337L,
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            null,
            "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
            "1000",
            1800000000L,
            1800086400L,
            3600L,
            "Quote \"and\" Slash / Test",
            "Line1\nLine2\tTab",
            "Back\\Slash"
        );
        String json = CanonicalTermsHasher.serializeCanonicalJson(input);
        assertThat(json).contains("\"title\":\"Quote \\\"and\\\" Slash / Test\"");
        assertThat(json).contains("\"description\":\"Line1\\nLine2\\tTab\"");
        assertThat(json).contains("\"terms\":\"Back\\\\Slash\"");
    }
}
