package com.safedeal.application.dispute;

import com.safedeal.application.deal.SyncDealUseCase;
import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.AuditLogEntry;
import com.safedeal.domain.dispute.Dispute;
import com.safedeal.domain.dispute.DisputeEvidence;
import com.safedeal.domain.dispute.DisputeStatus;
import com.safedeal.domain.port.AuditLogRepository;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.domain.port.DisputeEvidenceRepository;
import com.safedeal.domain.port.DisputeRepository;
import com.safedeal.domain.port.EvidenceStoragePort;
import com.safedeal.shared.exception.ConflictException;
import com.safedeal.shared.exception.ForbiddenException;
import com.safedeal.shared.exception.NotFoundException;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.CorrelationIdContext;
import com.safedeal.shared.validation.EthFormatValidator;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

@Service
public class DisputeUseCase {

    public record DisputeWithDeal(Dispute dispute, Deal deal) {
    }

    public record EvidenceDownload(DisputeEvidence metadata, byte[] bytes) {
    }

    private final DealRepository dealRepository;
    private final DisputeRepository disputeRepository;
    private final DisputeEvidenceRepository evidenceRepository;
    private final AuditLogRepository auditLogRepository;
    private final BlockchainGateway blockchainGateway;
    private final SyncDealUseCase syncDealUseCase;
    private final EvidenceStoragePort evidenceStorage;
    private final TransactionOperations txTemplate;
    private final Clock clock;

    public DisputeUseCase(
        DealRepository dealRepository,
        DisputeRepository disputeRepository,
        DisputeEvidenceRepository evidenceRepository,
        AuditLogRepository auditLogRepository,
        BlockchainGateway blockchainGateway,
        SyncDealUseCase syncDealUseCase,
        EvidenceStoragePort evidenceStorage,
        TransactionOperations txTemplate,
        Clock clock
    ) {
        this.dealRepository = dealRepository;
        this.disputeRepository = disputeRepository;
        this.evidenceRepository = evidenceRepository;
        this.auditLogRepository = auditLogRepository;
        this.blockchainGateway = blockchainGateway;
        this.syncDealUseCase = syncDealUseCase;
        this.evidenceStorage = evidenceStorage;
        this.txTemplate = txTemplate;
        this.clock = clock;
    }

    public DisputeWithDeal openDispute(
        String rawTradeId,
        String callerAddress,
        String reason,
        String summary,
        String optionalTxHash
    ) {
        String tradeId = EthFormatValidator.requireBytes32(rawTradeId, "tradeId");
        String caller = EthFormatValidator.requireAddress(callerAddress, "callerAddress");
        String trimmedReason = requireBounded(reason, "reason", 5, 200);
        String trimmedSummary = requireBounded(summary, "summary", 10, 4000);
        String txHash = (optionalTxHash == null || optionalTxHash.isBlank())
            ? null
            : EthFormatValidator.requireBytes32(optionalTxHash, "txHash");

        Deal deal = txTemplate.execute(status -> {
            Deal found = dealRepository.findByTradeId(tradeId)
                .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
            if (!caller.equalsIgnoreCase(found.seller())
                && (found.buyer() == null || !caller.equalsIgnoreCase(found.buyer()))) {
                throw new ForbiddenException("Only the deal buyer or seller can file dispute details.");
            }
            if (disputeRepository.findByTradeId(tradeId).isPresent()) {
                throw new ConflictException("A dispute case already exists for trade " + tradeId);
            }
            return found;
        });

        // Verify on-chain DISPUTED status (and DisputeOpened tx receipt if provided) OUTSIDE DB transaction
        if (blockchainGateway.isEnabled()) {
            if (txHash != null) {
                var receipt = blockchainGateway.inspectTransaction(txHash)
                    .orElseThrow(() -> new ValidationException("Dispute transaction receipt not found or pending: " + txHash));
                boolean hasDisputeOpened = receipt.succeeded()
                    && receipt.toAddress() != null
                    && receipt.toAddress().equalsIgnoreCase(blockchainGateway.contractAddress())
                    && receipt.decodedEvents().stream()
                        .anyMatch(ev -> ev.eventType() == OnChainEventType.DISPUTE_OPENED
                            && tradeId.equalsIgnoreCase(ev.tradeId()));
                if (!hasDisputeOpened) {
                    throw new ValidationException("Submitted transaction did not emit DisputeOpened for tradeId " + tradeId);
                }
            }
            deal = syncDealUseCase.execute(tradeId, txHash, caller);
        }

        Deal authoritativeDeal = deal;
        if (authoritativeDeal.status() != DealStatus.DISPUTED) {
            throw new ValidationException(
                "On-chain trade status must be DISPUTED before recording dispute metadata (current: "
                    + authoritativeDeal.status()
                    + ")."
            );
        }

        Instant now = Instant.now(clock);
        return txTemplate.execute(status -> {
            dealRepository.findByTradeIdForUpdate(tradeId)
                .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
            if (disputeRepository.findByTradeId(tradeId).isPresent()) {
                throw new ConflictException("A dispute case already exists for trade " + tradeId);
            }
            Dispute created = disputeRepository.save(new Dispute(
                null,
                tradeId,
                caller,
                trimmedReason,
                trimmedSummary,
                DisputeStatus.OPEN,
                null,
                null,
                null,
                txHash,
                null,
                now,
                null
            ));
            auditLogRepository.append(new AuditLogEntry(
                null,
                "DISPUTE_OPENED",
                caller,
                "DISPUTE",
                String.valueOf(created.id()),
                CorrelationIdContext.getOrDefault("n/a"),
                "Opened dispute metadata for tradeId=" + tradeId,
                now
            ));
            return new DisputeWithDeal(created, authoritativeDeal);
        });
    }

