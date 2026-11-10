package com.safedeal.presentation.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

public final class DealDtos {

    private DealDtos() {
    }

    public record CreateDraftRequest(
        @NotBlank @Size(min = 3, max = 160) String title,
        @NotBlank @Size(min = 10, max = 4000) String description,
        @NotBlank String amountWei,
        String buyerAddress,
        @NotBlank String arbiterAddress,
        @NotNull Long fundingDeadlineEpochSeconds,
        @NotNull Long deliveryDeadlineEpochSeconds,
        @NotNull @Min(3600) @Max(2592000) Long inspectionWindowSeconds,
        @NotBlank @Size(min = 10, max = 8000) String terms
    ) {
    }

    public record BindTxRequest(
        @NotBlank(message = "txHash is required") String txHash
    ) {
    }

    public record SyncRequest(
        String txHash
    ) {
    }

    public record DealSummaryResponse(
        String tradeId,
        String title,
        String description,
        String seller,
        String buyer,
        String arbiter,
        String amountWei,
        String termsHash,
        Instant fundingDeadline,
        Instant deliveryDeadline,
        long inspectionWindowSeconds,
        String status,
        boolean onChainBound,
        boolean settled,
        Instant deliveredAt,
        Instant fundedAt,
        Instant createdAt,
        Long disputeId
    ) {
    }

    public record DealDetailResponse(
        String tradeId,
        String title,
        String description,
        String seller,
        String buyer,
        String arbiter,
        String amountWei,
        String termsHash,
        Instant fundingDeadline,
        Instant deliveryDeadline,
        long inspectionWindowSeconds,
        String status,
        boolean onChainBound,
        boolean settled,
        Instant deliveredAt,
        Instant fundedAt,
        Instant createdAt,
        Long disputeId,
        String terms,
        String canonicalTermsJson,
        long chainId,
        String contractAddress,
        String createTxHash
    ) {
    }

    public record CreateDraftResponse(
        DealDetailResponse deal,
        String tradeId,
        String termsHash,
        String canonicalTermsJson,
        long chainId,
        String contractAddress
    ) {
    }

    public record DealEventResponse(
        Long id,
        String eventType,
        String actorAddress,
        String txHash,
        Long blockNumber,
        String details,
        Instant createdAt
    ) {
    }

    public record BlockchainTransactionResponse(
        Long id,
        String txHash,
        String operation,
        String status,
        Long blockNumber,
        String submittedBy,
        Instant createdAt,
        Instant confirmedAt
    ) {
    }

    public record DealHistoryResponse(
        List<DealEventResponse> events,
        List<BlockchainTransactionResponse> transactions
    ) {
    }

    public record PaginatedResponse<T>(
        List<T> items,
        int page,
        int size,
        long totalItems,
        int totalPages
    ) {
    }
}
