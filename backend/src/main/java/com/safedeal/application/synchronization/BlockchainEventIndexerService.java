package com.safedeal.application.synchronization;

import com.safedeal.domain.blockchain.ChainSyncState;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.Dispute;
import com.safedeal.domain.dispute.DisputeStatus;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.ChainEventRepository;
import com.safedeal.domain.port.ChainSyncStateRepository;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.domain.port.DisputeRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

@Service
public class BlockchainEventIndexerService {

    private static final Logger log = LoggerFactory.getLogger(BlockchainEventIndexerService.class);

    private final BlockchainGateway blockchainGateway;
    private final ChainSyncStateRepository syncStateRepository;
    private final ChainEventRepository chainEventRepository;
    private final DealRepository dealRepository;
    private final DealEventRepository dealEventRepository;
    private final DisputeRepository disputeRepository;
    private final TransactionOperations txTemplate;
    private final Clock clock;
    private final ReentrantLock pollLock = new ReentrantLock();

    public BlockchainEventIndexerService(
        BlockchainGateway blockchainGateway,
        ChainSyncStateRepository syncStateRepository,
        ChainEventRepository chainEventRepository,
        DealRepository dealRepository,
        DealEventRepository dealEventRepository,
        DisputeRepository disputeRepository,
        TransactionOperations txTemplate,
        Clock clock
    ) {
        this.blockchainGateway = blockchainGateway;
        this.syncStateRepository = syncStateRepository;
        this.chainEventRepository = chainEventRepository;
        this.dealRepository = dealRepository;
        this.dealEventRepository = dealEventRepository;
        this.disputeRepository = disputeRepository;
        this.txTemplate = txTemplate;
        this.clock = clock;
    }

    public int pollAndIndex() {
        if (!blockchainGateway.isEnabled() || blockchainGateway.contractAddress().isBlank()) {
            return 0;
        }
        if (!pollLock.tryLock()) {
            return 0;
        }
        try {
            return doPollAndIndex();
        } finally {
            pollLock.unlock();
        }
    }

    private int doPollAndIndex() {

        long latestBlock = blockchainGateway.fetchLatestBlockNumber();
        long confirmationsLag = Math.max(0, blockchainGateway.confirmationsRequired() - 1);
        long safeHead = Math.max(0L, latestBlock - confirmationsLag);

        long configuredChainId = blockchainGateway.chainId();
        String configuredContract = blockchainGateway.contractAddress().toLowerCase();
        long initialCursor = Math.max(0L, blockchainGateway.deploymentBlock() - 1);

        ChainSyncState state = txTemplate.execute(s -> {
            ChainSyncState existing = syncStateRepository.findPrimary().orElse(null);
            if (existing == null
                || existing.chainId() != configuredChainId
                || !existing.contractAddress().equalsIgnoreCase(configuredContract)) {
                return syncStateRepository.save(new ChainSyncState(
                    1,
                    configuredChainId,
                    configuredContract,
                    initialCursor,
                    Instant.now(clock)
                ));
            }
            return existing;
        });

        if (state == null || safeHead <= state.lastSyncedBlock()) {
            return 0;
        }

        long batchSize = Math.max(10L, blockchainGateway.syncBatchSize());
        long cursor = state.lastSyncedBlock() + 1;
        int totalProcessed = 0;

        while (cursor <= safeHead) {
            long toBlock = Math.min(safeHead, cursor + batchSize - 1);
            List<VerifiedChainEvent> events = blockchainGateway.fetchLogs(cursor, toBlock);
            final long chunkTo = toBlock;
            Integer insertedInChunk = txTemplate.execute(s -> {
                int applied = 0;
                for (VerifiedChainEvent ev : events) {
                    Deal lockedDeal = (ev.tradeId() != null && ev.eventType() != OnChainEventType.FUNDS_WITHDRAWN)
                        ? dealRepository.findByTradeIdForUpdate(ev.tradeId()).orElse(null)
                        : null;
                    if (chainEventRepository.recordIfAbsent(ev)) {
                        applyEventToDealProjection(ev, lockedDeal);
                        applied++;
                    }
                }
                syncStateRepository.save(new ChainSyncState(
                    1,
                    blockchainGateway.chainId(),
                    blockchainGateway.contractAddress().toLowerCase(),
                    chunkTo,
                    Instant.now(clock)
                ));
                return applied;
            });
            totalProcessed += insertedInChunk != null ? insertedInChunk : 0;
            cursor = toBlock + 1;
        }

        if (totalProcessed > 0) {
            log.info("Indexed {} new SafeDealEscrow events up to block {}", totalProcessed, safeHead);
        }
        return totalProcessed;
    }

