package com.safedeal.application.deal;

import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.BlockchainTransaction;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.AuditLogEntry;
import com.safedeal.domain.port.AuditLogRepository;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.BlockchainTransactionRepository;
import com.safedeal.domain.port.ChainEventRepository;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.shared.exception.ConflictException;
import com.safedeal.shared.exception.ExternalServiceException;
import com.safedeal.shared.exception.ForbiddenException;
import com.safedeal.shared.exception.NotFoundException;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.CorrelationIdContext;
import com.safedeal.shared.validation.EthFormatValidator;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

@Service
public class BindDealTransactionUseCase {

    private final DealRepository dealRepository;
    private final DealEventRepository dealEventRepository;
    private final ChainEventRepository chainEventRepository;
    private final BlockchainTransactionRepository txRepository;
    private final AuditLogRepository auditLogRepository;
    private final BlockchainGateway blockchainGateway;
    private final TransactionOperations txTemplate;
    private final Clock clock;

    public BindDealTransactionUseCase(
        DealRepository dealRepository,
        DealEventRepository dealEventRepository,
        ChainEventRepository chainEventRepository,
        BlockchainTransactionRepository txRepository,
        AuditLogRepository auditLogRepository,
        BlockchainGateway blockchainGateway,
        TransactionOperations txTemplate,
        Clock clock
    ) {
        this.dealRepository = dealRepository;
        this.dealEventRepository = dealEventRepository;
        this.chainEventRepository = chainEventRepository;
        this.txRepository = txRepository;
        this.auditLogRepository = auditLogRepository;
        this.blockchainGateway = blockchainGateway;
        this.txTemplate = txTemplate;
        this.clock = clock;
    }

