package com.safedeal.infrastructure.blockchain;

import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.infrastructure.configuration.BlockchainProperties;
import com.safedeal.shared.exception.ExternalServiceException;
import com.safedeal.shared.validation.EthFormatValidator;
import java.io.IOException;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.DefaultBlockParameter;
import org.web3j.protocol.core.DefaultBlockParameterName;
import org.web3j.protocol.core.methods.request.EthFilter;
import org.web3j.protocol.core.methods.request.Transaction;
import org.web3j.protocol.core.methods.response.EthBlock;
import org.web3j.protocol.core.methods.response.EthCall;
import org.web3j.protocol.core.methods.response.EthGetTransactionReceipt;
import org.web3j.protocol.core.methods.response.EthLog;
import org.web3j.protocol.core.methods.response.Log;
import org.web3j.protocol.core.methods.response.TransactionReceipt;

@Component
public class Web3jBlockchainGateway implements BlockchainGateway {

    private final Web3j web3j;
    private final BlockchainProperties props;

    public Web3jBlockchainGateway(Web3j web3j, BlockchainProperties props) {
        this.web3j = web3j;
        this.props = props;
    }

    @Override
    public boolean isEnabled() {
        return props.isEnabled();
    }

    @Override
    public long chainId() {
        return props.getChainId();
    }

    @Override
    public String chainName() {
        return props.getChainName();
    }

    @Override
    public String contractAddress() {
        return props.getEscrowContractAddress().toLowerCase();
    }

    @Override
    public long deploymentBlock() {
        return props.getDeploymentBlock();
    }

    @Override
    public int confirmationsRequired() {
        return props.getConfirmationsRequired();
    }

    @Override
    public long syncBatchSize() {
        return props.getSyncBatchSize();
    }

    private boolean hasConfiguredContract() {
        String addr = contractAddress();
        return !addr.isBlank() && !EthFormatValidator.ZERO_ADDRESS.equalsIgnoreCase(addr);
    }

    @Override
    public Optional<OnChainTradeSnapshot> fetchTrade(String tradeId) {
        if (!isEnabled() || !hasConfiguredContract()) {
            return Optional.empty();
        }
        try {
            String callData = SafeDealContractCodec.encodeGetTradeCallData(tradeId);
            EthCall response = web3j.ethCall(
                Transaction.createEthCallTransaction(null, contractAddress(), callData),
                DefaultBlockParameterName.LATEST
            ).send();
            if (response.hasError()) {
                throw new ExternalServiceException("eth_call getTrade failed: " + response.getError().getMessage());
            }
            return SafeDealContractCodec.decodeGetTradeResponse(response.getValue());
        } catch (IOException ex) {
            throw new ExternalServiceException("RPC error calling getTrade for " + tradeId, ex);
        }
    }

    @Override
    public Optional<TransactionVerificationResult> inspectTransaction(String txHash) {
        if (!isEnabled() || !hasConfiguredContract()) {
            return Optional.empty();
        }
        try {
            EthGetTransactionReceipt receiptResponse = web3j.ethGetTransactionReceipt(txHash).send();
            if (receiptResponse.hasError()) {
                throw new ExternalServiceException("RPC error reading receipt: " + receiptResponse.getError().getMessage());
            }
            Optional<TransactionReceipt> maybeReceipt = receiptResponse.getTransactionReceipt();
            if (maybeReceipt.isEmpty()) {
                return Optional.empty();
            }
            TransactionReceipt receipt = maybeReceipt.get();
            boolean succeeded = receipt.isStatusOK();
            long blockNumber = receipt.getBlockNumber().longValue();
            long blockTimestamp = fetchBlockTimestampEpoch(receipt.getBlockNumber());
            String configuredAddress = contractAddress();

            List<VerifiedChainEvent> decodedEvents = new ArrayList<>();
            if (succeeded && receipt.getLogs() != null) {
                for (Log logEntry : receipt.getLogs()) {
                    if (logEntry.getAddress() != null
                        && logEntry.getAddress().equalsIgnoreCase(configuredAddress)) {
                        SafeDealContractCodec.decodeLog(logEntry, blockTimestamp)
                            .ifPresent(decodedEvents::add);
                    }
                }
            }

            return Optional.of(new TransactionVerificationResult(
                txHash.toLowerCase(),
                succeeded,
                blockNumber,
                receipt.getFrom() != null ? receipt.getFrom().toLowerCase() : null,
                receipt.getTo() != null ? receipt.getTo().toLowerCase() : null,
                decodedEvents
            ));
        } catch (IOException ex) {
            throw new ExternalServiceException("RPC error inspecting transaction " + txHash, ex);
        }
    }

    @Override
    public long fetchLatestBlockNumber() {
        if (!isEnabled()) {
            return 0L;
        }
        try {
            var response = web3j.ethBlockNumber().send();
            if (response.hasError()) {
                throw new ExternalServiceException("eth_blockNumber failed: " + response.getError().getMessage());
            }
            return response.getBlockNumber().longValue();
        } catch (IOException ex) {
            throw new ExternalServiceException("RPC error reading latest block number", ex);
        }
    }

    @Override
    public List<VerifiedChainEvent> fetchLogs(long fromBlock, long toBlock) {
        if (!isEnabled() || !hasConfiguredContract() || toBlock < fromBlock) {
            return List.of();
        }
        try {
            EthFilter filter = new EthFilter(
                DefaultBlockParameter.valueOf(BigInteger.valueOf(fromBlock)),
                DefaultBlockParameter.valueOf(BigInteger.valueOf(toBlock)),
                contractAddress()
            );
            EthLog ethLog = web3j.ethGetLogs(filter).send();
            if (ethLog.hasError()) {
                throw new ExternalServiceException("eth_getLogs failed: " + ethLog.getError().getMessage());
            }

            Map<BigInteger, Long> blockTimestampCache = new HashMap<>();
            List<VerifiedChainEvent> decoded = new ArrayList<>();
            for (EthLog.LogResult<?> result : ethLog.getLogs()) {
                if (result.get() instanceof Log logEntry) {
                    BigInteger blockNum = logEntry.getBlockNumber();
                    long ts = blockTimestampCache.computeIfAbsent(blockNum, this::fetchBlockTimestampEpochSafe);
                    SafeDealContractCodec.decodeLog(logEntry, ts).ifPresent(decoded::add);
                }
            }
            return decoded;
        } catch (IOException ex) {
            throw new ExternalServiceException("RPC error fetching logs in range [" + fromBlock + ", " + toBlock + "]", ex);
        }
    }

    private long fetchBlockTimestampEpochSafe(BigInteger blockNumber) {
        try {
            return fetchBlockTimestampEpoch(blockNumber);
        } catch (IOException ex) {
            throw new ExternalServiceException("RPC error reading block timestamp for block " + blockNumber, ex);
        }
    }

    private long fetchBlockTimestampEpoch(BigInteger blockNumber) throws IOException {
        EthBlock block = web3j.ethGetBlockByNumber(DefaultBlockParameter.valueOf(blockNumber), false).send();
        if (block.hasError()) {
            throw new ExternalServiceException("eth_getBlockByNumber failed: " + block.getError().getMessage());
        }
        if (block.getBlock() == null || block.getBlock().getTimestamp() == null) {
            throw new ExternalServiceException("RPC node returned null block header for block " + blockNumber);
        }
        return block.getBlock().getTimestamp().longValue();
    }
}
