package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaChainEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataChainEventRepository extends JpaRepository<JpaChainEventEntity, Long> {
    boolean existsByTxHashIgnoreCaseAndLogIndex(String txHash, int logIndex);
}
