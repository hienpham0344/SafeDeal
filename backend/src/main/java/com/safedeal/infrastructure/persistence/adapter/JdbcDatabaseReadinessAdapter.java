package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.port.DatabaseReadinessPort;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class JdbcDatabaseReadinessAdapter implements DatabaseReadinessPort {

    private static final Logger log = LoggerFactory.getLogger(JdbcDatabaseReadinessAdapter.class);
    private final DataSource dataSource;

    public JdbcDatabaseReadinessAdapter(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public boolean isDatabaseConnected() {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement("SELECT 1")) {
            statement.setQueryTimeout(2);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        } catch (Exception ex) {
            log.warn("Database readiness check failed: {}", ex.getMessage());
            return false;
        }
    }
}
