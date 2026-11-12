#![allow(dead_code)]

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::extract::connect_info::MockConnectInfo;
use axum::http::{header, Method, Request, Response, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use k256::ecdsa::SigningKey;
use k256::elliptic_curve::rand_core::OsRng;
use safedeal_api::{assemble_application, ApplicationComponents};
use safedeal_domain::blockchain::{
    OnChainTradeSnapshot, TransactionVerificationResult, VerifiedChainEvent,
};
use safedeal_domain::ports::BlockchainGateway;
use safedeal_infrastructure::config::AppConfig;
use safedeal_infrastructure::persistence::{create_pg_pool, run_migrations};
use safedeal_shared::DomainError;
use serde_json::Value;
use sha3::{Digest, Keccak256};
use sqlx::{Connection, PgConnection, PgPool};
use tempfile::TempDir;
use tokio::sync::{Mutex, MutexGuard, RwLock};
use tower::ServiceExt;

pub const DEFAULT_CONTRACT: &str = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const PG_TEST_ADVISORY_LOCK_ID: i64 = 948_271_625;

static IN_PROCESS_DB_MUTEX: Mutex<()> = Mutex::const_new(());

pub fn test_db_url() -> String {
    std::env::var("SAFEDEAL_TEST_DB_URL")
        .or_else(|_| std::env::var("TEST_DATABASE_URL"))
        .unwrap_or_else(|_| "postgres://safedeal:safedeal@127.0.0.1:5432/safedeal_test".to_string())
}

pub fn resolve_repo_root() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.to_path_buf())
}

pub struct DbTestGuard {
    _in_proc: MutexGuard<'static, ()>,
    _pg_lock_conn: PgConnection,
}

impl DbTestGuard {
    pub async fn acquire(db_url: &str) -> Self {
        let in_proc = IN_PROCESS_DB_MUTEX.lock().await;
        let mut pg_lock_conn = PgConnection::connect(db_url)
            .await
            .expect("Failed to connect to PostgreSQL test DB for advisory lock");
        sqlx::query("SELECT pg_advisory_lock($1)")
            .bind(PG_TEST_ADVISORY_LOCK_ID)
            .execute(&mut pg_lock_conn)
            .await
            .expect("Failed to acquire PG test advisory lock");
        Self {
            _in_proc: in_proc,
            _pg_lock_conn: pg_lock_conn,
        }
    }
}

pub async fn truncate_all_tables(pool: &PgPool) {
    sqlx::query(
        "TRUNCATE TABLE audit_logs, dispute_evidence, disputes, chain_events, blockchain_transactions, deal_events, deal_terms, deals, chain_sync_state, auth_nonces, users RESTART IDENTITY CASCADE",
    )
    .execute(pool)
    .await
    .expect("Failed to truncate test tables");
}

#[derive(Debug, Clone)]
pub struct MockGatewayState {
    pub enabled: bool,
    pub chain_id: i64,
    pub chain_name: String,
    pub contract_address: String,
    pub deployment_block: i64,
    pub confirmations_required: i32,
    pub sync_batch_size: i64,
    pub latest_block: i64,
    pub trades: HashMap<String, OnChainTradeSnapshot>,
    pub transactions: HashMap<String, TransactionVerificationResult>,
    pub logs: Vec<VerifiedChainEvent>,
    pub fetch_logs_calls: Vec<(i64, i64)>,
}

