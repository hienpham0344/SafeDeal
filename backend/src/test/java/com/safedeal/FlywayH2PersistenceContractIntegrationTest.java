package com.safedeal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.safedeal.application.synchronization.BlockchainEventIndexerService;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.ChainEventRepository;
import com.safedeal.domain.port.ChainSyncStateRepository;
import com.safedeal.domain.port.DatabaseReadinessPort;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionOperations;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:safedeal_flyway_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=validate",
    "spring.flyway.enabled=true"
})
class FlywayH2PersistenceContractIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private DatabaseReadinessPort databaseReadinessPort;

    @Autowired
    private DealRepository dealRepository;

    @Autowired
    private DealEventRepository dealEventRepository;

    @Autowired
    private ChainEventRepository chainEventRepository;

    @Autowired
    private ChainSyncStateRepository chainSyncStateRepository;

    @Autowired
    private BlockchainEventIndexerService indexerService;

    @Autowired
    private TransactionOperations txOperations;

    @MockitoBean
    private BlockchainGateway blockchainGateway;

    @BeforeEach
    void setupGateway() {
        PersistenceContractVerifier.configureGatewayDefaults(blockchainGateway);
    }

    @Test
    void verifiesFlywaySchemaLocksOnConflictIndexerAndArbitrationContractOnH2PostgresMode() throws Exception {
        PersistenceContractVerifier.verifyFullContract(
            mockMvc,
            objectMapper,
            databaseReadinessPort,
            dealRepository,
            dealEventRepository,
            chainEventRepository,
            chainSyncStateRepository,
            indexerService,
            txOperations,
            blockchainGateway
        );
    }
}
