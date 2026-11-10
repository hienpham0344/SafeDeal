package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.deal.BlockchainTransaction;
import com.safedeal.domain.port.BlockchainTransactionRepository;
import com.safedeal.infrastructure.persistence.entity.JpaBlockchainTransactionEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataBlockchainTransactionRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Repository;

@Repository
public class BlockchainTransactionRepositoryAdapter implements BlockchainTransactionRepository {

    private final SpringDataBlockchainTransactionRepository jpa;

    public BlockchainTransactionRepositoryAdapter(SpringDataBlockchainTransactionRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public BlockchainTransaction saveOrUpdate(BlockchainTransaction tx) {
        String hash = tx.txHash().toLowerCase();
        JpaBlockchainTransactionEntity e = jpa.findByTxHashIgnoreCase(hash)
            .orElseGet(() -> {
                JpaBlockchainTransactionEntity created = new JpaBlockchainTransactionEntity();
                created.setCreatedAt(tx.createdAt());
                return created;
            });
        e.setTradeId(tx.tradeId().toLowerCase());
        e.setTxHash(hash);
        e.setOperation(tx.operation());
        e.setStatus(tx.status());
        e.setBlockNumber(tx.blockNumber());
        e.setSubmittedBy(tx.submittedBy() != null ? tx.submittedBy().toLowerCase() : null);
        e.setConfirmedAt(tx.confirmedAt());
        return toDomain(jpa.save(e));
    }

    @Override
    public Optional<BlockchainTransaction> findByTxHash(String txHash) {
        return jpa.findByTxHashIgnoreCase(txHash).map(this::toDomain);
    }

    @Override
    public List<BlockchainTransaction> findByTradeIdOrderByCreatedAtAsc(String tradeId) {
        return jpa.findByTradeIdIgnoreCaseOrderByCreatedAtAscIdAsc(tradeId).stream()
            .map(this::toDomain)
            .toList();
    }

    private BlockchainTransaction toDomain(JpaBlockchainTransactionEntity e) {
        return new BlockchainTransaction(
            e.getId(),
            e.getTradeId(),
            e.getTxHash(),
            e.getOperation(),
            e.getStatus(),
            e.getBlockNumber(),
            e.getSubmittedBy(),
            e.getCreatedAt(),
            e.getConfirmedAt()
        );
    }
}
