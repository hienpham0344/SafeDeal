package com.safedeal.blockchain.domain;

/**
 * Port used by escrow / subscription modules to verify on-chain state.
 *
 * <p>Implementations must check: receipt success, expected contract address, expected event
 * signature and relevant event arguments. An AI component or the frontend can never bypass this.
 */
public interface BlockchainVerifier {

    BlockchainTransactionStatus getStatus(BlockchainNetwork network, String txHash);

    OnChainVerificationResult verify(ChainVerificationRequest request);
}
