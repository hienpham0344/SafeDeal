package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaDisputeEvidenceEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataDisputeEvidenceRepository extends JpaRepository<JpaDisputeEvidenceEntity, Long> {
    List<JpaDisputeEvidenceEntity> findByDisputeIdOrderByCreatedAtAscIdAsc(Long disputeId);

    Optional<JpaDisputeEvidenceEntity> findByIdAndDisputeId(Long id, Long disputeId);
}
