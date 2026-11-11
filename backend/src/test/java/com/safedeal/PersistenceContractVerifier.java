package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.safedeal.application.synchronization.BlockchainEventIndexerService;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.ChainEventRepository;
import com.safedeal.domain.port.ChainSyncStateRepository;
import com.safedeal.domain.port.DatabaseReadinessPort;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionOperations;
import org.web3j.crypto.ECKeyPair;
import org.web3j.crypto.Keys;

final class PersistenceContractVerifier {

    static final String CONTRACT = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

    private record ActorSession(String address, Cookie session, Cookie csrf) {
    }

    private PersistenceContractVerifier() {
    }

    static void configureGatewayDefaults(BlockchainGateway blockchainGateway) {
        when(blockchainGateway.isEnabled()).thenReturn(true);
        when(blockchainGateway.chainId()).thenReturn(31337L);
        when(blockchainGateway.chainName()).thenReturn("Anvil Local");
        when(blockchainGateway.contractAddress()).thenReturn(CONTRACT);
        when(blockchainGateway.deploymentBlock()).thenReturn(0L);
        when(blockchainGateway.confirmationsRequired()).thenReturn(1);
        when(blockchainGateway.syncBatchSize()).thenReturn(100L);
    }

    private static ActorSession loginAs(MockMvc mockMvc, ObjectMapper objectMapper, ECKeyPair keyPair)
        throws Exception {
        String address = ("0x" + Keys.getAddress(keyPair)).toLowerCase();
        MvcResult nonceRes = mockMvc.perform(post("/api/v1/auth/nonce")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"address\":\"" + address + "\",\"chainId\":31337}"))
            .andExpect(status().isOk())
            .andReturn();
        String msg = objectMapper.readTree(nonceRes.getResponse().getContentAsString()).get("message").asText();
        String sig = SiweAuthAndSecurityIntegrationTest.signPersonalMessage(keyPair, msg);
        MvcResult verifyRes = mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("message", msg, "signature", sig))))
            .andExpect(status().isOk())
            .andReturn();

        // Replay of exact SIWE message must fail on atomic consumeOnce update
        mockMvc.perform(post("/api/v1/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("message", msg, "signature", sig))))
            .andExpect(status().isUnauthorized());

        return new ActorSession(
            address,
            verifyRes.getResponse().getCookie("safedeal_session"),
            verifyRes.getResponse().getCookie("safedeal_csrf")
        );
    }

    static void verifyFullContract(
        MockMvc mockMvc,
        ObjectMapper objectMapper,
        DatabaseReadinessPort databaseReadinessPort,
        DealRepository dealRepository,
        DealEventRepository dealEventRepository,
        ChainEventRepository chainEventRepository,
        ChainSyncStateRepository chainSyncStateRepository,
        BlockchainEventIndexerService indexerService,
        TransactionOperations txOperations,
        BlockchainGateway blockchainGateway
    ) throws Exception {
        assertThat(databaseReadinessPort.isDatabaseConnected()).isTrue();

        ActorSession seller = loginAs(mockMvc, objectMapper, Keys.createEcKeyPair());
        ActorSession buyer = loginAs(mockMvc, objectMapper, Keys.createEcKeyPair());
        ActorSession arbiter = loginAs(mockMvc, objectMapper, Keys.createEcKeyPair());

        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();
        String amountWei = "1500000000000000000";

        MvcResult draftRes = mockMvc.perform(post("/api/v1/deals/drafts")
                .cookie(seller.session(), seller.csrf())
                .header("X-CSRF-Token", seller.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "title", "Flyway Persistence Contract Deal",
                    "description", "Verifying Flyway schema, locks, ON CONFLICT DO NOTHING, and JOINs.",
                    "amountWei", amountWei,
                    "buyerAddress", buyer.address(),
                    "arbiterAddress", arbiter.address(),
                    "fundingDeadlineEpochSeconds", fundingDeadline,
                    "deliveryDeadlineEpochSeconds", deliveryDeadline,
                    "inspectionWindowSeconds", 86400,
                    "terms", "All persistence constraints verified under Flyway schema."
                ))))
            .andExpect(status().isCreated())
            .andReturn();

        JsonNode draftJson = objectMapper.readTree(draftRes.getResponse().getContentAsString());
        String tradeId = draftJson.get("tradeId").asText();
        String termsHash = draftJson.get("termsHash").asText();

        String createTx = "0x" + "d".repeat(64);
        VerifiedChainEvent createdEvent = new VerifiedChainEvent(
            createTx, 0, 42L, Instant.now().getEpochSecond(), CONTRACT,
            OnChainEventType.TRADE_CREATED, tradeId, seller.address(), buyer.address(), amountWei, null, null, termsHash
        );
        when(blockchainGateway.inspectTransaction(createTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(createTx, true, 42L, seller.address(), CONTRACT, List.of(createdEvent))
        ));
        when(blockchainGateway.fetchTrade(tradeId)).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                tradeId, seller.address(), buyer.address(), arbiter.address(), amountWei, termsHash,
                fundingDeadline, deliveryDeadline, 86400L, 0L, 1, false, "0", "0"
            )
        ));

        mockMvc.perform(post("/api/v1/deals/" + tradeId + "/bind-tx")
                .cookie(seller.session(), seller.csrf())
                .header("X-CSRF-Token", seller.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"txHash\":\"" + createTx + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("CREATED"));

        // Verify SELECT ... FOR UPDATE and ON CONFLICT DO NOTHING idempotency inside one transaction
        String extraTx = "0x" + "a".repeat(64);
        VerifiedChainEvent freshChainEvent = new VerifiedChainEvent(
            extraTx, 0, 43L, Instant.now().getEpochSecond(), CONTRACT,
            OnChainEventType.DELIVERY_MARKED, tradeId, seller.address(), buyer.address(), null, null, null, null
        );
        txOperations.executeWithoutResult(status -> {
            Deal locked = dealRepository.findByTradeIdForUpdate(tradeId).orElseThrow();
            assertThat(locked.status()).isEqualTo(DealStatus.CREATED);

            // bind-tx already inserted createdEvent -> ON CONFLICT DO NOTHING skips duplicate
            assertThat(chainEventRepository.recordIfAbsent(createdEvent)).isFalse();

            // First insert of distinct (txHash, logIndex) returns true; replay returns false
            assertThat(chainEventRepository.recordIfAbsent(freshChainEvent)).isTrue();
            assertThat(chainEventRepository.recordIfAbsent(freshChainEvent)).isFalse();

            DealEvent alreadyBoundEvent = new DealEvent(
                null, tradeId, "TRADE_CREATED", seller.address(), createTx, 42L, 0, "Created", Instant.now()
            );
            assertThat(dealEventRepository.saveIfAbsent(alreadyBoundEvent)).isFalse();

            DealEvent freshDealEvent = new DealEvent(
                null, tradeId, "DELIVERY_MARKED", seller.address(), extraTx, 43L, 0, "Synthetic event", Instant.now()
            );
            assertThat(dealEventRepository.saveIfAbsent(freshDealEvent)).isTrue();
            assertThat(dealEventRepository.saveIfAbsent(freshDealEvent)).isFalse();
        });

        // Verify JPA Specification queries with LOWER() and status filter plus open-bound filter
        assertThat(dealRepository.findUserDeals(seller.address(), "seller", DealStatus.CREATED, 0, 20).items())
            .extracting(Deal::tradeId)
            .contains(tradeId);
        assertThat(dealRepository.findOpenBoundDeals())
            .extracting(Deal::tradeId)
            .contains(tradeId);

        // Verify indexer polls starting at cursor 1 (initialCursor = 0 -> cursor = lastSyncedBlock + 1) and deduplicates
        when(blockchainGateway.fetchLatestBlockNumber()).thenReturn(50L);
        when(blockchainGateway.fetchLogs(1L, 50L)).thenReturn(List.of(createdEvent));
        assertThat(indexerService.pollAndIndex()).isEqualTo(0);
        verify(blockchainGateway).fetchLogs(1L, 50L);
        assertThat(chainSyncStateRepository.findPrimary().orElseThrow().lastSyncedBlock()).isEqualTo(50L);

        // Open dispute, upload PNG evidence, query assigned disputes via JPQL JOIN, and resolve
        String disputeTx = "0x" + "e".repeat(64);
        when(blockchainGateway.inspectTransaction(disputeTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                disputeTx, true, 51L, buyer.address(), CONTRACT,
                List.of(new VerifiedChainEvent(
                    disputeTx, 0, 51L, Instant.now().getEpochSecond(), CONTRACT,
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
                    "reason", "Persistence E2E dispute",
                    "summary", "Testing dispute, evidence, and arbiter JOIN on Flyway schema.",
                    "txHash", disputeTx
                ))))
            .andExpect(status().isCreated())
            .andReturn();

        long disputeId = objectMapper.readTree(disputeRes.getResponse().getContentAsString()).get("id").asLong();

        byte[] pngBytes = new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01};
        MvcResult evidenceRes = mockMvc.perform(multipart("/api/v1/disputes/" + disputeId + "/evidence")
                .file(new MockMultipartFile("file", "pg-proof.png", "image/png", pngBytes))
                .param("title", "Persistence Proof")
                .param("notes", "Evidence persisted under Flyway schema")
                .cookie(buyer.session(), buyer.csrf())
                .header("X-CSRF-Token", buyer.csrf().getValue()))
            .andExpect(status().isCreated())
            .andReturn();
        long evidenceId = objectMapper.readTree(evidenceRes.getResponse().getContentAsString()).get("id").asLong();

        MvcResult downloadRes = mockMvc.perform(get("/api/v1/disputes/" + disputeId + "/evidence/" + evidenceId + "/download")
                .cookie(arbiter.session(), arbiter.csrf()))
            .andExpect(status().isOk())
            .andReturn();
        assertThat(downloadRes.getResponse().getContentAsByteArray()).isEqualTo(pngBytes);

        mockMvc.perform(get("/api/v1/arbitration/disputes")
                .cookie(arbiter.session(), arbiter.csrf()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(disputeId));

        String resolveTx = "0x" + "f".repeat(64);
        String buyerAwardWei = "1000000000000000000";
        String sellerAwardWei = "500000000000000000";
        when(blockchainGateway.inspectTransaction(resolveTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                resolveTx, true, 55L, arbiter.address(), CONTRACT,
                List.of(new VerifiedChainEvent(
                    resolveTx, 0, 55L, Instant.now().getEpochSecond(), CONTRACT,
                    OnChainEventType.DISPUTE_RESOLVED, tradeId, arbiter.address(), buyer.address(), null,
                    buyerAwardWei, sellerAwardWei, null
                ))
            )
        ));
        when(blockchainGateway.fetchTrade(tradeId)).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                tradeId, seller.address(), buyer.address(), arbiter.address(), amountWei, termsHash,
                fundingDeadline, deliveryDeadline, 86400L, 0L, 7, true, buyerAwardWei, sellerAwardWei
            )
        ));

        mockMvc.perform(post("/api/v1/arbitration/disputes/" + disputeId + "/resolution")
                .cookie(arbiter.session(), arbiter.csrf())
                .header("X-CSRF-Token", arbiter.csrf().getValue())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "txHash", resolveTx,
                    "rationale", "Settled 2/3 to buyer and 1/3 to seller after verifying uploaded PNG proof."
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("RESOLVED"))
            .andExpect(jsonPath("$.buyerAwardWei").value(buyerAwardWei))
            .andExpect(jsonPath("$.sellerAwardWei").value(sellerAwardWei));

        assertThat(dealRepository.findOpenBoundDeals())
            .extracting(Deal::tradeId)
            .doesNotContain(tradeId);
    }
}
