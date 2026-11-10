package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.blockchain.ChainSyncState;
import com.safedeal.domain.port.ChainSyncStateRepository;
import com.safedeal.infrastructure.persistence.entity.JpaChainSyncStateEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataChainSyncStateRepository;
import java.util.Optional;
import org.springframework.stereotype.Repository;

@Repository
public class ChainSyncStateRepositoryAdapter implements ChainSyncStateRepository {

    private final SpringDataChainSyncStateRepository jpa;

    public ChainSyncStateRepositoryAdapter(SpringDataChainSyncStateRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Optional<ChainSyncState> findPrimary() {
        return jpa.findById(1).map(this::toDomain);
    }

    @Override
    public ChainSyncState save(ChainSyncState state) {
        JpaChainSyncStateEntity e = new JpaChainSyncStateEntity();
        e.setId(state.id());
        e.setChainId(state.chainId());
        e.setContractAddress(state.contractAddress().toLowerCase());
        e.setLastSyncedBlock(state.lastSyncedBlock());
        e.setUpdatedAt(state.updatedAt());
        return toDomain(jpa.save(e));
    }

    private ChainSyncState toDomain(JpaChainSyncStateEntity e) {
        return new ChainSyncState(
            e.getId(),
            e.getChainId(),
            e.getContractAddress(),
            e.getLastSyncedBlock(),
            e.getUpdatedAt()
        );
    }
}
