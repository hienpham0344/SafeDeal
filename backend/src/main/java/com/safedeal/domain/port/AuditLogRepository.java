package com.safedeal.domain.port;

import com.safedeal.domain.dispute.AuditLogEntry;

public interface AuditLogRepository {
    void append(AuditLogEntry entry);
}
