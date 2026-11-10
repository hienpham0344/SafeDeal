package com.safedeal.domain.deal;

import java.time.Instant;

public record Deal(
    Long id,
    String tradeId,
    long chainId,
    String contractAddress,
    String seller,
    String buyer,
    String arbiter,
    String amountWei,
    String termsHash,
    Instant fundingDeadline,
    Instant deliveryDeadline,
    long inspectionWindowSeconds,
    Instant deliveredAt,
    Instant fundedAt,
    DealStatus status,
    boolean onChainBound,
    boolean settled,
    String createTxHash,
    String buyerAwardWei,
    String sellerAwardWei,
    String title,
    String description,
    String terms,
    String canonicalTermsJson,
    int schemaVersion,
    Instant createdAt,
    Instant updatedAt
) {
    public boolean isParticipantOrArbiter(String walletAddress) {
        if (walletAddress == null) return false;
        String lower = walletAddress.toLowerCase();
        return lower.equals(seller) || lower.equals(arbiter) || (buyer != null && lower.equals(buyer));
    }

    public boolean isOpenBuyerEligible(String walletAddress) {
        if (walletAddress == null) return false;
        String lower = walletAddress.toLowerCase();
        return buyer == null && onChainBound && status == DealStatus.CREATED && !lower.equals(seller) && !lower.equals(arbiter);
    }

    public boolean canView(String walletAddress) {
        return isParticipantOrArbiter(walletAddress) || isOpenBuyerEligible(walletAddress);
    }
}
