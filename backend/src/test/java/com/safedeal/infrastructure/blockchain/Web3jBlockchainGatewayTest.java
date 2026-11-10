package com.safedeal.infrastructure.blockchain;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.safedeal.infrastructure.configuration.BlockchainProperties;
import com.safedeal.shared.exception.ExternalServiceException;
import java.math.BigInteger;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.Request;
import org.web3j.protocol.core.methods.response.EthBlock;
import org.web3j.protocol.core.methods.response.EthGetTransactionReceipt;
import org.web3j.protocol.core.methods.response.TransactionReceipt;

class Web3jBlockchainGatewayTest {

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void throwsExternalServiceExceptionWhenBlockHeaderIsMissingInsteadOfFabricatingNow() throws Exception {
        Web3j web3j = mock(Web3j.class);
        BlockchainProperties props = new BlockchainProperties();
        props.setEnabled(true);
        props.setEscrowContractAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");

        TransactionReceipt receipt = mock(TransactionReceipt.class);
        when(receipt.isStatusOK()).thenReturn(true);
        when(receipt.getBlockNumber()).thenReturn(BigInteger.TEN);

        EthGetTransactionReceipt receiptRes = mock(EthGetTransactionReceipt.class);
        when(receiptRes.hasError()).thenReturn(false);
        when(receiptRes.getTransactionReceipt()).thenReturn(Optional.of(receipt));
        Request receiptReq = mock(Request.class);
        when(receiptReq.send()).thenReturn(receiptRes);
        when(web3j.ethGetTransactionReceipt(any())).thenReturn(receiptReq);

        EthBlock nullBlockRes = mock(EthBlock.class);
        when(nullBlockRes.hasError()).thenReturn(false);
        when(nullBlockRes.getBlock()).thenReturn(null);
        Request blockReq = mock(Request.class);
        when(blockReq.send()).thenReturn(nullBlockRes);
        when(web3j.ethGetBlockByNumber(any(), anyBoolean())).thenReturn(blockReq);

        Web3jBlockchainGateway gateway = new Web3jBlockchainGateway(web3j, props);

        assertThatThrownBy(() -> gateway.inspectTransaction("0x" + "1".repeat(64)))
            .isInstanceOf(ExternalServiceException.class)
            .hasMessageContaining("null block header");
    }
}
