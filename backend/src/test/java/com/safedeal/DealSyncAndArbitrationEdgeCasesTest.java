package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.safedeal.application.arbitration.ArbitrationUseCase;
import com.safedeal.application.deal.BindDealTransactionUseCase;
import com.safedeal.application.deal.CreateDealDraftUseCase;
import com.safedeal.application.deal.SyncDealUseCase;
import com.safedeal.application.dispute.DisputeUseCase;
import com.safedeal.application.synchronization.BlockchainEventIndexerService;
import com.safedeal.domain.blockchain.ChainSyncState;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.DisputeStatus;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.ChainSyncStateRepository;
import com.safedeal.domain.port.DealEventRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:safedeal_edge_cases;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1"
})
class DealSyncAndArbitrationEdgeCasesTest {

    private static final String CONTRACT = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

    @Autowired
    private CreateDealDraftUseCase createDraft;

    @Autowired
    private BindDealTransactionUseCase bindDealTransactionUseCase;

    @Autowired
    private SyncDealUseCase syncDealUseCase;

    @Autowired
    private DealEventRepository dealEventRepository;

    @Autowired
    private ChainSyncStateRepository syncStateRepository;

    @Autowired
    private DisputeUseCase disputeUseCase;

    @Autowired
    private BlockchainEventIndexerService indexerService;

    @Autowired
    private ArbitrationUseCase arbitrationUseCase;

    @MockitoBean
    private BlockchainGateway blockchainGateway;

    @BeforeEach
    void setupGateway() {
        syncStateRepository.save(new ChainSyncState(1, 31337L, CONTRACT, 0L, Instant.now()));
        when(blockchainGateway.isEnabled()).thenReturn(true);
        when(blockchainGateway.chainId()).thenReturn(31337L);
        when(blockchainGateway.contractAddress()).thenReturn(CONTRACT);
        when(blockchainGateway.deploymentBlock()).thenReturn(0L);
        when(blockchainGateway.confirmationsRequired()).thenReturn(1);
        when(blockchainGateway.syncBatchSize()).thenReturn(100L);
    }