    public Deal execute(String rawTradeId, String rawTxHash, String callerAddress) {
        String tradeId = EthFormatValidator.requireBytes32(rawTradeId, "tradeId");
        String txHash = EthFormatValidator.requireBytes32(rawTxHash, "txHash");
        String caller = EthFormatValidator.requireAddress(callerAddress, "callerAddress");

        if (!blockchainGateway.isEnabled()) {
            throw new ExternalServiceException("Blockchain verification is currently disabled on this server.");
        }

        // Phase 1: DB pre-check (short read/lock transaction)
        Deal deal = txTemplate.execute(status -> {
            Deal found = dealRepository.findByTradeIdForUpdate(tradeId)
                .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
            if (!found.seller().equalsIgnoreCase(caller)) {
                throw new ForbiddenException("Only the deal seller can bind the initial createTrade transaction.");
            }
            if (found.onChainBound() && found.createTxHash() != null && found.createTxHash().equalsIgnoreCase(txHash)) {
                return found;
            }
            if (found.onChainBound()) {
                throw new ConflictException("Deal is already bound on-chain.");
            }
            dealRepository.findByCreateTxHash(txHash)
                .filter(existing -> !existing.tradeId().equalsIgnoreCase(tradeId))
                .ifPresent(existing -> {
                    throw new ConflictException("Transaction hash is already bound to another deal.");
                });
            return found;
        });

        if (deal.onChainBound() && txHash.equalsIgnoreCase(deal.createTxHash())) {
            return deal;
        }

        // Phase 2: External RPC verification OUTSIDE any open database transaction
        TransactionVerificationResult receipt = blockchainGateway.inspectTransaction(txHash)
            .orElseThrow(() -> new ValidationException("Transaction receipt not found or still pending on-chain: " + txHash));

        if (!receipt.succeeded()) {
            throw new ValidationException("Transaction reverted on-chain and cannot bind deal: " + txHash);
        }
        String configuredContract = blockchainGateway.contractAddress().toLowerCase();
        if (receipt.toAddress() == null || !receipt.toAddress().equalsIgnoreCase(configuredContract)) {
            throw new ValidationException("Transaction target contract does not match SafeDealEscrow.");
        }

        VerifiedChainEvent createdEvent = receipt.decodedEvents().stream()
            .filter(ev -> ev.eventType() == OnChainEventType.TRADE_CREATED && tradeId.equalsIgnoreCase(ev.tradeId()))
            .findFirst()
            .orElseThrow(() -> new ValidationException("Receipt does not contain a matching TradeCreated event for tradeId."));

        if (!deal.seller().equalsIgnoreCase(createdEvent.actorAddress())) {
            throw new ValidationException("On-chain TradeCreated seller does not match draft seller.");
        }
        if (createdEvent.termsHash() == null || !deal.termsHash().equalsIgnoreCase(createdEvent.termsHash())) {
            throw new ValidationException("On-chain termsHash does not match canonical draft termsHash.");
        }
        if (createdEvent.amountWei() == null || !deal.amountWei().equals(createdEvent.amountWei())) {
            throw new ValidationException("On-chain escrow amount does not match draft amountWei.");
        }

        OnChainTradeSnapshot snapshot = blockchainGateway.fetchTrade(tradeId)
            .orElseThrow(() -> new ExternalServiceException("Unable to read on-chain trade state for " + tradeId));
        if (!deal.arbiter().equalsIgnoreCase(snapshot.arbiter())
            || !deal.termsHash().equalsIgnoreCase(snapshot.termsHash())
            || !deal.amountWei().equals(snapshot.amountWei())) {
            throw new ValidationException("On-chain trade parameters mismatch canonical draft terms.");
        }

        // Phase 3: Atomic persistence commit
        Instant now = Instant.now(clock);
        return txTemplate.execute(status -> {
            Deal current = dealRepository.findByTradeIdForUpdate(tradeId)
                .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
            if (current.onChainBound()) {
                if (current.createTxHash() != null && !current.createTxHash().equalsIgnoreCase(txHash)) {
                    throw new ConflictException("Deal is already bound on-chain.");
                }
                txRepository.saveOrUpdate(new BlockchainTransaction(
                    null,
                    tradeId,
                    txHash,
                    "CREATE_TRADE",
                    "CONFIRMED",
                    receipt.blockNumber(),
                    caller,
                    now,
                    now
                ));
                return current;
            }
            dealRepository.findByCreateTxHash(txHash)
                .filter(existing -> !existing.tradeId().equalsIgnoreCase(tradeId))
                .ifPresent(existing -> {
                    throw new ConflictException("Transaction hash is already bound to another deal.");
                });

            DealStatus reconciledStatus = snapshot.toDealStatus();
            String resolvedBuyer = snapshot.buyer() != null && !EthFormatValidator.ZERO_ADDRESS.equalsIgnoreCase(snapshot.buyer())
                ? snapshot.buyer().toLowerCase()
                : current.buyer();
            Instant deliveredAt = snapshot.deliveredAtEpoch() > 0
                ? Instant.ofEpochSecond(snapshot.deliveredAtEpoch())
                : current.deliveredAt();

            Deal updated = new Deal(
                current.id(),
                current.tradeId(),
                current.chainId(),
                configuredContract,
                current.seller(),
                resolvedBuyer,
                current.arbiter(),
                current.amountWei(),
                current.termsHash(),
                current.fundingDeadline(),
                current.deliveryDeadline(),
                current.inspectionWindowSeconds(),
                deliveredAt,
                current.fundedAt(),
                reconciledStatus,
                true,
                snapshot.settled() || reconciledStatus.isSettled(),
                txHash,
                snapshot.buyerAwardWei(),
                snapshot.sellerAwardWei(),
                current.title(),
                current.description(),
                current.terms(),
                current.canonicalTermsJson(),
                current.schemaVersion(),
                current.createdAt(),
                now
            );

            Deal persisted = dealRepository.save(updated);
            for (VerifiedChainEvent ev : receipt.decodedEvents()) {
                if (!tradeId.equalsIgnoreCase(ev.tradeId())) continue;
                chainEventRepository.recordIfAbsent(ev);
                Instant evTime = Instant.ofEpochSecond(ev.blockTimestampEpoch());
                Instant timelineTime = evTime.isBefore(current.createdAt()) ? current.createdAt() : evTime;
                dealEventRepository.saveIfAbsent(new DealEvent(
                    null,
                    tradeId,
                    ev.eventType().name(),
                    ev.actorAddress(),
                    ev.txHash(),
                    ev.blockNumber(),
                    ev.logIndex(),
                    "Verified on-chain event " + ev.eventType().name() + " at block " + ev.blockNumber(),
                    timelineTime
                ));
            }

            txRepository.saveOrUpdate(new BlockchainTransaction(
                null,
                tradeId,
                txHash,
                "CREATE_TRADE",
                "CONFIRMED",
                receipt.blockNumber(),
                caller,
                now,
                now
            ));

            auditLogRepository.append(new AuditLogEntry(
                null,
                "DEAL_BOUND_ON_CHAIN",
                caller,
                "DEAL",
                tradeId,
                CorrelationIdContext.getOrDefault("n/a"),
                "Bound tradeId=" + tradeId + " createTxHash=" + txHash + " status=" + persisted.status(),
                now
            ));

            return persisted;
        });
    }
}
