package com.safedeal.application.deal;

import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.deal.BlockchainTransaction;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.BlockchainTransactionRepository;
import com.safedeal.domain.port.ChainEventRepository;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.shared.exception.ExternalServiceException;
import com.safedeal.shared.exception.ForbiddenException;
import com.safedeal.shared.exception.NotFoundException;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.EthFormatValidator;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

@Service
public class SyncDealUseCase {

    private final DealRepository dealRepository;
    private final DealEventRepository dealEventRepository;
    private final ChainEventRepository chainEventRepository;
    private final BlockchainTransactionRepository txRepository;
    private final BlockchainGateway blockchainGateway;
    private final TransactionOperations txTemplate;
    private final Clock clock;

    public SyncDealUseCase(
        DealRepository dealRepository,
        DealEventRepository dealEventRepository,
        ChainEventRepository chainEventRepository,
        BlockchainTransactionRepository txRepository,
        BlockchainGateway blockchainGateway,
        TransactionOperations txTemplate,
        Clock clock
    ) {
        this.dealRepository = dealRepository;
        this.dealEventRepository = dealEventRepository;
        this.chainEventRepository = chainEventRepository;
        this.txRepository = txRepository;
        this.blockchainGateway = blockchainGateway;
        this.txTemplate = txTemplate;
        this.clock = clock;
    }

    public Deal execute(String rawTradeId, String rawOptionalTxHash, String callerAddress) {
        String tradeId = EthFormatValidator.requireBytes32(rawTradeId, "tradeId");
        String caller = EthFormatValidator.requireAddress(callerAddress, "callerAddress");
        String txHash = (rawOptionalTxHash == null || rawOptionalTxHash.isBlank())
            ? null
            : EthFormatValidator.requireBytes32(rawOptionalTxHash, "txHash");

        Deal deal = txTemplate.execute(status -> {
            Deal found = dealRepository.findByTradeId(tradeId)
                .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
            if (!found.canView(caller)) {
                throw new ForbiddenException("Caller is not authorized to synchronize this deal.");
            }
            return found;
        });

        if (!blockchainGateway.isEnabled()) {
            throw new ExternalServiceException("Blockchain synchronization is disabled on this server.");
        }

        TransactionVerificationResult receipt = null;
        if (txHash != null) {
            receipt = blockchainGateway.inspectTransaction(txHash)
                .orElseThrow(() -> new ValidationException("Transaction receipt not found or still pending: " + txHash));
            if (!receipt.succeeded()) {
                throw new ValidationException("Submitted transaction reverted on-chain: " + txHash);
            }
            String configuredContract = blockchainGateway.contractAddress();
            if (receipt.toAddress() == null || !receipt.toAddress().equalsIgnoreCase(configuredContract)) {
                throw new ValidationException("Submitted transaction did not target configured SafeDealEscrow contract.");
            }
            boolean matchesTrade = receipt.decodedEvents().stream()
                .anyMatch(ev -> tradeId.equalsIgnoreCase(ev.tradeId()));
            if (!matchesTrade) {
                throw new ValidationException("Submitted transaction did not emit any verified event for tradeId: " + tradeId);
            }
        }

        OnChainTradeSnapshot snapshot = blockchainGateway.fetchTrade(tradeId)
            .orElseThrow(() -> new ValidationException("Trade does not exist on-chain yet: " + tradeId));

        if (!deal.termsHash().equalsIgnoreCase(snapshot.termsHash())
            || !deal.seller().equalsIgnoreCase(snapshot.seller())
            || !deal.arbiter().equalsIgnoreCase(snapshot.arbiter())
            || !deal.amountWei().equals(snapshot.amountWei())) {
            throw new ValidationException("On-chain contract state disagrees with stored canonical terms.");
        }

        TransactionVerificationResult finalReceipt = receipt;
        Instant now = Instant.now(clock);

        return txTemplate.execute(status -> {
            Deal current = dealRepository.findByTradeIdForUpdate(tradeId)
                .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));

            DealStatus nextStatus = snapshot.toDealStatus();
            if (!current.status().canReconcileTo(nextStatus)) {
                if (nextStatus.canReconcileTo(current.status())) {
                    nextStatus = current.status();
                } else {
                    throw new ValidationException(
                        "Invalid escrow state transition from " + current.status() + " to " + nextStatus
                    );
                }
            }

            String resolvedBuyer = snapshot.buyer() != null && !EthFormatValidator.ZERO_ADDRESS.equalsIgnoreCase(snapshot.buyer())
                ? snapshot.buyer().toLowerCase()
                : current.buyer();
            Instant deliveredAt = snapshot.deliveredAtEpoch() > 0
                ? Instant.ofEpochSecond(snapshot.deliveredAtEpoch())
                : current.deliveredAt();

            String buyerAward = current.buyerAwardWei();
            String sellerAward = current.sellerAwardWei();
            String resolvedCreateTxHash = current.createTxHash();
            Instant resolvedFundedAt = current.fundedAt();
            if (finalReceipt != null) {
                for (VerifiedChainEvent ev : finalReceipt.decodedEvents()) {
                    if (!tradeId.equalsIgnoreCase(ev.tradeId())) {
                        continue;
                    }
                    if (ev.eventType() == com.safedeal.domain.blockchain.OnChainEventType.TRADE_CREATED
                        && resolvedCreateTxHash == null) {
                        resolvedCreateTxHash = ev.txHash();
                    }
                    if (ev.eventType() == com.safedeal.domain.blockchain.OnChainEventType.TRADE_FUNDED
                        && resolvedFundedAt == null
                        && ev.blockTimestampEpoch() > 0) {
                        resolvedFundedAt = Instant.ofEpochSecond(ev.blockTimestampEpoch());
                    }
                    if (ev.eventType() == com.safedeal.domain.blockchain.OnChainEventType.DISPUTE_RESOLVED) {
                        buyerAward = ev.buyerAwardWei();
                        sellerAward = ev.sellerAwardWei();
                    }
                }
            }
            Instant fundedAt = (resolvedFundedAt == null
                && nextStatus != DealStatus.CREATED
                && nextStatus != DealStatus.CANCELLED
                && nextStatus != DealStatus.DRAFT)
                ? now
                : resolvedFundedAt;

            Deal updated = new Deal(
                current.id(),
                current.tradeId(),
                current.chainId(),
                blockchainGateway.contractAddress().toLowerCase(),
                current.seller(),
                resolvedBuyer,
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
                snapshot.settled() || nextStatus.isSettled(),
                resolvedCreateTxHash,
                buyerAward,
                sellerAward,
                current.title(),
                current.description(),
                current.terms(),
                current.canonicalTermsJson(),
                current.schemaVersion(),
                current.createdAt(),
                now
            );

            Deal saved = dealRepository.save(updated);

            if (finalReceipt != null) {
                String operationName = "SYNC";
                for (VerifiedChainEvent ev : finalReceipt.decodedEvents()) {
                    if (!tradeId.equalsIgnoreCase(ev.tradeId())) continue;
                    operationName = ev.eventType().name();
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
                        "Verified on-chain event " + ev.eventType().name(),
                        timelineTime
                    ));
                }
                txRepository.saveOrUpdate(new BlockchainTransaction(
                    null,
                    tradeId,
                    finalReceipt.txHash(),
                    operationName,
                    "CONFIRMED",
                    finalReceipt.blockNumber(),
                    caller,
                    now,
                    now
                ));
            }
            return saved;
        });
    }
}
