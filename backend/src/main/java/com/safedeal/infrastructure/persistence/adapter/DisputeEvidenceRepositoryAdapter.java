package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.dispute.DisputeEvidence;
import com.safedeal.domain.port.DisputeEvidenceRepository;
import com.safedeal.infrastructure.persistence.entity.JpaDisputeEvidenceEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataDisputeEvidenceRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Repository;

@Repository
public class DisputeEvidenceRepositoryAdapter implements DisputeEvidenceRepository {

    private final SpringDataDisputeEvidenceRepository jpa;

    public DisputeEvidenceRepositoryAdapter(SpringDataDisputeEvidenceRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public DisputeEvidence save(DisputeEvidence ev) {
        JpaDisputeEvidenceEntity e = new JpaDisputeEvidenceEntity();
        e.setId(ev.id());
        e.setDisputeId(ev.disputeId());
        e.setSubmittedBy(ev.submittedBy().toLowerCase());
        e.setTitle(ev.title());
        e.setNotes(ev.notes());
        e.setFileName(ev.fileName());
        e.setMimeType(ev.mimeType());
        e.setSizeBytes(ev.sizeBytes());
        e.setSha256Hex(ev.sha256Hex());
        e.setStorageKey(ev.storageKey());
        e.setCreatedAt(ev.createdAt());
        return toDomain(jpa.save(e));
    }

    @Override
    public List<DisputeEvidence> findByDisputeIdOrderByCreatedAtAsc(Long disputeId) {
        return jpa.findByDisputeIdOrderByCreatedAtAscIdAsc(disputeId).stream()
            .map(this::toDomain)
            .toList();
    }

    @Override
    public Optional<DisputeEvidence> findByIdAndDisputeId(Long evidenceId, Long disputeId) {
        return jpa.findByIdAndDisputeId(evidenceId, disputeId).map(this::toDomain);
    }

    private DisputeEvidence toDomain(JpaDisputeEvidenceEntity e) {
        return new DisputeEvidence(
            e.getId(),
            e.getDisputeId(),
            e.getSubmittedBy(),
            e.getTitle(),
            e.getNotes(),
            e.getFileName(),
            e.getMimeType(),
            e.getSizeBytes(),
            e.getSha256Hex(),
            e.getStorageKey(),
            e.getCreatedAt()
        );
    }
}
