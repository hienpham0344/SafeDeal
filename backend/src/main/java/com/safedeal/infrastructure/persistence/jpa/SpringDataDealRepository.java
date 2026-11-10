package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaDealEntity;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataDealRepository
    extends JpaRepository<JpaDealEntity, Long>, JpaSpecificationExecutor<JpaDealEntity> {
    Optional<JpaDealEntity> findByTradeIdIgnoreCase(String tradeId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from JpaDealEntity d where d.tradeId = :tradeId")
    Optional<JpaDealEntity> findByTradeIdForUpdate(@Param("tradeId") String tradeId);

    boolean existsByCreateTxHashIgnoreCase(String createTxHash);

    List<JpaDealEntity> findByOnChainBoundTrueAndSettledFalse();
}
