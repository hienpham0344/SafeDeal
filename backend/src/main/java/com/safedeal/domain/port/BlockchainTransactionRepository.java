package com.safedeal.domain.port;

import com.safedeal.domain.deal.BlockchainTransaction;
import java.util.List;
import java.util.Optional;

public interface BlockchainTransactionRepository {
    BlockchainTransaction saveOrUpdate(BlockchainTransaction transaction);

    Optional<BlockchainTransaction> findByTxHash(String txHash);

    List<BlockchainTransaction> findByTradeIdOrderByCreatedAtAsc(String tradeId);
}
