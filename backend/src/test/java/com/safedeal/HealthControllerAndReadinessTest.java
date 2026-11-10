package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.safedeal.application.authentication.SiweSettings;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.DatabaseReadinessPort;
import com.safedeal.domain.port.EvidenceStoragePort;
import com.safedeal.infrastructure.persistence.adapter.JdbcDatabaseReadinessAdapter;
import com.safedeal.presentation.dto.ReadinessStatusResponse;
import com.safedeal.presentation.rest.HealthController;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class HealthControllerAndReadinessTest {

    @Test
    void jdbcReadinessAdapterReturnsFalseWhenConnectionFails() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenThrow(new SQLException("Connection refused"));

        JdbcDatabaseReadinessAdapter adapter = new JdbcDatabaseReadinessAdapter(dataSource);
        assertThat(adapter.isDatabaseConnected()).isFalse();
    }

    @Test
    void readyReturns503WhenDatabaseOrStorageOrSiweIsNotReady() {
        BlockchainGateway gateway = mock(BlockchainGateway.class);
        when(gateway.isEnabled()).thenReturn(true);
        when(gateway.chainId()).thenReturn(31337L);
        when(gateway.contractAddress()).thenReturn("0x5fbdb2315678afecb367f032d93f642f64180aa3");

        DatabaseReadinessPort dbDown = () -> false;
        EvidenceStoragePort storageDown = mock(EvidenceStoragePort.class);
        when(storageDown.isStorageReady()).thenReturn(false);

        HealthController controller = new HealthController(
            gateway,
            dbDown,
            storageDown,
            new SiweSettings("", "", 0L, 300L, "stmt")
        );

        ResponseEntity<ReadinessStatusResponse> response = controller.ready();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo("NOT_READY");
        assertThat(response.getBody().databaseConnected()).isFalse();
        assertThat(response.getBody().evidenceStorageReady()).isFalse();
        assertThat(response.getBody().siweConfigured()).isFalse();
    }

    @Test
    void readyReturns200WhenBlockchainDisabledEvenWithoutContractAddress() {
        BlockchainGateway gateway = mock(BlockchainGateway.class);
        when(gateway.isEnabled()).thenReturn(false);
        when(gateway.chainId()).thenReturn(31337L);
        when(gateway.contractAddress()).thenReturn("");

        EvidenceStoragePort storageOk = mock(EvidenceStoragePort.class);
        when(storageOk.isStorageReady()).thenReturn(true);

        HealthController controller = new HealthController(
            gateway,
            () -> true,
            storageOk,
            new SiweSettings("localhost:5173", "http://localhost:5173", 31337L, 300L, "stmt")
        );

        ResponseEntity<ReadinessStatusResponse> response = controller.ready();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo("READY");
        assertThat(response.getBody().databaseConnected()).isTrue();
    }
}
