use std::future::Future;

pub const HEADER_NAME: &str = "X-Correlation-Id";

tokio::task_local! {
    static CURRENT_CORRELATION_ID: String;
}

pub fn header_name() -> &'static str {
    HEADER_NAME
}

/// Validates correlation ID format matching `^[a-zA-Z0-9_-]{8,64}$`.
pub fn is_valid_correlation_id(candidate: &str) -> bool {
    let trimmed = candidate.trim();
    let len = trimmed.len();
    (8..=64).contains(&len)
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn current_correlation_id(fallback: &str) -> String {
    CURRENT_CORRELATION_ID
        .try_with(Clone::clone)
        .unwrap_or_else(|_| fallback.to_owned())
}

pub struct CorrelationIdContext;

impl CorrelationIdContext {
    pub fn get_or_default(fallback: &str) -> String {
        current_correlation_id(fallback)
    }
}

pub async fn with_correlation_id<F, T>(id: String, fut: F) -> T
where
    F: Future<Output = T>,
{
    CURRENT_CORRELATION_ID.scope(id, fut).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_correlation_id_bounds_and_charset() {
        assert!(!is_valid_correlation_id("short"));
        assert!(is_valid_correlation_id("corr-12345678"));
        assert!(is_valid_correlation_id("req_ABCD_1234"));
        assert!(!is_valid_correlation_id("bad!id#1234"));
        assert!(!is_valid_correlation_id(&"a".repeat(65)));
    }

    #[tokio::test]
    async fn propagates_correlation_id_across_await() {
        assert_eq!(current_correlation_id("n/a"), "n/a");
        let observed = with_correlation_id("req-12345678".to_owned(), async {
            tokio::task::yield_now().await;
            current_correlation_id("n/a")
        })
        .await;
        assert_eq!(observed, "req-12345678");
        assert_eq!(current_correlation_id("n/a"), "n/a");
    }
}
