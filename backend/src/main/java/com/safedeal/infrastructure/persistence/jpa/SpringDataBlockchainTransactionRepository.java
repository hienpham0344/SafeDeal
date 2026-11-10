package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaBlockchainTransactionEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataBlockchainTransactionRepository extends JpaRepository<JpaBlockchainTransactionEntity, Long> {
    Optional<JpaBlockchainTransactionEntity> findByTxHashIgnoreCase(String txHash);

    List<JpaBlockchainTransactionEntity> findByTradeIdIgnoreCaseOrderByCreatedAtAscIdAsc(String tradeId);
}
