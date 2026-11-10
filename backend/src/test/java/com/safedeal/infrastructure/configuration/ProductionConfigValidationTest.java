package com.safedeal.infrastructure.configuration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ProductionConfigValidationTest {

    private static AuthSecurityProperties validProdAuth() {
        AuthSecurityProperties props = new AuthSecurityProperties();
        props.setJwtSecret("unit-test-signing-key-" + "0123456789abcdef".repeat(2));
        props.setCookieSecure(true);
        props.setSiweDomain("app.safedeal.example.org");
        props.setSiweUri("https://app.safedeal.example.org");
        return props;
    }

    private static CorsProperties validProdCors() {
        CorsProperties props = new CorsProperties();
        props.setAllowedOrigins("https://app.safedeal.example.org");
        return props;
    }

    private static BlockchainProperties validProdChain() {
        BlockchainProperties props = new BlockchainProperties();
        props.setEnabled(true);
        props.setRpcUrl("https://api.avax-test.network/ext/bc/C/rpc");
        props.setEscrowContractAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
        return props;
    }

    @Test
    void rejectsEnvExamplePlaceholderJwtAndLoopbackUrlsInProdAndStaging() {
        AuthSecurityProperties replaceWithSecret = validProdAuth();
        replaceWithSecret.setJwtSecret("replace-with-a-cryptographically-random-secret-at-least-32-chars");
        assertThatThrownBy(() -> InfrastructureBeansConfig.validateProductionConfiguration(
            replaceWithSecret, validProdCors(), validProdChain(), new String[] {"prod"}
        )).isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("JWT_SECRET");

        AuthSecurityProperties localSiwe = validProdAuth();
        localSiwe.setSiweUri("http://localhost:5173");
        assertThatThrownBy(() -> InfrastructureBeansConfig.validateProductionConfiguration(
            localSiwe, validProdCors(), validProdChain(), new String[] {"staging"}
        )).isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("SIWE");

        CorsProperties localCors = new CorsProperties();
        localCors.setAllowedOrigins("http://127.0.0.1:5173");
        assertThatThrownBy(() -> InfrastructureBeansConfig.validateProductionConfiguration(
            validProdAuth(), localCors, validProdChain(), new String[] {"prod"}
        )).isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("CORS_ALLOWED_ORIGINS");

        BlockchainProperties localRpc = validProdChain();
        localRpc.setRpcUrl("http://127.0.0.1:8545");
        assertThatThrownBy(() -> InfrastructureBeansConfig.validateProductionConfiguration(
            validProdAuth(), validProdCors(), localRpc, new String[] {"prod"}
        )).isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("AVALANCHE_RPC_URL");

        // Wait: ensure valid domain containing neither localhost nor banned words passes
        AuthSecurityProperties cleanAuth = validProdAuth();
        cleanAuth.setSiweDomain("app.safedeal.network");
        cleanAuth.setSiweUri("https://app.safedeal.network");
        CorsProperties cleanCors = new CorsProperties();
        cleanCors.setAllowedOrigins("https://app.safedeal.network");
        assertThatCode(() -> InfrastructureBeansConfig.validateProductionConfiguration(
            cleanAuth, cleanCors, validProdChain(), new String[] {"prod"}
        )).doesNotThrowAnyException();

        assertThatCode(() -> InfrastructureBeansConfig.validateProductionConfiguration(
            replaceWithSecret, localCors, localRpc, new String[] {"local"}
        )).doesNotThrowAnyException();
    }
}
