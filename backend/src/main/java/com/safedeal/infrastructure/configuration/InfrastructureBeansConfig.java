package com.safedeal.infrastructure.configuration;

import com.safedeal.application.authentication.SiweSettings;
import java.time.Clock;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.http.HttpService;

@Configuration
public class InfrastructureBeansConfig {

    @Bean
    public Clock systemClock() {
        return Clock.systemUTC();
    }

    @Bean
    public InitializingBean authSecurityStartupValidator(
        AuthSecurityProperties authProps,
        CorsProperties corsProps,
        BlockchainProperties chainProps,
        Environment environment
    ) {
        return () -> validateProductionConfiguration(authProps, corsProps, chainProps, environment.getActiveProfiles());
    }

    static void validateProductionConfiguration(
        AuthSecurityProperties authProps,
        CorsProperties corsProps,
        BlockchainProperties chainProps,
        String[] activeProfiles
    ) {
        boolean prodOrStaging = Arrays.stream(activeProfiles)
            .anyMatch(p -> "prod".equalsIgnoreCase(p) || "staging".equalsIgnoreCase(p));
        if (!prodOrStaging) {
            return;
        }
        String lowerSecret = authProps.getJwtSecret().toLowerCase();
        if (lowerSecret.contains("change-me")
            || lowerSecret.contains("changeme")
            || lowerSecret.contains("replace-with")
            || lowerSecret.contains("placeholder")
            || lowerSecret.contains("dev-only")
            || lowerSecret.contains("test-only")
            || lowerSecret.contains("example")) {
            throw new IllegalStateException("Production/staging profiles forbid placeholder JWT_SECRET values.");
        }
        if (!authProps.isCookieSecure()) {
            throw new IllegalStateException("COOKIE_SECURE must be true in staging/production profiles.");
        }
        if (isLoopbackHostOrUrl(authProps.getSiweDomain()) || isLoopbackHostOrUrl(authProps.getSiweUri())) {
            throw new IllegalStateException("SIWE_DOMAIN and SIWE_URI cannot point to localhost/loopback in staging/production.");
        }
        for (String origin : corsProps.getAllowedOriginsList()) {
            if (isLoopbackHostOrUrl(origin)) {
                throw new IllegalStateException("CORS_ALLOWED_ORIGINS cannot include localhost/loopback in staging/production.");
            }
        }
        if (chainProps.isEnabled() && isLoopbackHostOrUrl(chainProps.getRpcUrl())) {
            throw new IllegalStateException("AVALANCHE_RPC_URL cannot point to localhost/loopback in staging/production.");
        }
    }

    private static boolean isLoopbackHostOrUrl(String value) {
        if (value == null) {
            return false;
        }
        String lower = value.trim().toLowerCase();
        return lower.contains("localhost")
            || lower.contains("127.0.0.1")
            || lower.contains("[::1]");
    }

    @Bean
    public SiweSettings siweSettings(AuthSecurityProperties authProps, BlockchainProperties chainProps) {
        return new SiweSettings(
            authProps.getSiweDomain(),
            authProps.getSiweUri(),
            chainProps.getChainId(),
            authProps.getNonceTtlSeconds(),
            "Sign in to SafeDeal to manage your Avalanche escrow deals securely."
        );
    }

    @Bean(destroyMethod = "shutdown")
    public Web3j web3j(BlockchainProperties props) {
        long timeoutMs = props.getRpcTimeoutMs();
        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build();
        return Web3j.build(new HttpService(props.getRpcUrl(), client, false));
    }
}
