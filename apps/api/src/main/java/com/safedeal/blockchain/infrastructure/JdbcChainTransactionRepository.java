package com.safedeal.blockchain.infrastructure;

import com.safedeal.blockchain.domain.BlockchainNetwork;
import com.safedeal.blockchain.domain.BlockchainTransactionStatus;
import com.safedeal.blockchain.domain.ChainTransaction;
import com.safedeal.blockchain.domain.ChainTransactionRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/**
 * Small JDBC adapter for chain_transactions. JPA entities arrive with the escrow module; keeping
 * this adapter plain avoids premature entity modelling while persisting verifications.
 */
@Repository
public class JdbcChainTransactionRepository implements ChainTransactionRepository {

    private static final RowMapper<ChainTransaction> MAPPER = (rs, rowNum) -> new ChainTransaction(
            rs.getLong("id"),
            BlockchainNetwork.valueOf(rs.getString("network")),
            rs.getString("tx_hash"),
            BlockchainTransactionStatus.valueOf(rs.getString("status")),
            rs.getObject("block_number", Long.class),
            toInstant(rs.getTimestamp("submitted_at")),
            toInstant(rs.getTimestamp("confirmed_at")));

    private final JdbcClient jdbc;

    public JdbcChainTransactionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public ChainTransaction save(ChainTransaction tx) {
        if (tx.id() == null) {
            KeyHolder keys = new GeneratedKeyHolder();
            jdbc.sql("""
                    INSERT INTO chain_transactions
                        (network, tx_hash, status, block_number, submitted_at, confirmed_at)
                    VALUES (:network, :txHash, :status, :blockNumber, :submittedAt, :confirmedAt)
                    """)
                    .param("network", tx.network().name())
                    .param("txHash", tx.txHash())
                    .param("status", tx.status().name())
                    .param("blockNumber", tx.blockNumber())
                    .param("submittedAt", Timestamp.from(tx.submittedAt()))
                    .param("confirmedAt", tx.confirmedAt() == null ? null : Timestamp.from(tx.confirmedAt()))
                    .update(keys, "id");
            return new ChainTransaction(keys.getKey().longValue(), tx.network(), tx.txHash(), tx.status(),
                    tx.blockNumber(), tx.submittedAt(), tx.confirmedAt());
        }
        jdbc.sql("""
                UPDATE chain_transactions
                   SET status = :status, block_number = :blockNumber, confirmed_at = :confirmedAt
                 WHERE id = :id
                """)
                .param("status", tx.status().name())
                .param("blockNumber", tx.blockNumber())
                .param("confirmedAt", tx.confirmedAt() == null ? null : Timestamp.from(tx.confirmedAt()))
                .param("id", tx.id())
                .update();
        return tx;
    }

    @Override
    public Optional<ChainTransaction> findByTxHash(BlockchainNetwork network, String txHash) {
        List<ChainTransaction> found = jdbc.sql("""
                SELECT id, network, tx_hash, status, block_number, submitted_at, confirmed_at
                  FROM chain_transactions
                 WHERE network = :network AND tx_hash = :txHash
                """)
                .param("network", network.name())
                .param("txHash", txHash)
                .query(MAPPER)
                .list();
        return found.stream().findFirst();
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
