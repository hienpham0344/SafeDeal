package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaChainSyncStateEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataChainSyncStateRepository extends JpaRepository<JpaChainSyncStateEntity, Integer> {
}
