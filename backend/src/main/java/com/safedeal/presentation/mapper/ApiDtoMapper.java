package com.safedeal.presentation.mapper;

import com.safedeal.application.dispute.DisputeUseCase.DisputeWithDeal;
import com.safedeal.domain.deal.BlockchainTransaction;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.dispute.Dispute;
import com.safedeal.domain.dispute.DisputeEvidence;
import com.safedeal.presentation.dto.DealDtos;
import com.safedeal.presentation.dto.DisputeDtos;

public final class ApiDtoMapper {

    private ApiDtoMapper() {
    }

    public static DealDtos.DealSummaryResponse toSummary(Deal deal, Long disputeId) {
        return new DealDtos.DealSummaryResponse(
            deal.tradeId(),
            deal.title(),
            deal.description(),
            deal.seller(),
            deal.buyer(),
            deal.arbiter(),
            deal.amountWei(),
            deal.termsHash(),
            deal.fundingDeadline(),
            deal.deliveryDeadline(),
            deal.inspectionWindowSeconds(),
            deal.status().name(),
            deal.onChainBound(),
            deal.settled(),
            deal.deliveredAt(),
            deal.fundedAt(),
            deal.createdAt(),
            disputeId
        );
    }

    public static DealDtos.DealDetailResponse toDetail(Deal deal, Long disputeId) {
        return new DealDtos.DealDetailResponse(
            deal.tradeId(),
            deal.title(),
            deal.description(),
            deal.seller(),
            deal.buyer(),
            deal.arbiter(),
            deal.amountWei(),
            deal.termsHash(),
            deal.fundingDeadline(),
            deal.deliveryDeadline(),
            deal.inspectionWindowSeconds(),
            deal.status().name(),
            deal.onChainBound(),
            deal.settled(),
            deal.deliveredAt(),
            deal.fundedAt(),
            deal.createdAt(),
            disputeId,
            deal.terms(),
            deal.canonicalTermsJson(),
            deal.chainId(),
            deal.contractAddress(),
            deal.createTxHash()
        );
    }

    public static DealDtos.DealEventResponse toEventResponse(DealEvent ev) {
        return new DealDtos.DealEventResponse(
            ev.id(),
            ev.eventType(),
            ev.actorAddress(),
            ev.txHash(),
            ev.blockNumber(),
            ev.details(),
            ev.createdAt()
        );
    }

    public static DealDtos.BlockchainTransactionResponse toTxResponse(BlockchainTransaction tx) {
        return new DealDtos.BlockchainTransactionResponse(
            tx.id(),
            tx.txHash(),
            tx.operation(),
            tx.status(),
            tx.blockNumber(),
            tx.submittedBy(),
            tx.createdAt(),
            tx.confirmedAt()
        );
    }

    public static DisputeDtos.DisputeDetailResponse toDisputeDetail(DisputeWithDeal ctx) {
        Dispute d = ctx.dispute();
        Deal deal = ctx.deal();
        return new DisputeDtos.DisputeDetailResponse(
            d.id(),
            d.tradeId(),
            deal.title(),
            deal.amountWei(),
            deal.seller(),
            deal.buyer(),
            deal.arbiter(),
            d.openedBy(),
            d.reason(),
            d.summary(),
            d.status().name(),
            d.buyerAwardWei(),
            d.sellerAwardWei(),
            d.resolutionRationale(),
            d.openTxHash(),
            d.resolveTxHash(),
            d.createdAt(),
            d.resolvedAt()
        );
    }

    public static DisputeDtos.DisputeEvidenceResponse toEvidenceResponse(DisputeEvidence ev) {
        return new DisputeDtos.DisputeEvidenceResponse(
            ev.id(),
            ev.disputeId(),
            ev.submittedBy(),
            ev.title(),
            ev.notes(),
            ev.fileName(),
            ev.mimeType(),
            ev.sizeBytes(),
            ev.sha256Hex(),
            ev.hasAttachment(),
            ev.createdAt()
        );
    }
}
