package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.port.BlockchainGateway;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.web3j.crypto.ECKeyPair;
import org.web3j.crypto.Keys;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DealDisputeArbitrationIntegrationTest {

    private static final String CONTRACT = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private BlockchainGateway blockchainGateway;

    private record ActorSession(String address, Cookie session, Cookie csrf) {
    }

    @BeforeEach
    void setupGatewayDefaults() {
        when(blockchainGateway.isEnabled()).thenReturn(true);
        when(blockchainGateway.chainId()).thenReturn(31337L);
        when(blockchainGateway.chainName()).thenReturn("Anvil Local");
        when(blockchainGateway.contractAddress()).thenReturn(CONTRACT);
    }

    private ActorSession loginAs(ECKeyPair keyPair) throws Exception {
        String address = ("0x" + Keys.getAddress(keyPair)).toLowerCase();
        MvcResult challengeRes = mockMvc.perform(post("/api/v1/auth/nonce")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"address\":\"" + address + "\",\"chainId\":31337}"))
            .andExpect(status().isOk())
            .andReturn();
        String msg = objectMapper.readTree(challengeRes.getResponse().getContentAsString()).get("message").asText();
        String sig = SiweAuthAndSecurityIntegrationTest.signPersonalMessage(keyPair, msg);
        MvcResult verifyRes = mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("message", msg, "signature", sig))))
            .andExpect(status().isOk())
            .andReturn();
        return new ActorSession(
            address,
            verifyRes.getResponse().getCookie("safedeal_session"),
            verifyRes.getResponse().getCookie("safedeal_csrf")
        );
    }

    @Test
    void executesFullDealBindDisputePrivateEvidenceAndArbitrationWorkflow() throws Exception {
        ActorSession seller = loginAs(Keys.createEcKeyPair());
        ActorSession buyer = loginAs(Keys.createEcKeyPair());
        ActorSession arbiter = loginAs(Keys.createEcKeyPair());
        ActorSession outsider = loginAs(Keys.createEcKeyPair());

        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();
        String amountWei = "2000000000000000000";

        // Reject seller == arbiter
        mockMvc.perform(post("/api/v1/deals/drafts")
                .cookie(seller.session(), seller.csrf())
                .header("X-CSRF-Token", seller.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "title", "Invalid Same Arbiter",
                    "description", "Testing conflict rejection",
                    "amountWei", amountWei,
                    "buyerAddress", buyer.address(),
                    "arbiterAddress", seller.address(),
                    "fundingDeadlineEpochSeconds", fundingDeadline,
                    "deliveryDeadlineEpochSeconds", deliveryDeadline,
                    "inspectionWindowSeconds", 3600,
                    "terms", "Standard delivery terms text"
                ))))
            .andExpect(status().isBadRequest());

        // Create valid draft
        MvcResult draftRes = mockMvc.perform(post("/api/v1/deals/drafts")
                .cookie(seller.session(), seller.csrf())
                .header("X-CSRF-Token", seller.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "title", "Avalanche Consulting",
                    "description", "Smart contract hardening engagement",
                    "amountWei", amountWei,
                    "buyerAddress", buyer.address(),
                    "arbiterAddress", arbiter.address(),
                    "fundingDeadlineEpochSeconds", fundingDeadline,
                    "deliveryDeadlineEpochSeconds", deliveryDeadline,
                    "inspectionWindowSeconds", 86400,
                    "terms", "Signed audit report delivered within 48h"
                ))))
            .andExpect(status().isCreated())
            .andReturn();

        JsonNode draftJson = objectMapper.readTree(draftRes.getResponse().getContentAsString());
        String tradeId = draftJson.get("tradeId").asText();
        String termsHash = draftJson.get("termsHash").asText();

        // Outsider cannot read deal
        mockMvc.perform(get("/api/v1/deals/" + tradeId).cookie(outsider.session(), outsider.csrf()))
            .andExpect(status().isForbidden());

        // Bind transaction verification
        String createTx = "0x" + "a".repeat(64);
        VerifiedChainEvent createdEvent = new VerifiedChainEvent(
            createTx, 0, 100L, Instant.now().getEpochSecond(), CONTRACT,
            OnChainEventType.TRADE_CREATED, tradeId, seller.address(), buyer.address(), amountWei, null, null, termsHash
        );
        when(blockchainGateway.inspectTransaction(createTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(createTx, true, 100L, seller.address(), CONTRACT, List.of(createdEvent))
        ));
        when(blockchainGateway.fetchTrade(tradeId)).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                tradeId, seller.address(), buyer.address(), arbiter.address(), amountWei, termsHash,
                fundingDeadline, deliveryDeadline, 86400L, 0L, 1, false, "0", "0"
            )
        ));

        // Non-seller rejected on bind-tx
        mockMvc.perform(post("/api/v1/deals/" + tradeId + "/bind-tx")
                .cookie(buyer.session(), buyer.csrf())
                .header("X-CSRF-Token", buyer.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"txHash\":\"" + createTx + "\"}"))
            .andExpect(status().isForbidden());

        // Seller binds tx -> CREATED
        mockMvc.perform(post("/api/v1/deals/" + tradeId + "/bind-tx")
                .cookie(seller.session(), seller.csrf())
                .header("X-CSRF-Token", seller.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"txHash\":\"" + createTx + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("CREATED"))
            .andExpect(jsonPath("$.onChainBound").value(true));

        // Simulate buyer opened dispute on-chain
        String disputeTx = "0x" + "b".repeat(64);
        when(blockchainGateway.inspectTransaction(disputeTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                disputeTx, true, 105L, buyer.address(), CONTRACT,
                List.of(new VerifiedChainEvent(
                    disputeTx, 0, 105L, Instant.now().getEpochSecond(), CONTRACT,
                    OnChainEventType.DISPUTE_OPENED, tradeId, buyer.address(), buyer.address(), null, null, null, null
                ))
            )
        ));
        when(blockchainGateway.fetchTrade(anyString())).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                tradeId, seller.address(), buyer.address(), arbiter.address(), amountWei, termsHash,
                fundingDeadline, deliveryDeadline, 86400L, 0L, 6, false, "0", "0"
            )
        ));

        MvcResult disputeRes = mockMvc.perform(post("/api/v1/deals/" + tradeId + "/disputes")
                .cookie(buyer.session(), buyer.csrf())
                .header("X-CSRF-Token", buyer.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "reason", "Deliverable missing",
                    "summary", "Final report lacks mandatory test traces.",
                    "txHash", disputeTx
                ))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("OPEN"))
            .andReturn();

        long disputeId = objectMapper.readTree(disputeRes.getResponse().getContentAsString()).get("id").asLong();

        // Private dispute evidence upload by buyer
        byte[] pngBytes = new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01};
        MockMultipartFile attachment = new MockMultipartFile("file", "proof.png", "image/png", pngBytes);

        MvcResult evRes = mockMvc.perform(multipart("/api/v1/disputes/" + disputeId + "/evidence")
                .file(attachment)
                .param("title", "Log screenshot")
                .param("notes", "Shows failing verification step")
                .cookie(buyer.session(), buyer.csrf())
                .header("X-CSRF-Token", buyer.csrf().getValue()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.hasAttachment").value(true))
            .andReturn();

        long evidenceId = objectMapper.readTree(evRes.getResponse().getContentAsString()).get("id").asLong();

        // Outsider forbidden from reading or downloading private evidence
        mockMvc.perform(get("/api/v1/disputes/" + disputeId).cookie(outsider.session(), outsider.csrf()))
            .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/disputes/" + disputeId + "/evidence/" + evidenceId + "/download")
                .cookie(outsider.session(), outsider.csrf()))
            .andExpect(status().isForbidden());

        // Arbiter allowed to download private evidence cleanly
        MvcResult dlRes = mockMvc.perform(get("/api/v1/disputes/" + disputeId + "/evidence/" + evidenceId + "/download")
                .cookie(arbiter.session(), arbiter.csrf()))
            .andExpect(status().isOk())
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andReturn();
        assertThat(dlRes.getResponse().getContentAsByteArray()).isEqualTo(pngBytes);

        // Arbiter resolves on-chain with split
        String resolveTx = "0x" + "c".repeat(64);
        String buyerAward = "1500000000000000000";
        String sellerAward = "500000000000000000";
        when(blockchainGateway.inspectTransaction(resolveTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                resolveTx, true, 120L, arbiter.address(), CONTRACT,
                List.of(new VerifiedChainEvent(
                    resolveTx, 0, 120L, Instant.now().getEpochSecond(), CONTRACT,
                    OnChainEventType.DISPUTE_RESOLVED, tradeId, arbiter.address(), buyer.address(), null,
                    buyerAward, sellerAward, null
                ))
            )
        ));
        when(blockchainGateway.fetchTrade(tradeId)).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                tradeId, seller.address(), buyer.address(), arbiter.address(), amountWei, termsHash,
                fundingDeadline, deliveryDeadline, 86400L, 0L, 7, true, buyerAward, sellerAward
            )
        ));

        // Buyer cannot submit arbiter resolution
        mockMvc.perform(post("/api/v1/arbitration/disputes/" + disputeId + "/resolution")
                .cookie(buyer.session(), buyer.csrf())
                .header("X-CSRF-Token", buyer.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "txHash", resolveTx,
                    "rationale", "Partial refund granted per evidence review."
                ))))
            .andExpect(status().isForbidden());

        // Empty 0-byte attachment must be rejected cleanly with 400 BAD_REQUEST
        MockMultipartFile emptyAttachment = new MockMultipartFile("file", "empty.png", "image/png", new byte[0]);
        mockMvc.perform(multipart("/api/v1/disputes/" + disputeId + "/evidence")
                .file(emptyAttachment)
                .param("title", "Empty Attachment")
                .param("notes", "Should be rejected instead of silently dropped")
                .cookie(buyer.session(), buyer.csrf())
                .header("X-CSRF-Token", buyer.csrf().getValue()))
            .andExpect(status().isBadRequest());

        // Deal listing returns mapped disputeId accurately via batch lookup
        mockMvc.perform(get("/api/v1/deals").cookie(buyer.session(), buyer.csrf()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].disputeId").value(disputeId));

        // Readiness & health probes work publicly, and zero-address reports unconfigured
        mockMvc.perform(get("/actuator/health/readiness"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));

        mockMvc.perform(get("/api/v1/health/ready"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("READY"))
            .andExpect(jsonPath("$.databaseConnected").value(true))
            .andExpect(jsonPath("$.evidenceStorageReady").value(true))
            .andExpect(jsonPath("$.siweConfigured").value(true))
            .andExpect(jsonPath("$.escrowContractConfigured").value(true));

        when(blockchainGateway.contractAddress()).thenReturn("0x0000000000000000000000000000000000000000");
        mockMvc.perform(get("/api/v1/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.escrowContractConfigured").value(false));
        mockMvc.perform(get("/api/v1/health/ready"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.status").value("NOT_READY"))
            .andExpect(jsonPath("$.escrowContractConfigured").value(false));
        when(blockchainGateway.contractAddress()).thenReturn(CONTRACT);

        // Arbiter resolves cleanly
        mockMvc.perform(post("/api/v1/arbitration/disputes/" + disputeId + "/resolution")
                .cookie(arbiter.session(), arbiter.csrf())
                .header("X-CSRF-Token", arbiter.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "txHash", resolveTx,
                    "rationale", "Partial refund granted per evidence review."
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("RESOLVED"))
            .andExpect(jsonPath("$.buyerAwardWei").value(buyerAward))
            .andExpect(jsonPath("$.sellerAwardWei").value(sellerAward));
    }
}
