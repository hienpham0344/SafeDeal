use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::config::RateLimitConfig;

const WINDOW_DURATION: Duration = Duration::from_secs(60);
const CLEANUP_INTERVAL: usize = 256;
pub const DEFAULT_MAX_TRACKED_KEYS: usize = 16_384;
pub const WALLET_DEAL_DRAFTS_LIMIT_PER_MINUTE: usize = 30;
pub const WALLET_DEAL_SYNC_LIMIT_PER_MINUTE: usize = 30;
pub const WALLET_DISPUTE_EVIDENCE_LIMIT_PER_MINUTE: usize = 20;

#[derive(Debug)]
pub struct AuthRateLimitState {
    enabled: bool,
    max_requests_per_minute: usize,
    max_tracked_keys: usize,
    windows: Mutex<HashMap<String, VecDeque<Instant>>>,
    wallet_windows: Mutex<HashMap<String, VecDeque<Instant>>>,
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
            wallet_windows: Mutex::new(HashMap::new()),
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
        let calls = self
            .call_counter
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let mut guard = self
            .windows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        allow_in_sliding_window(
            &mut guard,
            client_key,
            self.max_requests_per_minute,
            self.max_tracked_keys,
            calls,
            now,
        )
    }

    pub fn allow_wallet_request(&self, wallet_bucket_key: &str, max_per_minute: usize) -> bool {
        self.allow_wallet_request_at(wallet_bucket_key, max_per_minute, Instant::now())
    }

    pub fn allow_wallet_request_at(
        &self,
        wallet_bucket_key: &str,
        max_per_minute: usize,
        now: Instant,
    ) -> bool {
        if !self.enabled {
            return true;
        }
        let calls = self
            .call_counter
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let mut guard = self
            .wallet_windows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        allow_in_sliding_window(
            &mut guard,
            wallet_bucket_key,
            max_per_minute,
            self.max_tracked_keys,
            calls,
            now,
        )
    }
}

fn allow_in_sliding_window(
    guard: &mut HashMap<String, VecDeque<Instant>>,
    key: &str,
    max_per_minute: usize,
    max_tracked_keys: usize,
    calls: usize,
    now: Instant,
) -> bool {
    if max_per_minute == 0 {
        return false;
    }

    if calls.is_multiple_of(CLEANUP_INTERVAL) {
        guard.retain(|_, deque| {
            evict_expired(deque, now);
            !deque.is_empty()
        });
    }

    if let Some(deque) = guard.get_mut(key) {
        evict_expired(deque, now);
        if deque.len() >= max_per_minute {
            return false;
        }
        deque.push_back(now);
        return true;
    }

    if guard.len() >= max_tracked_keys {
        // 1. Always purge expired keys first before evicting any active entry.
        guard.retain(|_, deque| {
            evict_expired(deque, now);
            !deque.is_empty()
        });
        // 2. If still at capacity, prefer evicting non-saturated keys over actively rate-limited keys.
        if guard.len() >= max_tracked_keys {
            if let Some(victim_key) = guard
                .iter()
                .min_by_key(|(_, deque)| {
                    (
                        deque.len() >= max_per_minute,
                        deque.len(),
                        deque.back().copied().unwrap_or(now),
                    )
                })
                .map(|(k, _)| k.clone())
            {
                guard.remove(&victim_key);
            }
        }
    }

    let mut deque = VecDeque::with_capacity(max_per_minute.min(64));
    deque.push_back(now);
    guard.insert(key.to_string(), deque);
    true
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
            trust_proxy_headers: false,
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
    fn bounds_tracked_ip_map_and_preserves_saturated_attacker_over_single_hit_keys() {
        let limiter = AuthRateLimitState::with_max_tracked_keys(
            &RateLimitConfig {
                enabled: true,
                auth_requests_per_minute: 2,
                trust_proxy_headers: false,
            },
            3,
        );
        let start = Instant::now();
        // Attacker saturates their bucket at t=0 (2 hits == limit)
        assert!(limiter.allow_request_at("198.51.100.99", start));
        assert!(limiter.allow_request_at("198.51.100.99", start));
        assert!(!limiter.allow_request_at("198.51.100.99", start + Duration::from_secs(1)));

        // Two normal single-hit users fill capacity to 3
        assert!(limiter.allow_request_at("198.51.100.1", start + Duration::from_secs(2)));
        assert!(limiter.allow_request_at("198.51.100.2", start + Duration::from_secs(3)));
        assert_eq!(limiter.windows.lock().unwrap().len(), 3);

        // 4th unique IP arrives: non-saturated .1 is evicted, keeping attacker .99 blocked!
        assert!(limiter.allow_request_at("198.51.100.3", start + Duration::from_secs(4)));
        assert_eq!(limiter.windows.lock().unwrap().len(), 3);
        assert!(!limiter.allow_request_at("198.51.100.99", start + Duration::from_secs(5)));

        // Once expired entries exist, expired keys are purged first without evicting active keys
        assert!(limiter.allow_request_at("198.51.100.4", start + Duration::from_secs(61)));
        assert!(limiter.allow_request_at("198.51.100.99", start + Duration::from_secs(61)));
    }
}