impl Default for MockGatewayState {
    fn default() -> Self {
        Self {
            enabled: true,
            chain_id: 31337,
            chain_name: "Anvil Local".to_string(),
            contract_address: DEFAULT_CONTRACT.to_string(),
            deployment_block: 0,
            confirmations_required: 1,
            sync_batch_size: 100,
            latest_block: 0,
            trades: HashMap::new(),
            transactions: HashMap::new(),
            logs: Vec::new(),
            fetch_logs_calls: Vec::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct MockBlockchainGateway {
    state: Arc<RwLock<MockGatewayState>>,
}

impl MockBlockchainGateway {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn update<F>(&self, f: F)
    where
        F: FnOnce(&mut MockGatewayState),
    {
        let mut guard = self.state.write().await;
        f(&mut guard);
    }

    pub async fn snapshot(&self) -> MockGatewayState {
        self.state.read().await.clone()
    }

    pub fn try_snapshot(&self) -> MockGatewayState {
        self.state.try_read().map(|g| g.clone()).unwrap_or_default()
    }
}

#[async_trait]
impl BlockchainGateway for MockBlockchainGateway {
    fn is_enabled(&self) -> bool {
        self.try_snapshot().enabled
    }

    fn chain_id(&self) -> i64 {
        self.try_snapshot().chain_id
    }

    fn chain_name(&self) -> &str {
        "Anvil Local"
    }

    fn contract_address(&self) -> &str {
        // Static default unless overridden for disabled/zero checks via dedicated fixed gateway
        DEFAULT_CONTRACT
    }

    fn deployment_block(&self) -> i64 {
        self.try_snapshot().deployment_block
    }

    fn confirmations_required(&self) -> i32 {
        self.try_snapshot().confirmations_required
    }

    fn sync_batch_size(&self) -> i64 {
        self.try_snapshot().sync_batch_size
    }

    async fn fetch_trade(
        &self,
        trade_id: &str,
    ) -> Result<Option<OnChainTradeSnapshot>, DomainError> {
        let guard = self.state.read().await;
        Ok(guard.trades.get(&trade_id.to_ascii_lowercase()).cloned())
    }

    async fn inspect_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<Option<TransactionVerificationResult>, DomainError> {
        let guard = self.state.read().await;
        Ok(guard
            .transactions
            .get(&tx_hash.to_ascii_lowercase())
            .cloned())
    }

    async fn fetch_latest_block_number(&self) -> Result<i64, DomainError> {
        Ok(self.state.read().await.latest_block)
    }

    async fn fetch_logs(
        &self,
        from_block: i64,
        to_block: i64,
    ) -> Result<Vec<VerifiedChainEvent>, DomainError> {
        let mut guard = self.state.write().await;
        guard.fetch_logs_calls.push((from_block, to_block));
        Ok(guard
            .logs
            .iter()
            .filter(|ev| ev.block_number >= from_block && ev.block_number <= to_block)
            .cloned()
            .collect())
    }
}

/// Configurable gateway with owned strings so health/readiness tests can test disabled or zero-address states.
pub struct ConfigurableStaticGateway {
    pub enabled: bool,
    pub chain_id: i64,
    pub chain_name: String,
    pub contract_address: String,
    pub deployment_block: i64,
    pub confirmations_required: i32,
    pub sync_batch_size: i64,
}

#[async_trait]
impl BlockchainGateway for ConfigurableStaticGateway {
    fn is_enabled(&self) -> bool {
        self.enabled
    }
    fn chain_id(&self) -> i64 {
        self.chain_id
    }
    fn chain_name(&self) -> &str {
        &self.chain_name
    }
    fn contract_address(&self) -> &str {
        &self.contract_address
    }
    fn deployment_block(&self) -> i64 {
        self.deployment_block
    }
    fn confirmations_required(&self) -> i32 {
        self.confirmations_required
    }
    fn sync_batch_size(&self) -> i64 {
        self.sync_batch_size
    }
    async fn fetch_trade(
        &self,
        _trade_id: &str,
    ) -> Result<Option<OnChainTradeSnapshot>, DomainError> {
        Ok(None)
    }
    async fn inspect_transaction(
        &self,
        _tx_hash: &str,
    ) -> Result<Option<TransactionVerificationResult>, DomainError> {
        Ok(None)
    }
    async fn fetch_latest_block_number(&self) -> Result<i64, DomainError> {
        Ok(0)
    }
    async fn fetch_logs(
        &self,
        _from_block: i64,
        _to_block: i64,
    ) -> Result<Vec<VerifiedChainEvent>, DomainError> {
        Ok(vec![])
    }
}

pub struct DynamicContractGateway {
    pub inner: MockBlockchainGateway,
    contract: RwLock<String>,
    cached_contract: std::sync::RwLock<String>,
}

impl DynamicContractGateway {
    pub fn new(inner: MockBlockchainGateway) -> Self {
        Self {
            inner,
            contract: RwLock::new(DEFAULT_CONTRACT.to_string()),
            cached_contract: std::sync::RwLock::new(DEFAULT_CONTRACT.to_string()),
        }
    }

    pub async fn set_contract(&self, addr: &str) {
        *self.contract.write().await = addr.to_ascii_lowercase();
        *self.cached_contract.write().expect("lock") = addr.to_ascii_lowercase();
    }
}

#[async_trait]
impl BlockchainGateway for DynamicContractGateway {
    fn is_enabled(&self) -> bool {
        self.inner.is_enabled()
    }
    fn chain_id(&self) -> i64 {
        self.inner.chain_id()
    }
    fn chain_name(&self) -> &str {
        self.inner.chain_name()
    }
    fn contract_address(&self) -> &str {
        let is_zero = self
            .cached_contract
            .read()
            .map(|c| c.as_str() == "0x0000000000000000000000000000000000000000")
            .unwrap_or(false);
        if is_zero {
            "0x0000000000000000000000000000000000000000"
        } else {
            DEFAULT_CONTRACT
        }
    }
    fn deployment_block(&self) -> i64 {
        self.inner.deployment_block()
    }
    fn confirmations_required(&self) -> i32 {
        self.inner.confirmations_required()
    }
    fn sync_batch_size(&self) -> i64 {
        self.inner.sync_batch_size()
    }
    async fn fetch_trade(
        &self,
        trade_id: &str,
    ) -> Result<Option<OnChainTradeSnapshot>, DomainError> {
        self.inner.fetch_trade(trade_id).await
    }
    async fn inspect_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<Option<TransactionVerificationResult>, DomainError> {
        self.inner.inspect_transaction(tx_hash).await
    }
    async fn fetch_latest_block_number(&self) -> Result<i64, DomainError> {
        self.inner.fetch_latest_block_number().await
    }
    async fn fetch_logs(
        &self,
        from_block: i64,
        to_block: i64,
    ) -> Result<Vec<VerifiedChainEvent>, DomainError> {
        self.inner.fetch_logs(from_block, to_block).await
    }
}

pub struct TestWallet {
    signing_key: SigningKey,
    pub address: String,
}

impl TestWallet {
    pub fn random() -> Self {
        let signing_key = SigningKey::random(&mut OsRng);
        let address = derive_eth_address(&signing_key);
        Self {
            signing_key,
            address,
        }
    }

    pub fn sign_personal(&self, message: &str) -> String {
        let msg_bytes = message.as_bytes();
        let mut hasher = Keccak256::new();
        hasher.update(b"\x19Ethereum Signed Message:\n");
        hasher.update(msg_bytes.len().to_string().as_bytes());
        hasher.update(msg_bytes);
        let digest = hasher.finalize();

        let (sig, rec_id) = self
            .signing_key
            .sign_prehash_recoverable(&digest)
            .expect("Failed to sign EIP-191 personal message");
        let mut all = [0u8; 65];
        all[..64].copy_from_slice(&sig.to_bytes());
        all[64] = rec_id.to_byte() + 27;
        format!("0x{}", hex::encode(all))
    }
}

fn derive_eth_address(key: &SigningKey) -> String {
    let vk = key.verifying_key();
    let encoded = vk.to_encoded_point(false);
    let digest = Keccak256::digest(&encoded.as_bytes()[1..]);
    format!("0x{}", hex::encode(&digest[12..]))
}

pub fn build_test_config(
    db_url: &str,
    evidence_dir: &Path,
    overrides: &[(&str, &str)],
) -> AppConfig {
    let mut vars = HashMap::new();
    vars.insert("APP_ENV".to_string(), "test".to_string());
    vars.insert("DB_URL".to_string(), db_url.to_string());
    vars.insert(
        "JWT_SECRET".to_string(),
        "test-only-hmac-signing-key-at-least-32-chars-0123456789abcdef".to_string(),
    );
    vars.insert("BLOCKCHAIN_SYNC_ENABLED".to_string(), "true".to_string());
    vars.insert("CHAIN_ID".to_string(), "31337".to_string());
    vars.insert("CHAIN_NAME".to_string(), "Anvil Local".to_string());
    vars.insert(
        "AVALANCHE_RPC_URL".to_string(),
        "http://127.0.0.1:8545".to_string(),
    );
    vars.insert(
        "ESCROW_CONTRACT_ADDRESS".to_string(),
        DEFAULT_CONTRACT.to_string(),
    );
    vars.insert("SIWE_DOMAIN".to_string(), "localhost:5173".to_string());
    vars.insert("SIWE_URI".to_string(), "http://localhost:5173".to_string());
    vars.insert(
        "CORS_ALLOWED_ORIGINS".to_string(),
        "http://localhost:5173".to_string(),
    );
    vars.insert(
        "EVIDENCE_STORAGE_DIR".to_string(),
        evidence_dir.to_string_lossy().to_string(),
    );
    vars.insert("RATE_LIMIT_ENABLED".to_string(), "false".to_string());
    vars.insert("API_DOCS_ENABLED".to_string(), "true".to_string());
    vars.insert("SWAGGER_UI_ENABLED".to_string(), "false".to_string());

    for (k, v) in overrides {
        vars.insert((*k).to_string(), (*v).to_string());
    }

    AppConfig::from_map(&vars).expect("Invalid test AppConfig")
}

pub struct TestAppHarness {
    _guard: DbTestGuard,
    pub _evidence_dir: TempDir,
    pub pool: PgPool,
    pub config: AppConfig,
    pub gateway: Arc<DynamicContractGateway>,
    pub components: ApplicationComponents,
}

impl TestAppHarness {
    pub async fn start() -> Self {
        Self::start_with_overrides(&[]).await
    }

    pub async fn start_with_overrides(overrides: &[(&str, &str)]) -> Self {
        let db_url = test_db_url();
        let guard = DbTestGuard::acquire(&db_url).await;
        let evidence_dir = TempDir::new().expect("temp evidence dir");
        let config = build_test_config(&db_url, evidence_dir.path(), overrides);
        let pool = create_pg_pool(&config.database)
            .await
            .expect("Failed to create PG test pool");
        run_migrations(&pool)
            .await
            .expect("Failed to run SQLx migrations");
        truncate_all_tables(&pool).await;

        let mock_inner = MockBlockchainGateway::new();
        let gateway = Arc::new(DynamicContractGateway::new(mock_inner));
        let gw_dyn: Arc<dyn BlockchainGateway> = Arc::clone(&gateway) as Arc<dyn BlockchainGateway>;
        let components =
            assemble_application(&config, pool.clone(), gw_dyn).expect("assemble application");

        Self {
            _guard: guard,
            _evidence_dir: evidence_dir,
            pool,
            config,
            gateway,
            components,
        }
    }

    pub fn app(&self) -> Router {
        self.components.router.clone()
    }

    pub async fn login_wallet(&self, wallet: &TestWallet) -> ActorSession {
        let nonce_res = send_request(
            self.app(),
            Method::POST,
            "/api/v1/auth/nonce",
            &[],
            None,
            Some("application/json"),
            Some(
                serde_json::json!({
                    "address": wallet.address,
                    "chainId": 31337
                })
                .to_string()
                .into_bytes(),
            ),
        )
        .await;
        assert_eq!(nonce_res.status, StatusCode::OK);
        let nonce_json = nonce_res.json();
        let message = nonce_json["message"].as_str().expect("SIWE message");
        let signature = wallet.sign_personal(message);

        let verify_res = send_request(
            self.app(),
            Method::POST,
            "/api/v1/auth/verify",
            &[],
            None,
            Some("application/json"),
            Some(
                serde_json::json!({
                    "message": message,
                    "signature": signature
                })
                .to_string()
                .into_bytes(),
            ),
        )
        .await;
        assert_eq!(verify_res.status, StatusCode::OK);

        let session_cookie = extract_set_cookie_value(&verify_res.headers, "safedeal_session")
            .expect("missing safedeal_session cookie");
        let csrf_cookie = extract_set_cookie_value(&verify_res.headers, "safedeal_csrf")
            .expect("missing safedeal_csrf cookie");
        ActorSession {
            address: wallet.address.clone(),
            session_cookie,
            csrf_cookie,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ActorSession {
    pub address: String,
    pub session_cookie: String,
    pub csrf_cookie: String,
}

impl ActorSession {
    pub fn cookie_header(&self) -> String {
        format!(
            "safedeal_session={}; safedeal_csrf={}",
            self.session_cookie, self.csrf_cookie
        )
    }

    pub async fn get(&self, router: Router, uri: &str) -> HttpResult {
        send_request(
            router,
            Method::GET,
            uri,
            &[(header::COOKIE.as_str(), &self.cookie_header())],
            None,
            None,
            None,
        )
        .await
    }

    pub async fn post_json(&self, router: Router, uri: &str, body: Value) -> HttpResult {
        send_request(
            router,
            Method::POST,
            uri,
            &[
                (header::COOKIE.as_str(), &self.cookie_header()),
                ("X-CSRF-Token", &self.csrf_cookie),
            ],
            None,
            Some("application/json"),
            Some(body.to_string().into_bytes()),
        )
        .await
    }

    pub async fn post_json_without_csrf(
        &self,
        router: Router,
        uri: &str,
        body: Value,
    ) -> HttpResult {
        send_request(
            router,
            Method::POST,
            uri,
            &[(header::COOKIE.as_str(), &self.cookie_header())],
            None,
            Some("application/json"),
            Some(body.to_string().into_bytes()),
        )
        .await
    }

    pub async fn post_multipart(
        &self,
        router: Router,
        uri: &str,
        boundary: &str,
        body: Vec<u8>,
    ) -> HttpResult {
        let ct = format!("multipart/form-data; boundary={boundary}");
        send_request(
            router,
            Method::POST,
            uri,
            &[
                (header::COOKIE.as_str(), &self.cookie_header()),
                ("X-CSRF-Token", &self.csrf_cookie),
            ],
            None,
            Some(&ct),
            Some(body),
        )
        .await
    }
}

pub struct HttpResult {
    pub status: StatusCode,
    pub headers: axum::http::HeaderMap,
    pub body: Vec<u8>,
}

impl HttpResult {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }

    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body)
            .unwrap_or_else(|e| panic!("Expected JSON body, got '{}' ({e})", self.text()))
    }
}

pub async fn send_request(
    router: Router,
    method: Method,
    uri: &str,
    extra_headers: &[(&str, &str)],
    peer_ip: Option<IpAddr>,
    content_type: Option<&str>,
    body_bytes: Option<Vec<u8>>,
) -> HttpResult {
    let ip = peer_ip.unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    let router = router.layer(MockConnectInfo(SocketAddr::new(ip, 44444)));
    let mut builder = Request::builder().method(method).uri(uri);
    for (k, v) in extra_headers {
        builder = builder.header(*k, *v);
    }
    if let Some(ct) = content_type {
        builder = builder.header(header::CONTENT_TYPE, ct);
    }
    let req = builder
        .body(match body_bytes {
            Some(b) => Body::from(b),
            None => Body::empty(),
        })
        .expect("build request");

    let response: Response<Body> = router.oneshot(req).await.expect("oneshot failed");
    let status = response.status();
    let headers = response.headers().clone();
    let collected = response
        .into_body()
        .collect()
        .await
        .expect("read body")
        .to_bytes()
        .to_vec();
    HttpResult {
        status,
        headers,
        body: collected,
    }
}

pub fn extract_set_cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    find_set_cookie_header(headers, name).and_then(|raw| {
        let first = raw.split(';').next()?;
        let (k, v) = first.split_once('=')?;
        if k.trim() == name {
            Some(v.trim().to_string())
        } else {
            None
        }
    })
}

pub fn find_set_cookie_header(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    for hv in headers.get_all(header::SET_COOKIE) {
        if let Ok(s) = hv.to_str() {
            if s.trim_start().starts_with(&prefix) {
                return Some(s.to_string());
            }
        }
    }
    None
}

pub fn build_multipart_file_body(
    boundary: &str,
    fields: &[(&str, &str)],
    file_part: Option<(&str, &str, &str, &[u8])>,
) -> Vec<u8> {
    let mut buf = Vec::new();
    for (name, value) in fields {
        buf.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        buf.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                .as_bytes(),
        );
    }
    if let Some((part_name, filename, content_type, data)) = file_part {
        buf.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        buf.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"{part_name}\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n"
            )
            .as_bytes(),
        );
        buf.extend_from_slice(data);
        buf.extend_from_slice(b"\r\n");
    }
    buf.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    buf
}
