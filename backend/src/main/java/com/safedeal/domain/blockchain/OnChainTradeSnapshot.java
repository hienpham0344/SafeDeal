package com.safedeal.domain.blockchain;

import com.safedeal.domain.deal.DealStatus;

public record OnChainTradeSnapshot(
    String tradeId,
    String seller,
    String buyer,
    String arbiter,
    String amountWei,
    String termsHash,
    long fundingDeadlineEpoch,
    long deliveryDeadlineEpoch,
    long inspectionWindowSeconds,
    long deliveredAtEpoch,
    int chainStatusOrdinal,
    boolean settled,
    String buyerAwardWei,
    String sellerAwardWei
) {
    public DealStatus toDealStatus() {
        return DealStatus.fromChainOrdinal(chainStatusOrdinal);
    }
}
