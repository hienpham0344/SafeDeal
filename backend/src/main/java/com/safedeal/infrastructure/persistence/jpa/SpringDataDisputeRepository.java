package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaDisputeEntity;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataDisputeRepository extends JpaRepository<JpaDisputeEntity, Long> {
    Optional<JpaDisputeEntity> findByTradeIdIgnoreCase(String tradeId);

    @Query("SELECT d FROM JpaDisputeEntity d WHERE LOWER(d.tradeId) IN :tradeIds")
    List<JpaDisputeEntity> findAllByTradeIdLowerIn(@Param("tradeIds") Collection<String> tradeIds);

    @Query("""
        SELECT disp
        FROM JpaDisputeEntity disp
        JOIN JpaDealEntity deal ON LOWER(disp.tradeId) = LOWER(deal.tradeId)
        WHERE LOWER(deal.arbiterAddress) = LOWER(:arbiter)
        ORDER BY disp.createdAt DESC, disp.id DESC
        """)
    List<JpaDisputeEntity> findAssignedToArbiter(@Param("arbiter") String arbiterAddress);
}
