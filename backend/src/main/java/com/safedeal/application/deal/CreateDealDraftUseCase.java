package com.safedeal.application.deal;

import com.safedeal.domain.deal.CanonicalTermsHasher;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.AuditLogEntry;
import com.safedeal.domain.port.AuditLogRepository;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.CorrelationIdContext;
import com.safedeal.shared.validation.EthFormatValidator;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CreateDealDraftUseCase {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final HexFormat HEX_FORMAT = HexFormat.of();
    private static final long MIN_INSPECTION_SECONDS = 3600L;
    private static final long MAX_INSPECTION_SECONDS = 30L * 86400L;

    public record Command(
        String sellerAddress,
        String buyerAddress,
        String arbiterAddress,
        String amountWei,
        long fundingDeadlineEpochSeconds,
        long deliveryDeadlineEpochSeconds,
        long inspectionWindowSeconds,
        String title,
        String description,
        String terms
    ) {
    }

    private final DealRepository dealRepository;
    private final DealEventRepository dealEventRepository;
    private final AuditLogRepository auditLogRepository;
    private final BlockchainGateway blockchainGateway;
    private final Clock clock;

    public CreateDealDraftUseCase(
        DealRepository dealRepository,
        DealEventRepository dealEventRepository,
        AuditLogRepository auditLogRepository,
        BlockchainGateway blockchainGateway,
        Clock clock
    ) {
        this.dealRepository = dealRepository;
        this.dealEventRepository = dealEventRepository;
        this.auditLogRepository = auditLogRepository;
        this.blockchainGateway = blockchainGateway;
        this.clock = clock;
    }

    @Transactional
    public Deal execute(Command cmd) {
        String seller = EthFormatValidator.requireAddress(cmd.sellerAddress(), "sellerAddress");
        String buyer = EthFormatValidator.normalizeOptionalAddress(cmd.buyerAddress(), "buyerAddress");
        String arbiter = EthFormatValidator.requireAddress(cmd.arbiterAddress(), "arbiterAddress");
        BigInteger amount = EthFormatValidator.requirePositiveWei(cmd.amountWei(), "amountWei");

        if (seller.equals(arbiter)) {
            throw new ValidationException("Arbiter cannot be the same wallet as the seller.");
        }
        if (buyer != null && buyer.equals(seller)) {
            throw new ValidationException("Buyer cannot be the same wallet as the seller.");
        }
        if (buyer != null && buyer.equals(arbiter)) {
            throw new ValidationException("Buyer cannot be the same wallet as the arbiter.");
        }

        Instant now = Instant.now(clock);
        Instant fundingDeadline = Instant.ofEpochSecond(cmd.fundingDeadlineEpochSeconds);
        Instant deliveryDeadline = Instant.ofEpochSecond(cmd.deliveryDeadlineEpochSeconds);

        if (!fundingDeadline.isAfter(now)) {
            throw new ValidationException("Funding deadline must be strictly in the future.");
        }
        if (!deliveryDeadline.isAfter(fundingDeadline)) {
            throw new ValidationException("Delivery deadline must be strictly after funding deadline.");
        }
        if (cmd.inspectionWindowSeconds < MIN_INSPECTION_SECONDS
            || cmd.inspectionWindowSeconds > MAX_INSPECTION_SECONDS) {
            throw new ValidationException("Inspection window must be between 1 hour and 30 days.");
        }

        String title = requireTrimmed(cmd.title(), "title", 3, 160);
        String description = requireTrimmed(cmd.description(), "description", 10, 4000);
        String terms = requireTrimmed(cmd.terms(), "terms", 10, 8000);

        byte[] idBytes = new byte[32];
        SECURE_RANDOM.nextBytes(idBytes);
        String tradeId = "0x" + HEX_FORMAT.formatHex(idBytes);

        CanonicalTermsHasher.CanonicalResult canonical = CanonicalTermsHasher.compute(
            new CanonicalTermsHasher.CanonicalInput(
                1,
                blockchainGateway.chainId(),
                seller,
                buyer,
                arbiter,
                amount.toString(),
                fundingDeadline.getEpochSecond(),
                deliveryDeadline.getEpochSecond(),
                cmd.inspectionWindowSeconds(),
                title,
                description,
                terms
            )
        );

        String contractAddress = blockchainGateway.contractAddress().isBlank()
            ? EthFormatValidator.ZERO_ADDRESS
            : blockchainGateway.contractAddress().toLowerCase();

        Deal saved = dealRepository.save(new Deal(
            null,
            tradeId,
            blockchainGateway.chainId(),
            contractAddress,
            seller,
            buyer,
            arbiter,
            amount.toString(),
            canonical.termsHashHex(),
            fundingDeadline,
            deliveryDeadline,
            cmd.inspectionWindowSeconds(),
            null,
            null,
            DealStatus.DRAFT,
            false,
            false,
            null,
            null,
            null,
            title,
            description,
            terms,
            canonical.canonicalJson(),
            1,
            now,
            now
        ));

        dealEventRepository.saveIfAbsent(new DealEvent(
            null,
            saved.tradeId(),
            "DRAFT_CREATED",
            seller,
            null,
            null,
            null,
            "Deal draft prepared with RFC 8785 canonical termsHash " + saved.termsHash(),
            now
        ));

        auditLogRepository.append(new AuditLogEntry(
            null,
            "DEAL_DRAFT_CREATED",
            seller,
            "DEAL",
            saved.tradeId(),
            CorrelationIdContext.getOrDefault("n/a"),
            "Prepared draft tradeId=" + saved.tradeId() + " amountWei=" + saved.amountWei(),
            now
        ));

        return saved;
    }

    private String requireTrimmed(String raw, String field, int min, int max) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.length() < min || trimmed.length() > max) {
            throw new ValidationException(field + " length must be between " + min + " and " + max + " characters.");
        }
        return trimmed;
    }
}
