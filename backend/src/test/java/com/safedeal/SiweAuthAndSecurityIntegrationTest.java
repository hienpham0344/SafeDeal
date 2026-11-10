package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.web3j.crypto.ECKeyPair;
import org.web3j.crypto.Keys;
import org.web3j.crypto.Sign;
import org.web3j.utils.Numeric;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SiweAuthAndSecurityIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    static String signPersonalMessage(ECKeyPair keyPair, String message) {
        Sign.SignatureData sig = Sign.signPrefixedMessage(message.getBytes(StandardCharsets.UTF_8), keyPair);
        byte[] all = new byte[65];
        System.arraycopy(sig.getR(), 0, all, 0, 32);
        System.arraycopy(sig.getS(), 0, all, 32, 32);
        System.arraycopy(sig.getV(), 0, all, 64, 1);
        return Numeric.toHexString(all);
    }

    @Test
    void fullSiweLoginIssuesHttpOnlyAndCsrfCookiesAndBlocksReplayAndMissingCsrf() throws Exception {
        ECKeyPair keyPair = Keys.createEcKeyPair();
        String walletAddress = "0x" + Keys.getAddress(keyPair);

        // 1. Unauthenticated /auth/me rejected
        mockMvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized());

        // 2. Request nonce
        MvcResult nonceResult = mockMvc.perform(post("/api/v1/auth/nonce")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"address\":\"" + walletAddress + "\",\"chainId\":31337}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.nonce").isNotEmpty())
            .andExpect(jsonPath("$.domain").value("localhost:5173"))
            .andReturn();

        JsonNode nonceJson = objectMapper.readTree(nonceResult.getResponse().getContentAsString());
        String message = nonceJson.get("message").asText();
        String signature = signPersonalMessage(keyPair, message);

        String verifyBody = objectMapper.writeValueAsString(
            java.util.Map.of("message", message, "signature", signature)
        );

        // 3. Verify valid signature -> HttpOnly session cookie + CSRF cookie returned
        MvcResult verifyResult = mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(verifyBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.address").value(walletAddress.toLowerCase()))
            .andExpect(jsonPath("$.csrfToken").isNotEmpty())
            .andReturn();

        Cookie sessionCookie = verifyResult.getResponse().getCookie("safedeal_session");
        Cookie csrfCookie = verifyResult.getResponse().getCookie("safedeal_csrf");
        assertThat(sessionCookie).isNotNull();
        assertThat(sessionCookie.isHttpOnly()).isTrue();
        assertThat(csrfCookie).isNotNull();
        assertThat(csrfCookie.isHttpOnly()).isFalse();

        // 4. Replay exact same signed challenge -> MUST FAIL 401
        mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(verifyBody))
            .andExpect(status().isUnauthorized());

        // 5. Cookie-authenticated GET /me succeeds
        mockMvc.perform(get("/api/v1/auth/me").cookie(sessionCookie, csrfCookie))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.address").value(walletAddress.toLowerCase()));

        // 6. Cookie-authenticated mutating POST WITHOUT X-CSRF-Token header -> 403 CSRF failure
        mockMvc.perform(post("/api/v1/deals/drafts")
                .cookie(sessionCookie, csrfCookie)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("CSRF_VALIDATION_FAILED"));

        // 7. Malformed path variable, missing parameter, and unsupported method map cleanly to 400/405 (not 500)
        mockMvc.perform(get("/api/v1/disputes/not-a-number").cookie(sessionCookie, csrfCookie))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/api/v1/disputes/1/evidence")
                .cookie(sessionCookie, csrfCookie)
                .header("X-CSRF-Token", csrfCookie.getValue()))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("MISSING_PARAMETER"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/v1/deals")
                .cookie(sessionCookie, csrfCookie)
                .header("X-CSRF-Token", csrfCookie.getValue()))
            .andExpect(status().isMethodNotAllowed())
            .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));

        // 8. Logout clears cookies (requires matching X-CSRF-Token when cookie-authenticated)
        mockMvc.perform(post("/api/v1/auth/logout")
                .cookie(sessionCookie, csrfCookie)
                .header("X-CSRF-Token", csrfCookie.getValue()))
            .andExpect(status().isNoContent());
    }

    @Test
    void rejectsWrongSignatureOrTamperedDomain() throws Exception {
        ECKeyPair legitimate = Keys.createEcKeyPair();
        ECKeyPair attacker = Keys.createEcKeyPair();
        String walletAddress = "0x" + Keys.getAddress(legitimate);

        MvcResult nonceResult = mockMvc.perform(post("/api/v1/auth/nonce")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"address\":\"" + walletAddress + "\",\"chainId\":31337}"))
            .andExpect(status().isOk())
            .andReturn();

        String message = objectMapper.readTree(nonceResult.getResponse().getContentAsString()).get("message").asText();
        String attackerSig = signPersonalMessage(attacker, message);

        mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(java.util.Map.of("message", message, "signature", attackerSig))))
            .andExpect(status().isUnauthorized());

        String tamperedMessage = message.replace("localhost:5173", "evil.attacker.com");
        String tamperedSig = signPersonalMessage(legitimate, tamperedMessage);
        mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(java.util.Map.of("message", tamperedMessage, "signature", tamperedSig))))
            .andExpect(status().isUnauthorized());
    }
}
