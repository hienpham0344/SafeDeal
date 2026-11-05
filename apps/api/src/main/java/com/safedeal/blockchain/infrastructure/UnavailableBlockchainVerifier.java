package com.safedeal.blockchain.infrastructure;

import com.safedeal.blockchain.domain.BlockchainNetwork;
import com.safedeal.blockchain.domain.BlockchainTransactionStatus;
import com.safedeal.blockchain.domain.BlockchainVerifier;
import com.safedeal.blockchain.domain.ChainGatewayException;
import com.safedeal.blockchain.domain.ChainVerificationRequest;
import com.safedeal.blockchain.domain.OnChainVerificationResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Baseline adapter. It fails closed: until the Avalanche adapter is implemented, every
 * verification is reported as FAILED so no payment can be marked successful by mistake.
 */
@Component
public class UnavailableBlockchainVerifier implements BlockchainVerifier {

    private static final Logger log = LoggerFactory.getLogger(UnavailableBlockchainVerifier.class);

    private final AvalancheProperties properties;

    public UnavailableBlockchainVerifier(AvalancheProperties properties) {
        this.properties = properties;
        log.warn("Blockchain adapter not implemented yet; all verification attempts will fail closed (rpc={})",
                properties.rpcUrl());
    }

    @Override
    public BlockchainTransactionStatus getStatus(BlockchainNetwork network, String txHash) {
        throw new ChainGatewayException("Blockchain adapter not implemented");
    }

    @Override
    public OnChainVerificationResult verify(ChainVerificationRequest request) {
        return OnChainVerificationResult.rejected(
                BlockchainTransactionStatus.FAILED,
                "Blockchain verification adapter is not configured");
    }
}
