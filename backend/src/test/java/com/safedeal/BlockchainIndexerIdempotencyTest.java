package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.safedeal.application.deal.CreateDealDraftUseCase;
import com.safedeal.application.synchronization.BlockchainEventIndexerService;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.ChainSyncStateRepository;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@ActiveProfiles("test")
class BlockchainIndexerIdempotencyTest {

    private static final String CONTRACT = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

    @Autowired
    private CreateDealDraftUseCase createDraft;

    @Autowired
    private BlockchainEventIndexerService indexerService;

    @Autowired
    private DealRepository dealRepository;

    @Autowired
    private DealEventRepository dealEventRepository;

    @Autowired
    private ChainSyncStateRepository syncStateRepository;

    @MockitoBean
    private BlockchainGateway blockchainGateway;

    @Test
    void deduplicatesChainEventsByTxHashAndLogIndexAcrossReplayedBlocks() {
        String seller = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
        String buyer = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
        String arbiter = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

        when(blockchainGateway.isEnabled()).thenReturn(true);
        when(blockchainGateway.chainId()).thenReturn(31337L);
        when(blockchainGateway.contractAddress()).thenReturn(CONTRACT);
        when(blockchainGateway.deploymentBlock()).thenReturn(1L);
        when(blockchainGateway.confirmationsRequired()).thenReturn(1);
        when(blockchainGateway.syncBatchSize()).thenReturn(100L);

        Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
            seller,
            null,
            arbiter,
            "1000000000000000000",
            Instant.now().plusSeconds(3600).getEpochSecond(),
            Instant.now().plusSeconds(7200).getEpochSecond(),
            86400L,
            "Indexer Test Deal",
            "Verifying log deduplication and cursor resumption",
            "Delivered upon milestone confirmation"
        ));

        long nowEpoch = Instant.now().getEpochSecond();
        VerifiedChainEvent evCreated = new VerifiedChainEvent(
            "0x" + "1".repeat(64), 0, 5L, nowEpoch, CONTRACT,
            OnChainEventType.TRADE_CREATED, draft.tradeId(), seller, null,
            "1000000000000000000", null, null, draft.termsHash()
        );
        VerifiedChainEvent evFunded = new VerifiedChainEvent(
            "0x" + "2".repeat(64), 0, 8L, nowEpoch + 10, CONTRACT,
            OnChainEventType.TRADE_FUNDED, draft.tradeId(), buyer, buyer,
            "1000000000000000000", null, null, null
        );

        when(blockchainGateway.fetchLatestBlockNumber()).thenReturn(10L);
        when(blockchainGateway.fetchLogs(anyLong(), anyLong())).thenReturn(List.of(evCreated, evFunded));

        int firstProcessed = indexerService.pollAndIndex();
        assertThat(firstProcessed).isEqualTo(2);

        Deal updated = dealRepository.findByTradeId(draft.tradeId()).orElseThrow();
        assertThat(updated.status()).isEqualTo(DealStatus.FUNDED);
        assertThat(updated.buyer()).isEqualTo(buyer);
        assertThat(updated.onChainBound()).isTrue();
        assertThat(syncStateRepository.findPrimary().orElseThrow().lastSyncedBlock()).isEqualTo(10L);

        // Advance block head cleanly and return duplicate log batch -> 0 new processed events
        when(blockchainGateway.fetchLatestBlockNumber()).thenReturn(12L);
        int secondProcessed = indexerService.pollAndIndex();
        assertThat(secondProcessed).isEqualTo(0);

        assertThat(dealEventRepository.findByTradeIdOrderByCreatedAtAsc(draft.tradeId()))
            .extracting("eventType")
            .containsExactly("DRAFT_CREATED", "TRADE_CREATED", "TRADE_FUNDED");
    }
}
