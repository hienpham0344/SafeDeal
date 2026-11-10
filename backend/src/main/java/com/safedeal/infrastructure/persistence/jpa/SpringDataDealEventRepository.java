package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaDealEventEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataDealEventRepository extends JpaRepository<JpaDealEventEntity, Long> {
    boolean existsByTxHashIgnoreCaseAndLogIndex(String txHash, Integer logIndex);

    List<JpaDealEventEntity> findByTradeIdIgnoreCaseOrderByCreatedAtAscIdAsc(String tradeId);
}
