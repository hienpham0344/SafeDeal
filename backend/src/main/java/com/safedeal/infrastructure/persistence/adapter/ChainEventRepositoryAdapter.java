package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.port.ChainEventRepository;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ChainEventRepositoryAdapter implements ChainEventRepository {

    private static final String INSERT_IF_ABSENT_SQL = """
        INSERT INTO chain_events (
            tx_hash,
            log_index,
            block_number,
            block_timestamp,
            contract_address,
            event_type,
            trade_id,
            actor_address,
            amount_wei,
            buyer_award_wei,
            seller_award_wei,
            terms_hash,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        """;

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    public ChainEventRepositoryAdapter(JdbcTemplate jdbcTemplate, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    @Override
    public boolean recordIfAbsent(VerifiedChainEvent event) {
        String txHash = event.txHash().toLowerCase(Locale.ROOT);
        String contractAddress = event.contractAddress().toLowerCase(Locale.ROOT);
        String tradeId = event.tradeId() != null
            ? event.tradeId().toLowerCase(Locale.ROOT)
            : "0x0000000000000000000000000000000000000000000000000000000000000000";
        String actorAddress = event.actorAddress() != null ? event.actorAddress().toLowerCase(Locale.ROOT) : null;
        String termsHash = event.termsHash() != null ? event.termsHash().toLowerCase(Locale.ROOT) : null;

        int inserted = jdbcTemplate.update(
            INSERT_IF_ABSENT_SQL,
            txHash,
            event.logIndex(),
            event.blockNumber(),
            event.blockTimestampEpoch(),
            contractAddress,
            event.eventType().name(),
            tradeId,
            actorAddress,
            event.amountWei(),
            event.buyerAwardWei(),
            event.sellerAwardWei(),
            termsHash,
            Timestamp.from(Instant.now(clock))
        );
        return inserted > 0;
    }
}
