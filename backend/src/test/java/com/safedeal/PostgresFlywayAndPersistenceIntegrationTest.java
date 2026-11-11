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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionOperations;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers(disabledWithoutDocker = true)
class PostgresFlywayAndPersistenceIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("safedeal")
        .withUsername("safedeal")
        .withPassword("safedeal");

    @DynamicPropertySource
    static void registerPostgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
    }

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
    void validatesFlywaySchemaAndPostgresSpecificQueriesLocksAndOnConflictIdempotency() throws Exception {
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
