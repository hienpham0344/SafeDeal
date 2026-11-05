package com.safedeal.blockchain.domain;

import java.util.Optional;

public interface ChainTransactionRepository {

    ChainTransaction save(ChainTransaction transaction);

    Optional<ChainTransaction> findByTxHash(BlockchainNetwork network, String txHash);
}
