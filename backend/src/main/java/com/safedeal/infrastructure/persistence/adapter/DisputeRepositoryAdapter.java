package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.dispute.Dispute;
import com.safedeal.domain.port.DisputeRepository;
import com.safedeal.infrastructure.persistence.entity.JpaDisputeEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataDisputeRepository;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.stereotype.Repository;

@Repository
public class DisputeRepositoryAdapter implements DisputeRepository {

    private final SpringDataDisputeRepository jpa;

    public DisputeRepositoryAdapter(SpringDataDisputeRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Dispute save(Dispute dispute) {
        JpaDisputeEntity e = dispute.id() != null
            ? jpa.findById(dispute.id()).orElseGet(JpaDisputeEntity::new)
            : new JpaDisputeEntity();
        e.setTradeId(dispute.tradeId().toLowerCase());
        e.setOpenedBy(dispute.openedBy().toLowerCase());
        e.setReason(dispute.reason());
        e.setSummary(dispute.summary());
        e.setStatus(dispute.status());
        e.setBuyerAwardWei(dispute.buyerAwardWei());
        e.setSellerAwardWei(dispute.sellerAwardWei());
        e.setResolutionRationale(dispute.resolutionRationale());
        e.setOpenTxHash(dispute.openTxHash() != null ? dispute.openTxHash().toLowerCase() : null);
        e.setResolveTxHash(dispute.resolveTxHash() != null ? dispute.resolveTxHash().toLowerCase() : null);
        e.setCreatedAt(dispute.createdAt());
        e.setResolvedAt(dispute.resolvedAt());
        return toDomain(jpa.save(e));
    }

    @Override
    public Optional<Dispute> findById(Long id) {
        return jpa.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<Dispute> findByTradeId(String tradeId) {
        return jpa.findByTradeIdIgnoreCase(tradeId).map(this::toDomain);
    }

    @Override
    public Map<String, Long> findDisputeIdsByTradeIds(Collection<String> tradeIds) {
        if (tradeIds == null || tradeIds.isEmpty()) {
            return Map.of();
        }
        List<String> normalized = tradeIds.stream()
            .filter(id -> id != null && !id.isBlank())
            .map(id -> id.toLowerCase(Locale.ROOT))
            .distinct()
            .toList();
        if (normalized.isEmpty()) {
            return Map.of();
        }
        return jpa.findAllByTradeIdLowerIn(normalized).stream()
            .collect(Collectors.toMap(
                entity -> entity.getTradeId().toLowerCase(Locale.ROOT),
                JpaDisputeEntity::getId,
                (first, ignored) -> first
            ));
    }

    @Override
    public List<Dispute> findAssignedToArbiter(String arbiterAddress) {
        return jpa.findAssignedToArbiter(arbiterAddress).stream().map(this::toDomain).toList();
    }

    private Dispute toDomain(JpaDisputeEntity e) {
        return new Dispute(
            e.getId(),
            e.getTradeId(),
            e.getOpenedBy(),
            e.getReason(),
            e.getSummary(),
            e.getStatus(),
            e.getBuyerAwardWei(),
            e.getSellerAwardWei(),
            e.getResolutionRationale(),
            e.getOpenTxHash(),
            e.getResolveTxHash(),
            e.getCreatedAt(),
            e.getResolvedAt()
        );
    }
}
