package com.safedeal.domain.port;

import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealStatus;
import java.util.List;
import java.util.Optional;

public interface DealRepository {

    record PageSlice(List<Deal> items, int page, int size, long totalItems, int totalPages) {
    }

    Deal save(Deal deal);

    Optional<Deal> findByTradeId(String tradeId);

    Optional<Deal> findByTradeIdForUpdate(String tradeId);

    boolean existsByCreateTxHash(String createTxHash);

    PageSlice findUserDeals(String walletAddress, String role, DealStatus statusFilter, int page, int size);

    List<Deal> findOpenBoundDeals();
}
