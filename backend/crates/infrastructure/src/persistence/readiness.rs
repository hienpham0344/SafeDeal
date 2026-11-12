use std::time::Duration;

use async_trait::async_trait;
use safedeal_domain::ports::DatabaseReadinessPort;
use sqlx::PgPool;

pub struct PgDatabaseReadinessAdapter {
    pool: PgPool,
}

impl PgDatabaseReadinessAdapter {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DatabaseReadinessPort for PgDatabaseReadinessAdapter {
    async fn is_database_connected(&self) -> bool {
        let fut = sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&self.pool);
        match tokio::time::timeout(Duration::from_secs(2), fut).await {
            Ok(Ok(_)) => true,
            Ok(Err(err)) => {
                tracing::warn!(error = %err, "Database readiness check failed");
                false
            }
            Err(_) => {
                tracing::warn!("Database readiness check timed out after 2s");
                false
            }
        }
    }
}