    public DisputeWithDeal getDispute(Long disputeId, String callerAddress) {
        String caller = EthFormatValidator.requireAddress(callerAddress, "callerAddress");
        return txTemplate.execute(status -> {
            Dispute dispute = disputeRepository.findById(disputeId)
                .orElseThrow(() -> new NotFoundException("Dispute not found: " + disputeId));
            Deal deal = dealRepository.findByTradeId(dispute.tradeId())
                .orElseThrow(() -> new NotFoundException("Parent deal not found for dispute " + disputeId));
            if (!deal.isParticipantOrArbiter(caller)) {
                throw new ForbiddenException("Only deal parties or the assigned arbiter may view this dispute.");
            }
            return new DisputeWithDeal(dispute, deal);
        });
    }

    public List<DisputeEvidence> listEvidence(Long disputeId, String callerAddress) {
        getDispute(disputeId, callerAddress);
        return evidenceRepository.findByDisputeIdOrderByCreatedAtAsc(disputeId);
    }

    public DisputeEvidence uploadEvidence(
        Long disputeId,
        String callerAddress,
        String title,
        String notes,
        String originalFilename,
        String declaredMimeType,
        byte[] fileBytes
    ) {
        String caller = EthFormatValidator.requireAddress(callerAddress, "callerAddress");
        String trimmedTitle = requireBounded(title, "title", 3, 160);
        String trimmedNotes = requireBounded(notes, "notes", 5, 4000);

        DisputeWithDeal ctx = getDispute(disputeId, caller);
        if (ctx.dispute().status() != DisputeStatus.OPEN) {
            throw new ConflictException("Evidence can only be added while the dispute is OPEN.");
        }
        boolean isParty = caller.equalsIgnoreCase(ctx.deal().seller())
            || (ctx.deal().buyer() != null && caller.equalsIgnoreCase(ctx.deal().buyer()));
        if (!isParty) {
            throw new ForbiddenException("Only buyer or seller may submit dispute evidence.");
        }

        EvidenceStoragePort.StoredAttachment attachment = null;
        if (fileBytes != null && fileBytes.length > 0) {
            attachment = evidenceStorage.store(disputeId, originalFilename, declaredMimeType, fileBytes);
        }

        EvidenceStoragePort.StoredAttachment finalAttachment = attachment;
        Instant now = Instant.now(clock);
        return txTemplate.execute(status -> {
            DisputeEvidence saved = evidenceRepository.save(new DisputeEvidence(
                null,
                disputeId,
                caller,
                trimmedTitle,
                trimmedNotes,
                finalAttachment != null ? finalAttachment.sanitizedFileName() : null,
                finalAttachment != null ? finalAttachment.mimeType() : null,
                finalAttachment != null ? finalAttachment.sizeBytes() : null,
                finalAttachment != null ? finalAttachment.sha256Hex() : null,
                finalAttachment != null ? finalAttachment.storageKey() : null,
                now
            ));
            auditLogRepository.append(new AuditLogEntry(
                null,
                "DISPUTE_EVIDENCE_UPLOADED",
                caller,
                "DISPUTE_EVIDENCE",
                String.valueOf(saved.id()),
                CorrelationIdContext.getOrDefault("n/a"),
                "Uploaded evidence item for disputeId=" + disputeId + " hasAttachment=" + saved.hasAttachment(),
                now
            ));
            return saved;
        });
    }

    public EvidenceDownload downloadEvidence(Long disputeId, Long evidenceId, String callerAddress) {
        String caller = EthFormatValidator.requireAddress(callerAddress, "callerAddress");
        getDispute(disputeId, caller);

        DisputeEvidence evidence = evidenceRepository.findByIdAndDisputeId(evidenceId, disputeId)
            .orElseThrow(() -> new NotFoundException("Evidence item not found."));
        if (!evidence.hasAttachment()) {
            throw new NotFoundException("Evidence item does not include a downloadable file.");
        }

        byte[] content = evidenceStorage.load(evidence.storageKey());
        auditLogRepository.append(new AuditLogEntry(
            null,
            "DISPUTE_EVIDENCE_DOWNLOADED",
            caller,
            "DISPUTE_EVIDENCE",
            String.valueOf(evidenceId),
            CorrelationIdContext.getOrDefault("n/a"),
            "Downloaded attachment for disputeId=" + disputeId,
            Instant.now(clock)
        ));
        return new EvidenceDownload(evidence, content);
    }

    private String requireBounded(String raw, String field, int min, int max) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.length() < min || trimmed.length() > max) {
            throw new ValidationException(field + " length must be between " + min + " and " + max + " characters.");
        }
        return trimmed;
    }
}
