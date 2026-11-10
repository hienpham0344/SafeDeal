package com.safedeal.presentation.rest;

import com.safedeal.application.authentication.SiweSettings;
import com.safedeal.domain.port.BlockchainGateway;
import com.safedeal.domain.port.DatabaseReadinessPort;
import com.safedeal.domain.port.EvidenceStoragePort;
import com.safedeal.presentation.dto.HealthStatusResponse;
import com.safedeal.presentation.dto.ReadinessStatusResponse;
import com.safedeal.shared.validation.EthFormatValidator;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

    private final BlockchainGateway blockchainGateway;
    private final DatabaseReadinessPort databaseReadinessPort;
    private final EvidenceStoragePort evidenceStoragePort;
    private final SiweSettings siweSettings;

    public HealthController(
        BlockchainGateway blockchainGateway,
        DatabaseReadinessPort databaseReadinessPort,
        EvidenceStoragePort evidenceStoragePort,
        SiweSettings siweSettings
    ) {
        this.blockchainGateway = blockchainGateway;
        this.databaseReadinessPort = databaseReadinessPort;
        this.evidenceStoragePort = evidenceStoragePort;
        this.siweSettings = siweSettings;
    }

    @GetMapping
    public HealthStatusResponse health() {
        boolean configured = isContractConfigured(blockchainGateway.contractAddress());
        return new HealthStatusResponse(
            "UP",
            "safedeal-api",
            blockchainGateway.chainId(),
            blockchainGateway.chainName(),
            configured
        );
    }

    @GetMapping("/ready")
    public ResponseEntity<ReadinessStatusResponse> ready() {
        boolean databaseConnected = databaseReadinessPort.isDatabaseConnected();
        boolean evidenceStorageReady = evidenceStoragePort.isStorageReady();
        boolean siweConfigured = siweSettings.siweDomain() != null
            && !siweSettings.siweDomain().isBlank()
            && siweSettings.siweUri() != null
            && !siweSettings.siweUri().isBlank()
            && siweSettings.chainId() > 0;
        boolean blockchainEnabled = blockchainGateway.isEnabled();
        boolean escrowContractConfigured = isContractConfigured(blockchainGateway.contractAddress());

        boolean ready = databaseConnected
            && evidenceStorageReady
            && siweConfigured
            && (!blockchainEnabled || escrowContractConfigured);

        ReadinessStatusResponse payload = new ReadinessStatusResponse(
            ready ? "READY" : "NOT_READY",
            "safedeal-api",
            databaseConnected,
            evidenceStorageReady,
            siweConfigured,
            blockchainEnabled,
            escrowContractConfigured,
            blockchainGateway.chainId()
        );
        return ResponseEntity
            .status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
            .body(payload);
    }

    private boolean isContractConfigured(String address) {
        return address != null
            && !address.isBlank()
            && !EthFormatValidator.ZERO_ADDRESS.equalsIgnoreCase(address);
    }
}
