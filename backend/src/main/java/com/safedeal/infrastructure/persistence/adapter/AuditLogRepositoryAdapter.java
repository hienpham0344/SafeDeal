package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.dispute.AuditLogEntry;
import com.safedeal.domain.port.AuditLogRepository;
import com.safedeal.infrastructure.persistence.entity.JpaAuditLogEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataAuditLogRepository;
import org.springframework.stereotype.Repository;

@Repository
public class AuditLogRepositoryAdapter implements AuditLogRepository {

    private final SpringDataAuditLogRepository jpa;

    public AuditLogRepositoryAdapter(SpringDataAuditLogRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public void append(AuditLogEntry entry) {
        JpaAuditLogEntity e = new JpaAuditLogEntity();
        e.setAction(entry.action());
        e.setActorAddress(entry.actorAddress() != null ? entry.actorAddress().toLowerCase() : null);
        e.setResourceType(entry.resourceType());
        e.setResourceId(entry.resourceId());
        e.setCorrelationId(entry.correlationId());
        e.setDetails(entry.details());
        e.setCreatedAt(entry.createdAt());
        jpa.save(e);
    }
}
