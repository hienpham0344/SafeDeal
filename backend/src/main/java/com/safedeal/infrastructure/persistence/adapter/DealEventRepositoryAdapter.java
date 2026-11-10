package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.infrastructure.persistence.entity.JpaDealEventEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataDealEventRepository;
import java.sql.Timestamp;
import java.util.List;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DealEventRepositoryAdapter implements DealEventRepository {

    private static final String INSERT_IF_ABSENT_SQL = """
        INSERT INTO deal_events (
            trade_id,
            event_type,
            actor_address,
            tx_hash,
            block_number,
            log_index,
            details,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        """;

    private final SpringDataDealEventRepository jpa;
    private final JdbcTemplate jdbcTemplate;

    public DealEventRepositoryAdapter(SpringDataDealEventRepository jpa, JdbcTemplate jdbcTemplate) {
        this.jpa = jpa;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public boolean saveIfAbsent(DealEvent event) {
        if (event.txHash() != null && event.logIndex() != null) {
            int inserted = jdbcTemplate.update(
                INSERT_IF_ABSENT_SQL,
                event.tradeId().toLowerCase(Locale.ROOT),
                event.eventType(),
                event.actorAddress() != null ? event.actorAddress().toLowerCase(Locale.ROOT) : null,
                event.txHash().toLowerCase(Locale.ROOT),
                event.blockNumber(),
                event.logIndex(),
                event.details(),
                Timestamp.from(event.createdAt())
            );
            return inserted > 0;
        }
        JpaDealEventEntity e = new JpaDealEventEntity();
        e.setTradeId(event.tradeId().toLowerCase(Locale.ROOT));
        e.setEventType(event.eventType());
        e.setActorAddress(event.actorAddress() != null ? event.actorAddress().toLowerCase(Locale.ROOT) : null);
        e.setTxHash(null);
        e.setBlockNumber(event.blockNumber());
        e.setLogIndex(null);
        e.setDetails(event.details());
        e.setCreatedAt(event.createdAt());
        jpa.save(e);
        return true;
    }

    @Override
    public List<DealEvent> findByTradeIdOrderByCreatedAtAsc(String tradeId) {
        return jpa.findByTradeIdIgnoreCaseOrderByCreatedAtAscIdAsc(tradeId).stream()
            .map(e -> new DealEvent(
                e.getId(),
                e.getTradeId(),
                e.getEventType(),
                e.getActorAddress(),
                e.getTxHash(),
                e.getBlockNumber(),
                e.getLogIndex(),
                e.getDetails(),
                e.getCreatedAt()
            ))
            .toList();
    }
}