    private void applyEventToDealProjection(VerifiedChainEvent ev, Deal current) {
        if (current == null || ev.tradeId() == null || ev.eventType() == OnChainEventType.FUNDS_WITHDRAWN) {
            return;
        }

        DealStatus nextStatus = switch (ev.eventType()) {
            case TRADE_CREATED -> DealStatus.CREATED;
            case TRADE_FUNDED -> DealStatus.FUNDED;
            case DELIVERY_MARKED -> DealStatus.DELIVERED;
            case FUNDS_RELEASED -> DealStatus.RELEASED;
            case REFUND_EXECUTED -> DealStatus.REFUNDED;
            case DISPUTE_OPENED -> DealStatus.DISPUTED;
            case DISPUTE_RESOLVED -> DealStatus.RESOLVED;
            case TRADE_CANCELLED -> DealStatus.CANCELLED;
            case FUNDS_WITHDRAWN -> current.status();
        };

        Instant eventTime = Instant.ofEpochSecond(ev.blockTimestampEpoch());
        String buyer = (ev.buyerAddress() != null && !ev.buyerAddress().isBlank())
            ? ev.buyerAddress().toLowerCase()
            : current.buyer();
        Instant fundedAt = (ev.eventType() == OnChainEventType.TRADE_FUNDED && current.fundedAt() == null)
            ? eventTime
            : current.fundedAt();
        Instant deliveredAt = (ev.eventType() == OnChainEventType.DELIVERY_MARKED)
            ? eventTime
            : current.deliveredAt();
        String buyerAward = ev.eventType() == OnChainEventType.DISPUTE_RESOLVED
            ? ev.buyerAwardWei()
            : current.buyerAwardWei();
        String sellerAward = ev.eventType() == OnChainEventType.DISPUTE_RESOLVED
            ? ev.sellerAwardWei()
            : current.sellerAwardWei();

        if (current.status().canReconcileTo(nextStatus)) {
            dealRepository.save(new Deal(
                current.id(),
                current.tradeId(),
                current.chainId(),
                current.contractAddress(),
                current.seller(),
                buyer,
                current.arbiter(),
                current.amountWei(),
                current.termsHash(),
                current.fundingDeadline(),
                current.deliveryDeadline(),
                current.inspectionWindowSeconds(),
                deliveredAt,
                fundedAt,
                nextStatus,
                true,
                nextStatus.isSettled(),
                current.createTxHash() != null
                    ? current.createTxHash()
                    : (ev.eventType() == OnChainEventType.TRADE_CREATED ? ev.txHash() : null),
                buyerAward,
                sellerAward,
                current.title(),
                current.description(),
                current.terms(),
                current.canonicalTermsJson(),
                current.schemaVersion(),
                current.createdAt(),
                Instant.now(clock)
            ));
        }

        Instant timelineTime = eventTime.isBefore(current.createdAt()) ? current.createdAt() : eventTime;
        dealEventRepository.saveIfAbsent(new DealEvent(
            null,
            ev.tradeId(),
            ev.eventType().name(),
            ev.actorAddress(),
            ev.txHash(),
            ev.blockNumber(),
            ev.logIndex(),
            "Indexed event " + ev.eventType().name() + " at block " + ev.blockNumber(),
            timelineTime
        ));

        if (ev.eventType() == OnChainEventType.DISPUTE_RESOLVED) {
            Dispute existing = disputeRepository.findByTradeId(ev.tradeId()).orElse(null);
            if (existing != null && existing.status() == DisputeStatus.OPEN) {
                disputeRepository.save(new Dispute(
                    existing.id(),
                    existing.tradeId(),
                    existing.openedBy(),
                    existing.reason(),
                    existing.summary(),
                    DisputeStatus.RESOLVED,
                    ev.buyerAwardWei(),
                    ev.sellerAwardWei(),
                    existing.resolutionRationale(),
                    existing.openTxHash(),
                    ev.txHash(),
                    existing.createdAt(),
                    eventTime
                ));
            }
        }
    }
}
