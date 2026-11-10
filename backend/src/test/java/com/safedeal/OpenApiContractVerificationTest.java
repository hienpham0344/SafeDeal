package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenApiContractVerificationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void generatedOpenApiSpecMatchesCommittedDocsOpenApiJson() throws Exception {
        MvcResult result = mockMvc.perform(get("/v3/api-docs"))
            .andExpect(status().isOk())
            .andReturn();

        JsonNode liveSpec = objectMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
        assertThat(liveSpec.path("paths").has("/api/v1/health/ready")).isTrue();
        assertThat(liveSpec.path("paths").has("/api/v1/deals")).isTrue();
        assertThat(liveSpec.path("paths").has("/api/v1/auth/verify")).isTrue();

        Path specPath = resolveDocsOpenApiPath();
        ObjectMapper prettyMapper = objectMapper.copy().enable(SerializationFeature.INDENT_OUTPUT);
        String formatted = prettyMapper.writeValueAsString(liveSpec) + System.lineSeparator();

        if (Boolean.parseBoolean(System.getProperty("updateOpenApiSpec", "false"))) {
            Files.createDirectories(specPath.getParent());
            Files.writeString(specPath, formatted, StandardCharsets.UTF_8);
        }

        assertThat(specPath)
            .withFailMessage("Missing committed OpenAPI spec at %s; run with -DupdateOpenApiSpec=true", specPath)
            .exists();

        JsonNode committedSpec = objectMapper.readTree(Files.readString(specPath, StandardCharsets.UTF_8));
        assertThat(liveSpec)
            .withFailMessage(
                "docs/openapi.json is out of sync with /v3/api-docs. Run ./backend/gradlew -p backend test --tests '*OpenApiContractVerificationTest' -DupdateOpenApiSpec=true"
            )
            .isEqualTo(committedSpec);
    }

    private Path resolveDocsOpenApiPath() {
        Path fromBackendDir = Path.of("..", "docs", "openapi.json").normalize();
        if (Files.exists(fromBackendDir.getParent())) {
            return fromBackendDir.toAbsolutePath().normalize();
        }
        return Path.of("docs", "openapi.json").toAbsolutePath().normalize();
    }
}