    @Test
    void syncDealDoesNotOverwriteCreateTxHashWithNonCreateTransactionHash() {
        String seller = "0x1111111111111111111111111111111111111111";
        String buyer = "0x2222222222222222222222222222222222222222";
        String arbiter = "0x3333333333333333333333333333333333333333";
        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();

        Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
            seller,
            buyer,
            arbiter,
            "1000000000000000000",
            fundingDeadline,
            deliveryDeadline,
            3600L,
            "Sync Hash Purity Test",
            "Verifying sync preserves createTxHash semantics cleanly.",
            "Standard escrow agreement terms applied."
        ));

        String fundTxHash = "0x" + "f".repeat(64);
        VerifiedChainEvent fundEvent = new VerifiedChainEvent(
            fundTxHash, 0, 20L, Instant.now().getEpochSecond(), CONTRACT,
            OnChainEventType.TRADE_FUNDED, draft.tradeId(), buyer, buyer,
            draft.amountWei(), null, null, null
        );
        when(blockchainGateway.inspectTransaction(fundTxHash)).thenReturn(Optional.of(
            new TransactionVerificationResult(fundTxHash, true, 20L, buyer, CONTRACT, List.of(fundEvent))
        ));
        when(blockchainGateway.fetchTrade(draft.tradeId())).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                draft.tradeId(), seller, buyer, arbiter, draft.amountWei(), draft.termsHash(),
                fundingDeadline, deliveryDeadline, 3600L, 0L, 2, false, "0", "0"
            )
        ));

        Deal synced = syncDealUseCase.execute(draft.tradeId(), fundTxHash, buyer);
        assertThat(synced.status()).isEqualTo(DealStatus.FUNDED);
        assertThat(synced.createTxHash()).isNull();
    }

    @Test
    void recordResolutionBackfillsRationaleWhenIndexerAlreadyIndexedDisputeResolved() {
        String seller = "0x4444444444444444444444444444444444444444";
        String buyer = "0x5555555555555555555555555555555555555555";
        String arbiter = "0x6666666666666666666666666666666666666666";
        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();

        Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
            seller,
            buyer,
            arbiter,
            "2000000000000000000",
            fundingDeadline,
            deliveryDeadline,
            3600L,
            "Indexer Rationale Backfill Test",
            "Verifying arbiter rationale survives background log sync.",
            "Arbiter split resolution applied cleanly."
        ));

        String disputeTx = "0x" + "d".repeat(64);
        when(blockchainGateway.inspectTransaction(disputeTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                disputeTx, true, 30L, buyer, CONTRACT,
                List.of(new VerifiedChainEvent(
                    disputeTx, 0, 30L, Instant.now().getEpochSecond(), CONTRACT,
                    OnChainEventType.DISPUTE_OPENED, draft.tradeId(), buyer, buyer, null, null, null, null
                ))
            )
        ));
        when(blockchainGateway.fetchTrade(draft.tradeId())).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                draft.tradeId(), seller, buyer, arbiter, draft.amountWei(), draft.termsHash(),
                fundingDeadline, deliveryDeadline, 3600L, 0L, 6, false, "0", "0"
            )
        ));

        var disputeCtx = disputeUseCase.openDispute(
            draft.tradeId(),
            buyer,
            "Incomplete handoff",
            "Acceptance criteria evidence failed check.",
            disputeTx
        );
        Long disputeId = disputeCtx.dispute().id();

        String resolveTx = "0x" + "e".repeat(64);
        VerifiedChainEvent resolvedEv = new VerifiedChainEvent(
            resolveTx, 0, 35L, Instant.now().getEpochSecond(), CONTRACT,
            OnChainEventType.DISPUTE_RESOLVED, draft.tradeId(), arbiter, buyer, null,
            "1000000000000000000", "1000000000000000000", null
        );
        when(blockchainGateway.fetchLatestBlockNumber()).thenReturn(35L);
        when(blockchainGateway.fetchLogs(anyLong(), anyLong())).thenReturn(List.of(resolvedEv));

        int indexed = indexerService.pollAndIndex();
        assertThat(indexed).isEqualTo(1);
        assertThat(disputeUseCase.getDispute(disputeId, arbiter).dispute().status())
            .isEqualTo(DisputeStatus.RESOLVED);
        assertThat(disputeUseCase.getDispute(disputeId, arbiter).dispute().resolutionRationale())
            .isNull();

        var backfilled = arbitrationUseCase.recordResolution(
            disputeId,
            arbiter,
            resolveTx,
            "50/50 split awarded based on submitted evidence."
        );
        assertThat(backfilled.dispute().status()).isEqualTo(DisputeStatus.RESOLVED);
        assertThat(backfilled.dispute().resolutionRationale())
            .isEqualTo("50/50 split awarded based on submitted evidence.");
    }

    @Test
    void syncDealRejectsUnrelatedContractAndCrossTradeTransactionsAndUsesEventBlockTimestamp() {
        String seller = "0x7777777777777777777777777777777777777777";
        String buyer = "0x8888888888888888888888888888888888888888";
        String arbiter = "0x9999999999999999999999999999999999999999";
        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();

        Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
            seller,
            buyer,
            arbiter,
            "1000000000000000000",
            fundingDeadline,
            deliveryDeadline,
            3600L,
            "Sync Spoofing Rejection Test",
            "Verifying txHash spoofing and fundedAt timestamp accuracy.",
            "Standard escrow agreement terms applied."
        ));

        when(blockchainGateway.fetchTrade(draft.tradeId())).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                draft.tradeId(), seller, buyer, arbiter, draft.amountWei(), draft.termsHash(),
                fundingDeadline, deliveryDeadline, 3600L, 0L, 2, false, "0", "0"
            )
        ));

        String wrongContractTx = "0x" + "1".repeat(64);
        when(blockchainGateway.inspectTransaction(wrongContractTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                wrongContractTx, true, 50L, buyer, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", List.of()
            )
        ));
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
            syncDealUseCase.execute(draft.tradeId(), wrongContractTx, buyer)
        ).isInstanceOf(com.safedeal.shared.exception.ValidationException.class)
            .hasMessageContaining("SafeDealEscrow");

        String otherTradeId = "0x" + "9".repeat(64);
        String crossTradeTx = "0x" + "2".repeat(64);
        VerifiedChainEvent otherTradeEvent = new VerifiedChainEvent(
            crossTradeTx, 0, 51L, Instant.now().getEpochSecond(), CONTRACT,
            OnChainEventType.TRADE_FUNDED, otherTradeId, buyer, buyer,
            draft.amountWei(), null, null, null
        );
        when(blockchainGateway.inspectTransaction(crossTradeTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(crossTradeTx, true, 51L, buyer, CONTRACT, List.of(otherTradeEvent))
        ));
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
            syncDealUseCase.execute(draft.tradeId(), crossTradeTx, buyer)
        ).isInstanceOf(com.safedeal.shared.exception.ValidationException.class)
            .hasMessageContaining(draft.tradeId());

        long chainBlockTs = Instant.now().minusSeconds(120).getEpochSecond();
        String realFundTx = "0x" + "3".repeat(64);
        VerifiedChainEvent realFundEvent = new VerifiedChainEvent(
            realFundTx, 0, 52L, chainBlockTs, CONTRACT,
            OnChainEventType.TRADE_FUNDED, draft.tradeId(), buyer, buyer,
            draft.amountWei(), null, null, null
        );
        when(blockchainGateway.inspectTransaction(realFundTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(realFundTx, true, 52L, buyer, CONTRACT, List.of(realFundEvent))
        ));
        Deal synced = syncDealUseCase.execute(draft.tradeId(), realFundTx, buyer);
        assertThat(synced.fundedAt()).isEqualTo(Instant.ofEpochSecond(chainBlockTs));
    }

    @Test
    void openDisputeRejectsValidTransactionOfSameTradeThatIsNotDisputeOpened() {
        String seller = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String buyer = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        String arbiter = "0xcccccccccccccccccccccccccccccccccccccccc";
        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();

        Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
            seller,
            buyer,
            arbiter,
            "1000000000000000000",
            fundingDeadline,
            deliveryDeadline,
            3600L,
            "Open Dispute Tx Verification Test",
            "Ensures non-dispute transactions cannot masquerade as openTxHash.",
            "Standard escrow agreement terms applied."
        ));

        String fundTx = "0x" + "4".repeat(64);
        when(blockchainGateway.inspectTransaction(fundTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(
                fundTx, true, 60L, buyer, CONTRACT,
                List.of(new VerifiedChainEvent(
                    fundTx, 0, 60L, Instant.now().getEpochSecond(), CONTRACT,
                    OnChainEventType.TRADE_FUNDED, draft.tradeId(), buyer, buyer, draft.amountWei(), null, null, null
                ))
            )
        ));
        when(blockchainGateway.fetchTrade(draft.tradeId())).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                draft.tradeId(), seller, buyer, arbiter, draft.amountWei(), draft.termsHash(),
                fundingDeadline, deliveryDeadline, 3600L, 0L, 6, false, "0", "0"
            )
        ));

        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
            disputeUseCase.openDispute(
                draft.tradeId(),
                buyer,
                "Wrong event tx",
                "Trying to record funding tx hash as dispute tx hash.",
                fundTx
            )
        ).isInstanceOf(com.safedeal.shared.exception.ValidationException.class)
            .hasMessageContaining("DisputeOpened");
    }

    @Test
    void concurrentBindTxAndIndexerPollDoNotThrowUniqueConstraintViolationOrDropEvents() throws Exception {
        String seller = "0x1212121212121212121212121212121212121212";
        String buyer = "0x2323232323232323232323232323232323232323";
        String arbiter = "0x3434343434343434343434343434343434343434";
        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();

        for (int attempt = 0; attempt < 15; attempt++) {
            Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
                seller,
                buyer,
                arbiter,
                "1000000000000000000",
                fundingDeadline,
                deliveryDeadline,
                3600L,
                "Concurrent Bind Race #" + attempt,
                "Exercises concurrent BindDealTransactionUseCase and BlockchainEventIndexerService.",
                "Standard escrow agreement terms applied."
            ));

            String createTx = String.format("0xca%02d%s", attempt, "0".repeat(60));
            long blockNum = 100L + attempt;
            VerifiedChainEvent createdEv = new VerifiedChainEvent(
                createTx, 0, blockNum, Instant.now().getEpochSecond(), CONTRACT,
                OnChainEventType.TRADE_CREATED, draft.tradeId(), seller, buyer,
                draft.amountWei(), null, null, draft.termsHash()
            );

            when(blockchainGateway.inspectTransaction(createTx)).thenReturn(Optional.of(
                new TransactionVerificationResult(createTx, true, blockNum, seller, CONTRACT, List.of(createdEv))
            ));
            when(blockchainGateway.fetchTrade(draft.tradeId())).thenReturn(Optional.of(
                new OnChainTradeSnapshot(
                    draft.tradeId(), seller, buyer, arbiter, draft.amountWei(), draft.termsHash(),
                    fundingDeadline, deliveryDeadline, 3600L, 0L, 1, false, "0", "0"
                )
            ));
            when(blockchainGateway.fetchLatestBlockNumber()).thenReturn(blockNum);
            when(blockchainGateway.fetchLogs(anyLong(), anyLong())).thenReturn(List.of(createdEv));

            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            try (var pool = Executors.newFixedThreadPool(2)) {
                Future<Deal> bindFuture = pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return bindDealTransactionUseCase.execute(draft.tradeId(), createTx, seller);
                });
                Future<Integer> indexFuture = pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return indexerService.pollAndIndex();
                });

                ready.await();
                start.countDown();

                Deal bound = bindFuture.get();
                indexFuture.get();
                assertThat(bound.status()).isEqualTo(DealStatus.CREATED);
                assertThat(bound.onChainBound()).isTrue();
                assertThat(bound.createTxHash()).isEqualTo(createTx);
                assertThat(dealEventRepository.findByTradeIdOrderByCreatedAtAsc(draft.tradeId()))
                    .filteredOn(ev -> "TRADE_CREATED".equals(ev.eventType()))
                    .hasSize(1);
            }
        }
    }

    @Test
    void syncDealWithStaleSnapshotDoesNotRegressStatusWhenIndexerAlreadyAdvancedDeal() {
        String seller = "0x4545454545454545454545454545454545454545";
        String buyer = "0x5656565656565656565656565656565656565656";
        String arbiter = "0x6767676767676767676767676767676767676767";
        long fundingDeadline = Instant.now().plusSeconds(3600).getEpochSecond();
        long deliveryDeadline = Instant.now().plusSeconds(7200).getEpochSecond();

        Deal draft = createDraft.execute(new CreateDealDraftUseCase.Command(
            seller,
            buyer,
            arbiter,
            "1000000000000000000",
            fundingDeadline,
            deliveryDeadline,
            3600L,
            "Stale Sync Guard",
            "Ensures out-of-order stale sync never fails with 400 or regresses deal state.",
            "Standard escrow agreement terms applied."
        ));

        String createTx = "0xf1" + "0".repeat(62);
        String fundTx = "0xf2" + "0".repeat(62);
        String deliverTx = "0xf3" + "0".repeat(62);
        long ts = Instant.now().getEpochSecond();
        VerifiedChainEvent evCreated = new VerifiedChainEvent(
            createTx, 0, 200L, ts, CONTRACT,
            OnChainEventType.TRADE_CREATED, draft.tradeId(), seller, buyer, draft.amountWei(), null, null, draft.termsHash()
        );
        VerifiedChainEvent evFunded = new VerifiedChainEvent(
            fundTx, 0, 201L, ts + 1, CONTRACT,
            OnChainEventType.TRADE_FUNDED, draft.tradeId(), buyer, buyer, draft.amountWei(), null, null, null
        );
        VerifiedChainEvent evDelivered = new VerifiedChainEvent(
            deliverTx, 0, 202L, ts + 2, CONTRACT,
            OnChainEventType.DELIVERY_MARKED, draft.tradeId(), seller, null, null, null, null, null
        );

        when(blockchainGateway.fetchLatestBlockNumber()).thenReturn(202L);
        when(blockchainGateway.fetchLogs(anyLong(), anyLong())).thenReturn(List.of(evCreated, evFunded, evDelivered));
        indexerService.pollAndIndex();

        // Simulate stale snapshot still reporting FUNDED (2) while DB already moved to DELIVERED (3)
        when(blockchainGateway.inspectTransaction(fundTx)).thenReturn(Optional.of(
            new TransactionVerificationResult(fundTx, true, 201L, buyer, CONTRACT, List.of(evFunded))
        ));
        when(blockchainGateway.fetchTrade(draft.tradeId())).thenReturn(Optional.of(
            new OnChainTradeSnapshot(
                draft.tradeId(), seller, buyer, arbiter, draft.amountWei(), draft.termsHash(),
                fundingDeadline, deliveryDeadline, 3600L, ts + 2, 2, false, "0", "0"
            )
        ));

        Deal synced = syncDealUseCase.execute(draft.tradeId(), fundTx, buyer);
        assertThat(synced.status()).isEqualTo(DealStatus.DELIVERED);
    }
}
