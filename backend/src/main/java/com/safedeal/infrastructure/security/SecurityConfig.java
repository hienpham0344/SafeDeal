package com.safedeal.infrastructure.security;

import com.safedeal.infrastructure.configuration.AuthSecurityProperties;
import com.safedeal.infrastructure.configuration.CorsProperties;
import com.safedeal.infrastructure.configuration.RateLimitProperties;
import com.safedeal.shared.validation.CorrelationIdContext;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
        HttpSecurity http,
        JwtSessionService jwtSessionService,
        AuthSecurityProperties authProps,
        CorsProperties corsProps,
        RateLimitProperties rateLimitProps
    ) throws Exception {
        CorrelationIdFilter correlationIdFilter = new CorrelationIdFilter();
        AuthRateLimitFilter rateLimitFilter = new AuthRateLimitFilter(rateLimitProps);
        CookieSessionAuthenticationFilter sessionFilter = new CookieSessionAuthenticationFilter(jwtSessionService, authProps);
        DoubleSubmitCsrfFilter csrfFilter = new DoubleSubmitCsrfFilter(authProps);

        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> cors.configurationSource(corsConfigurationSource(corsProps)))
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .headers(headers -> headers
                .frameOptions(frame -> frame.deny())
                .contentTypeOptions(ct -> {})
                .referrerPolicy(ref -> ref.policy(
                    org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN
                ))
            )
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, authEx) -> {
                    res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    res.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    String correlationId = CorrelationIdContext.getOrDefault("n/a");
                    res.getWriter().write(
                        "{\"code\":\"UNAUTHORIZED\",\"message\":\"Wallet authentication required.\",\"correlationId\":\""
                            + correlationId + "\",\"timestamp\":\"" + Instant.now() + "\"}"
                    );
                })
                .accessDeniedHandler((req, res, accessEx) -> {
                    res.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    res.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    String correlationId = CorrelationIdContext.getOrDefault("n/a");
                    res.getWriter().write(
                        "{\"code\":\"FORBIDDEN\",\"message\":\"Access denied.\",\"correlationId\":\""
                            + correlationId + "\",\"timestamp\":\"" + Instant.now() + "\"}"
                    );
                })
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(
                    "/api/v1/health",
                    "/api/v1/health/ready",
                    "/actuator/health",
                    "/actuator/health/readiness",
                    "/actuator/health/liveness",
                    "/actuator/info"
                ).permitAll()
                .requestMatchers(HttpMethod.POST, "/api/v1/auth/nonce", "/api/v1/auth/verify", "/api/v1/auth/logout").permitAll()
                .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(correlationIdFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(rateLimitFilter, CorrelationIdFilter.class)
            .addFilterAfter(sessionFilter, AuthRateLimitFilter.class)
            .addFilterAfter(csrfFilter, CookieSessionAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(CorsProperties corsProps) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(corsProps.getAllowedOriginsList());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-CSRF-Token", "X-Correlation-Id"));
        config.setExposedHeaders(List.of("X-Correlation-Id"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
