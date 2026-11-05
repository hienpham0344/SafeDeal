package com.safedeal.blockchain.application;

import com.safedeal.blockchain.domain.BlockchainVerifier;
import com.safedeal.blockchain.domain.ChainVerificationRequest;
import com.safedeal.blockchain.domain.ChainTransaction;
import com.safedeal.blockchain.domain.ChainTransactionRepository;
import com.safedeal.blockchain.domain.OnChainVerificationResult;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Single entry point for confirming a transaction. Callers (escrow, subscription) must use this
 * instead of trusting client-provided flags.
 */
@Service
public class BlockchainVerificationService {

    private final BlockchainVerifier verifier;
    private final ChainTransactionRepository repository;

    public BlockchainVerificationService(BlockchainVerifier verifier, ChainTransactionRepository repository) {
        this.verifier = verifier;
        this.repository = repository;
    }

    @Transactional
    public ChainTransaction verifyAndRecord(ChainVerificationRequest request) {
        OnChainVerificationResult result = verifier.verify(request);
        ChainTransaction record = new ChainTransaction(
                null,
                request.network(),
                request.txHash(),
                result.observedStatus(),
                result.blockNumber(),
                Instant.now(),
                result.confirmed() ? Instant.now() : null);
        return repository.save(record);
    }
}
