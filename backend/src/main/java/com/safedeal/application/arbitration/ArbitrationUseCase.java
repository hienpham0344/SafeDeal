package com.safedeal.application.arbitration;

import com.safedeal.application.dispute.DisputeUseCase.DisputeWithDeal;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.BlockchainTransaction;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.AuditLogEntry;
import com.safedeal.domain.dispute.Dispute;
import com.safedeal.domain.dispute.DisputeStatus;
import com.safedeal.domain.port.AuditLogRepository;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.BlockchainTransactionRepository;
import com.safedeal.domain.port.ChainEventRepository;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.domain.port.DisputeRepository;
import com.safedeal.shared.exception.ConflictException;
import com.safedeal.shared.exception.ExternalServiceException;
import com.safedeal.shared.exception.ForbiddenException;
import com.safedeal.shared.exception.NotFoundException;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.CorrelationIdContext;
import com.safedeal.shared.validation.EthFormatValidator;
import java.math.BigInteger;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

@Service
public class ArbitrationUseCase {

    private final DisputeRepository disputeRepository;
    private final DealRepository dealRepository;
    private final ChainEventRepository chainEventRepository;
    private final DealEventRepository dealEventRepository;
    private final BlockchainTransactionRepository txRepository;
    private final AuditLogRepository auditLogRepository;
    private final BlockchainGateway blockchainGateway;
    private final TransactionOperations txTemplate;
    private final Clock clock;

    public ArbitrationUseCase(
        DisputeRepository disputeRepository,
        DealRepository dealRepository,
        ChainEventRepository chainEventRepository,
        DealEventRepository dealEventRepository,
        BlockchainTransactionRepository txRepository,
        AuditLogRepository auditLogRepository,
        BlockchainGateway blockchainGateway,
        TransactionOperations txTemplate,
        Clock clock
    ) {
        this.disputeRepository = disputeRepository;
        this.dealRepository = dealRepository;
        this.chainEventRepository = chainEventRepository;
        this.dealEventRepository = dealEventRepository;
        this.txRepository = txRepository;
        this.auditLogRepository = auditLogRepository;
        this.blockchainGateway = blockchainGateway;
        this.txTemplate = txTemplate;
        this.clock = clock;
    }

    public List<DisputeWithDeal> listAssignedDisputes(String arbiterAddress) {
        String arbiter = EthFormatValidator.requireAddress(arbiterAddress, "arbiterAddress");
        return txTemplate.execute(status -> disputeRepository.findAssignedToArbiter(arbiter).stream()
            .map(dispute -> {
                Deal deal = dealRepository.findByTradeId(dispute.tradeId())
                    .orElseThrow(() -> new NotFoundException("Deal not found for dispute " + dispute.id()));
                return new DisputeWithDeal(dispute, deal);
            })
            .toList());
    }

