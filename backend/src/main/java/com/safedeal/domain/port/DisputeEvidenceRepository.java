package com.safedeal.domain.port;

import com.safedeal.domain.dispute.DisputeEvidence;
import java.util.List;
import java.util.Optional;

public interface DisputeEvidenceRepository {
    DisputeEvidence save(DisputeEvidence evidence);

    List<DisputeEvidence> findByDisputeIdOrderByCreatedAtAsc(Long disputeId);

    Optional<DisputeEvidence> findByIdAndDisputeId(Long evidenceId, Long disputeId);
}
