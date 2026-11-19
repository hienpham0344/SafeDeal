use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::config::RateLimitConfig;

const WINDOW_DURATION: Duration = Duration::from_secs(60);
const CLEANUP_INTERVAL: usize = 256;
pub const DEFAULT_MAX_TRACKED_KEYS: usize = 16_384;

#[derive(Debug)]
pub struct AuthRateLimitState {
    enabled: bool,
    max_requests_per_minute: usize,
    max_tracked_keys: usize,
    windows: Mutex<HashMap<String, VecDeque<Instant>>>,
    call_counter: AtomicUsize,
}

impl AuthRateLimitState {
    pub fn new(config: &RateLimitConfig) -> Self {
        Self::with_max_tracked_keys(config, DEFAULT_MAX_TRACKED_KEYS)
    }

    pub fn with_max_tracked_keys(config: &RateLimitConfig, max_tracked_keys: usize) -> Self {
        Self {
            enabled: config.enabled,
            max_requests_per_minute: config.auth_requests_per_minute,
            max_tracked_keys: max_tracked_keys.max(1),
            windows: Mutex::new(HashMap::new()),
            call_counter: AtomicUsize::new(0),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn is_rate_limited_path(path: &str) -> bool {
        path == "/api/v1/auth/nonce" || path == "/api/v1/auth/verify"
    }

    pub fn allow_request(&self, client_key: &str) -> bool {
        self.allow_request_at(client_key, Instant::now())
    }

    pub fn allow_request_at(&self, client_key: &str, now: Instant) -> bool {
        if !self.enabled {
            return true;
        }
        if self.max_requests_per_minute == 0 {
            return false;
        }
        let calls = self
            .call_counter
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let mut guard = self
            .windows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if calls.is_multiple_of(CLEANUP_INTERVAL) {
            guard.retain(|_, deque| {
                evict_expired(deque, now);
                !deque.is_empty()
            });
        }

        if let Some(deque) = guard.get_mut(client_key) {
            evict_expired(deque, now);
            if deque.len() >= self.max_requests_per_minute {
                return false;
            }
            deque.push_back(now);
            return true;
        }

        if guard.len() >= self.max_tracked_keys {
            guard.retain(|_, deque| {
                evict_expired(deque, now);
                !deque.is_empty()
            });
            if guard.len() >= self.max_tracked_keys {
                if let Some(oldest_key) = guard
                    .iter()
                    .min_by_key(|(_, deque)| deque.back().copied().unwrap_or(now))
                    .map(|(k, _)| k.clone())
                {
                    guard.remove(&oldest_key);
                }
            }
        }

        let mut deque = VecDeque::with_capacity(self.max_requests_per_minute.min(64));
        deque.push_back(now);
        guard.insert(client_key.to_string(), deque);
        true
    }
}

fn evict_expired(deque: &mut VecDeque<Instant>, now: Instant) {
    while let Some(&front) = deque.front() {
        if now.saturating_duration_since(front) >= WINDOW_DURATION {
            deque.pop_front();
        } else {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_per_ip_sliding_window_and_recovers_after_one_minute() {
        let limiter = AuthRateLimitState::new(&RateLimitConfig {
            enabled: true,
            auth_requests_per_minute: 2,
        });
        let start = Instant::now();
        assert!(limiter.allow_request_at("198.51.100.10", start));
        assert!(limiter.allow_request_at("198.51.100.10", start + Duration::from_secs(10)));
        assert!(!limiter.allow_request_at("198.51.100.10", start + Duration::from_secs(20)));
        // Different IP is unaffected
        assert!(limiter.allow_request_at("198.51.100.11", start + Duration::from_secs(20)));
        // After 60s window expires, permits again
        assert!(limiter.allow_request_at("198.51.100.10", start + Duration::from_secs(60)));
    }

    #[test]
    fn bounds_tracked_ip_map_and_evicts_expired_or_oldest_keys() {
        let limiter = AuthRateLimitState::with_max_tracked_keys(
            &RateLimitConfig {
                enabled: true,
                auth_requests_per_minute: 1,
            },
            3,
        );
        let start = Instant::now();
        assert!(limiter.allow_request_at("198.51.100.1", start));
        assert!(limiter.allow_request_at("198.51.100.2", start + Duration::from_secs(1)));
        assert!(limiter.allow_request_at("198.51.100.3", start + Duration::from_secs(2)));
        assert_eq!(limiter.windows.lock().unwrap().len(), 3);

        // 4th unique IP evicts oldest key (.1), preserving .2 and .3 rate limits
        assert!(limiter.allow_request_at("198.51.100.4", start + Duration::from_secs(3)));
        assert_eq!(limiter.windows.lock().unwrap().len(), 3);
        assert!(!limiter.allow_request_at("198.51.100.2", start + Duration::from_secs(4)));
        assert!(!limiter.allow_request_at("198.51.100.3", start + Duration::from_secs(4)));

        // After window expires, expired entries are purged cleanly on new arrival
        assert!(limiter.allow_request_at("198.51.100.5", start + Duration::from_secs(65)));
        assert_eq!(limiter.windows.lock().unwrap().len(), 1);
    }
}