    public DisputeWithDeal recordResolution(
        Long disputeId,
        String arbiterAddress,
        String rawTxHash,
        String rationale
    ) {
        String caller = EthFormatValidator.requireAddress(arbiterAddress, "arbiterAddress");
        String txHash = EthFormatValidator.requireBytes32(rawTxHash, "txHash");
        String trimmedRationale = rationale == null ? "" : rationale.trim();
        if (trimmedRationale.length() < 10 || trimmedRationale.length() > 4000) {
            throw new ValidationException("Arbitration rationale must be between 10 and 4000 characters.");
        }

        DisputeWithDeal ctx = txTemplate.execute(status -> {
            Dispute dispute = disputeRepository.findById(disputeId)
                .orElseThrow(() -> new NotFoundException("Dispute not found: " + disputeId));
            Deal deal = dealRepository.findByTradeId(dispute.tradeId())
                .orElseThrow(() -> new NotFoundException("Deal not found: " + dispute.tradeId()));
            if (!deal.arbiter().equalsIgnoreCase(caller)) {
                throw new ForbiddenException("Only the deal's designated arbiter may record settlement.");
            }
            if (dispute.status() == DisputeStatus.RESOLVED) {
                if (txHash.equalsIgnoreCase(dispute.resolveTxHash())) {
                    if (dispute.resolutionRationale() == null || dispute.resolutionRationale().isBlank()) {
                        Dispute withRationale = disputeRepository.save(new Dispute(
                            dispute.id(),
                            dispute.tradeId(),
                            dispute.openedBy(),
                            dispute.reason(),
                            dispute.summary(),
                            dispute.status(),
                            dispute.buyerAwardWei(),
                            dispute.sellerAwardWei(),
                            trimmedRationale,
                            dispute.openTxHash(),
                            dispute.resolveTxHash(),
                            dispute.createdAt(),
                            dispute.resolvedAt()
                        ));
                        return new DisputeWithDeal(withRationale, deal);
                    }
                    return new DisputeWithDeal(dispute, deal);
                }
                throw new ConflictException("Dispute has already been resolved.");
            }
            return new DisputeWithDeal(dispute, deal);
        });

        if (ctx.dispute().status() == DisputeStatus.RESOLVED) {
            return ctx;
        }

        if (!blockchainGateway.isEnabled()) {
            throw new ExternalServiceException("Blockchain verification is disabled; cannot verify dispute settlement.");
        }

        // Verify settlement receipt and decoded DisputeResolved event OUTSIDE DB transaction
        TransactionVerificationResult receipt = blockchainGateway.inspectTransaction(txHash)
            .orElseThrow(() -> new ValidationException("Resolution transaction receipt not found or pending: " + txHash));
        if (!receipt.succeeded()) {
            throw new ValidationException("Resolution transaction reverted on-chain: " + txHash);
        }
        String configuredContract = blockchainGateway.contractAddress().toLowerCase();
        if (receipt.toAddress() == null || !receipt.toAddress().equalsIgnoreCase(configuredContract)) {
            throw new ValidationException("Resolution transaction did not target SafeDealEscrow.");
        }

        VerifiedChainEvent resolvedEvent = receipt.decodedEvents().stream()
            .filter(ev -> ev.eventType() == OnChainEventType.DISPUTE_RESOLVED
                && ctx.deal().tradeId().equalsIgnoreCase(ev.tradeId()))
            .findFirst()
            .orElseThrow(() -> new ValidationException("Transaction receipt does not emit DisputeResolved for this trade."));

        BigInteger buyerAward = new BigInteger(resolvedEvent.buyerAwardWei());
        BigInteger sellerAward = new BigInteger(resolvedEvent.sellerAwardWei());
        BigInteger expectedTotal = new BigInteger(ctx.deal().amountWei());
        if (buyerAward.add(sellerAward).compareTo(expectedTotal) != 0) {
            throw new ValidationException("On-chain split settlement does not sum to locked escrow amount.");
        }

        OnChainTradeSnapshot snapshot = blockchainGateway.fetchTrade(ctx.deal().tradeId())
            .orElseThrow(() -> new ExternalServiceException("Unable to fetch on-chain trade after resolution."));
        if (snapshot.toDealStatus() != DealStatus.RESOLVED) {
            throw new ValidationException("On-chain trade status is not RESOLVED.");
        }

        Instant now = Instant.now(clock);
        return txTemplate.execute(status -> {
            Deal currentDeal = dealRepository.findByTradeIdForUpdate(ctx.deal().tradeId())
                .orElseThrow(() -> new NotFoundException("Deal not found: " + ctx.deal().tradeId()));
            Dispute currentDispute = disputeRepository.findById(disputeId)
                .orElseThrow(() -> new NotFoundException("Dispute not found: " + disputeId));

            if (currentDispute.status() == DisputeStatus.RESOLVED) {
                if (!txHash.equalsIgnoreCase(currentDispute.resolveTxHash())) {
                    throw new ConflictException("Dispute has already been resolved.");
                }
                if (currentDispute.resolutionRationale() == null || currentDispute.resolutionRationale().isBlank()) {
                    Dispute withRationale = disputeRepository.save(new Dispute(
                        currentDispute.id(),
                        currentDispute.tradeId(),
                        currentDispute.openedBy(),
                        currentDispute.reason(),
                        currentDispute.summary(),
                        currentDispute.status(),
                        currentDispute.buyerAwardWei(),
                        currentDispute.sellerAwardWei(),
                        trimmedRationale,
                        currentDispute.openTxHash(),
                        currentDispute.resolveTxHash(),
                        currentDispute.createdAt(),
                        currentDispute.resolvedAt()
                    ));
                    return new DisputeWithDeal(withRationale, currentDeal);
                }
                return new DisputeWithDeal(currentDispute, currentDeal);
            }

            Dispute updatedDispute = disputeRepository.save(new Dispute(
                currentDispute.id(),
                currentDispute.tradeId(),
                currentDispute.openedBy(),
                currentDispute.reason(),
                currentDispute.summary(),
                DisputeStatus.RESOLVED,
                resolvedEvent.buyerAwardWei(),
                resolvedEvent.sellerAwardWei(),
                trimmedRationale,
                currentDispute.openTxHash(),
                txHash,
                currentDispute.createdAt(),
                now
            ));

            Deal updatedDeal = dealRepository.save(new Deal(
                currentDeal.id(),
                currentDeal.tradeId(),
                currentDeal.chainId(),
                currentDeal.contractAddress(),
                currentDeal.seller(),
                currentDeal.buyer(),
                currentDeal.arbiter(),
                currentDeal.amountWei(),
                currentDeal.termsHash(),
                currentDeal.fundingDeadline(),
                currentDeal.deliveryDeadline(),
                currentDeal.inspectionWindowSeconds(),
                currentDeal.deliveredAt(),
                currentDeal.fundedAt(),
                DealStatus.RESOLVED,
                true,
                true,
                currentDeal.createTxHash(),
                resolvedEvent.buyerAwardWei(),
                resolvedEvent.sellerAwardWei(),
                currentDeal.title(),
                currentDeal.description(),
                currentDeal.terms(),
                currentDeal.canonicalTermsJson(),
                currentDeal.schemaVersion(),
                currentDeal.createdAt(),
                now
            ));

            chainEventRepository.recordIfAbsent(resolvedEvent);
            Instant resolvedTime = Instant.ofEpochSecond(resolvedEvent.blockTimestampEpoch());
            Instant timelineTime = resolvedTime.isBefore(currentDeal.createdAt())
                ? currentDeal.createdAt()
                : resolvedTime;
            dealEventRepository.saveIfAbsent(new DealEvent(
                null,
                currentDeal.tradeId(),
                OnChainEventType.DISPUTE_RESOLVED.name(),
                caller,
                txHash,
                receipt.blockNumber(),
                resolvedEvent.logIndex(),
                "Arbiter split resolution recorded: buyer=" + buyerAward + " seller=" + sellerAward,
                timelineTime
            ));

            txRepository.saveOrUpdate(new BlockchainTransaction(
                null,
                currentDeal.tradeId(),
                txHash,
                "RESOLVE_DISPUTE",
                "CONFIRMED",
                receipt.blockNumber(),
                caller,
                now,
                now
            ));

            auditLogRepository.append(new AuditLogEntry(
                null,
                "DISPUTE_RESOLVED",
                caller,
                "DISPUTE",
                String.valueOf(disputeId),
                CorrelationIdContext.getOrDefault("n/a"),
                "Verified DisputeResolved txHash=" + txHash + " buyerWei=" + buyerAward + " sellerWei=" + sellerAward,
                now
            ));

            return new DisputeWithDeal(updatedDispute, updatedDeal);
        });
    }
}
