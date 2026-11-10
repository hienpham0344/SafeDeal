package com.safedeal.domain.port;

import com.safedeal.domain.blockchain.ChainSyncState;
import java.util.Optional;

public interface ChainSyncStateRepository {
    Optional<ChainSyncState> findPrimary();

    ChainSyncState save(ChainSyncState state);
}
