use std::any::Any;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use safedeal_domain::auth::{AuthNonce, RevokedSession, UserAccount};
use safedeal_domain::blockchain::{
    ChainSyncState, OnChainTradeSnapshot, TransactionVerificationResult, VerifiedChainEvent,
};
use safedeal_domain::deal::{BlockchainTransaction, Deal, DealEvent, DealStatus};
use safedeal_domain::dispute::{
    compute_audit_entry_hash, AuditLogEntry, ChainedAuditLogEntry, Dispute, DisputeEvidence,
    DisputeVote, AUDIT_GENESIS_HASH,
};
use safedeal_domain::ports::{
    AuditLogRepository, AuthNonceRepository, BlockchainGateway, BlockchainTransactionRepository,
    ChainEventRepository, ChainSyncStateRepository, DealEventRepository, DealRepository,
    DisputeEvidenceRepository, DisputeRepository, DisputeVoteRepository, EvidenceDownloadPayload,
    EvidenceStoragePort, PageSlice, RevokedSessionRepository, StoredAttachment, TxRepos, TxWorkFn,
    UnitOfWork, UserRepository,
};
use safedeal_shared::DomainError;

pub const TEST_CONTRACT: &str = "0xf30e863b0cfe8fbfe05e65c21878f8b621b3fe29";

#[derive(Default)]
pub struct InMemoryState {
    pub deals: Vec<Deal>,
    pub disputes: Vec<Dispute>,
    pub dispute_votes: Vec<DisputeVote>,
    pub auth_nonces: Vec<AuthNonce>,
    pub revoked_sessions: Vec<RevokedSession>,
    pub users: Vec<UserAccount>,
    pub deal_events: Vec<DealEvent>,
    pub chain_events: Vec<VerifiedChainEvent>,
    pub blockchain_transactions: Vec<BlockchainTransaction>,
    pub dispute_evidence: Vec<DisputeEvidence>,
    pub audit_logs: Vec<AuditLogEntry>,
    pub chained_audit_logs: Vec<ChainedAuditLogEntry>,
    pub chain_sync_state: Option<ChainSyncState>,
    pub next_id: i64,
}

impl InMemoryState {
    fn alloc_id(&mut self) -> i64 {
        self.next_id += 1;
        self.next_id
    }
}

#[derive(Clone, Default)]
pub struct InMemoryStore {
    pub state: Arc<Mutex<InMemoryState>>,
}

impl InMemoryStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
}

impl TxRepos for InMemoryStore {
    fn deals(&self) -> &dyn DealRepository {
        self
    }
    fn disputes(&self) -> &dyn DisputeRepository {
        self
    }
    fn dispute_votes(&self) -> &dyn DisputeVoteRepository {
        self
    }
    fn auth_nonces(&self) -> &dyn AuthNonceRepository {
        self
    }
    fn revoked_sessions(&self) -> &dyn RevokedSessionRepository {
        self
    }
    fn users(&self) -> &dyn UserRepository {
        self
    }
    fn deal_events(&self) -> &dyn DealEventRepository {
        self
    }
    fn chain_events(&self) -> &dyn ChainEventRepository {
        self
    }
    fn blockchain_transactions(&self) -> &dyn BlockchainTransactionRepository {
        self
    }
    fn dispute_evidence(&self) -> &dyn DisputeEvidenceRepository {
        self
    }
    fn audit_logs(&self) -> &dyn AuditLogRepository {
        self
    }
    fn chain_sync_states(&self) -> &dyn ChainSyncStateRepository {
        self
    }
}

#[async_trait]
impl UnitOfWork for InMemoryStore {
    async fn execute_boxed<'env>(
        &self,
        work: TxWorkFn<'env>,
    ) -> Result<Box<dyn Any + Send>, DomainError> {
        work.call_tx(self).await
    }
}

#[async_trait]
impl DealRepository for InMemoryStore {
    async fn save(&self, deal: &Deal) -> Result<Deal, DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = deal.clone();
        saved.trade_id = saved.trade_id.to_ascii_lowercase();
        saved.seller = saved.seller.to_ascii_lowercase();
        saved.buyer = saved.buyer.map(|b| b.to_ascii_lowercase());
        saved.arbiter = saved.arbiter.to_ascii_lowercase();
        if let Some(pos) = s
            .deals
            .iter()
            .position(|d| d.trade_id.eq_ignore_ascii_case(&saved.trade_id))
        {
            if saved.id.is_none() {
                saved.id = s.deals[pos].id;
            }
            s.deals[pos] = saved.clone();
        } else {
            if saved.id.is_none() {
                saved.id = Some(s.alloc_id());
            }
            s.deals.push(saved.clone());
        }
        Ok(saved)
    }

    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Deal>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.deals
            .iter()
            .find(|d| d.trade_id.eq_ignore_ascii_case(trade_id))
            .cloned())
    }

    async fn find_by_trade_ids(&self, trade_ids: &[String]) -> Result<Vec<Deal>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.deals
            .iter()
            .filter(|d| {
                trade_ids
                    .iter()
                    .any(|t| t.eq_ignore_ascii_case(&d.trade_id))
            })
            .cloned()
            .collect())
    }

    async fn find_by_trade_id_for_update(
        &self,
        trade_id: &str,
    ) -> Result<Option<Deal>, DomainError> {
        DealRepository::find_by_trade_id(self, trade_id).await
    }

    async fn find_by_create_tx_hash(
        &self,
        create_tx_hash: &str,
    ) -> Result<Option<Deal>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.deals
            .iter()
            .find(|d| {
                d.create_tx_hash
                    .as_deref()
                    .is_some_and(|h| h.eq_ignore_ascii_case(create_tx_hash))
            })
            .cloned())
    }

    async fn exists_by_create_tx_hash(&self, create_tx_hash: &str) -> Result<bool, DomainError> {
        Ok(self.find_by_create_tx_hash(create_tx_hash).await?.is_some())
    }

    async fn find_user_deals(
        &self,
        _wallet_address: &str,
        _role: Option<&str>,
        _status_filter: Option<DealStatus>,
        page: i32,
        size: i32,
    ) -> Result<PageSlice, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(PageSlice {
            items: s.deals.clone(),
            page,
            size,
            total_items: s.deals.len() as i64,
            total_pages: 1,
        })
    }

    async fn find_open_bound_deals(&self) -> Result<Vec<Deal>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.deals
            .iter()
            .filter(|d| d.on_chain_bound && !d.settled)
            .cloned()
            .collect())
    }

    async fn purge_expired_drafts(&self, cutoff: DateTime<Utc>) -> Result<u64, DomainError> {
        let mut s = self.state.lock().unwrap();
        let before = s.deals.len();
        s.deals.retain(|d| {
            !(d.status == DealStatus::Draft && !d.on_chain_bound && d.updated_at < cutoff)
        });
        Ok((before - s.deals.len()) as u64)
    }
}

#[async_trait]
impl DisputeRepository for InMemoryStore {
    async fn save(&self, dispute: &Dispute) -> Result<Dispute, DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = dispute.clone();
        saved.trade_id = saved.trade_id.to_ascii_lowercase();
        saved.opened_by = saved.opened_by.to_ascii_lowercase();
        if let Some(pos) = s.disputes.iter().position(|d| {
            (saved.id.is_some() && d.id == saved.id)
                || d.trade_id.eq_ignore_ascii_case(&saved.trade_id)
        }) {
            if saved.id.is_none() {
                saved.id = s.disputes[pos].id;
            }
            s.disputes[pos] = saved.clone();
        } else {
            if saved.id.is_none() {
                saved.id = Some(s.alloc_id());
            }
            s.disputes.push(saved.clone());
        }
        Ok(saved)
    }

    async fn find_by_id(&self, id: i64) -> Result<Option<Dispute>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.disputes.iter().find(|d| d.id == Some(id)).cloned())
    }

    async fn find_by_trade_id(&self, trade_id: &str) -> Result<Option<Dispute>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.disputes
            .iter()
            .find(|d| d.trade_id.eq_ignore_ascii_case(trade_id))
            .cloned())
    }

    async fn find_dispute_ids_by_trade_ids(
        &self,
        trade_ids: &[String],
    ) -> Result<HashMap<String, i64>, DomainError> {
        let s = self.state.lock().unwrap();
        let mut map = HashMap::new();
        for d in &s.disputes {
            if let Some(id) = d.id {
                if trade_ids
                    .iter()
                    .any(|t| t.eq_ignore_ascii_case(&d.trade_id))
                {
                    map.insert(d.trade_id.clone(), id);
                }
            }
        }
        Ok(map)
    }

    async fn find_assigned_to_arbiter(
        &self,
        _arbiter_address: &str,
    ) -> Result<Vec<Dispute>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.disputes.clone())
    }
}

#[async_trait]
impl DisputeVoteRepository for InMemoryStore {
    async fn upsert_vote(&self, vote: &DisputeVote) -> Result<DisputeVote, DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = vote.clone();
        saved.voter_address = saved.voter_address.to_ascii_lowercase();
        if let Some(pos) = s.dispute_votes.iter().position(|v| {
            v.dispute_id == saved.dispute_id
                && v.voter_address.eq_ignore_ascii_case(&saved.voter_address)
        }) {
            saved.id = s.dispute_votes[pos].id;
            s.dispute_votes[pos] = saved.clone();
        } else {
            saved.id = Some(s.alloc_id());
            s.dispute_votes.push(saved.clone());
        }
        Ok(saved)
    }

    async fn find_by_dispute_id(&self, dispute_id: i64) -> Result<Vec<DisputeVote>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.dispute_votes
            .iter()
            .filter(|v| v.dispute_id == dispute_id)
            .cloned()
            .collect())
    }

    async fn find_by_dispute_ids(
        &self,
        dispute_ids: &[i64],
    ) -> Result<HashMap<i64, Vec<DisputeVote>>, DomainError> {
        let s = self.state.lock().unwrap();
        let mut out: HashMap<i64, Vec<DisputeVote>> = HashMap::new();
        for v in &s.dispute_votes {
            if dispute_ids.contains(&v.dispute_id) {
                out.entry(v.dispute_id).or_default().push(v.clone());
            }
        }
        Ok(out)
    }
}

#[async_trait]
impl AuthNonceRepository for InMemoryStore {
    async fn save(&self, nonce: &AuthNonce) -> Result<AuthNonce, DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = nonce.clone();
        if saved.id.is_none() {
            saved.id = Some(s.alloc_id());
        }
        s.auth_nonces.push(saved.clone());
        Ok(saved)
    }

    async fn find_by_nonce(&self, nonce: &str) -> Result<Option<AuthNonce>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.auth_nonces.iter().find(|n| n.nonce == nonce).cloned())
    }

    async fn consume_once(
        &self,
        nonce: &str,
        wallet_address: &str,
        chain_id: i64,
        now: DateTime<Utc>,
    ) -> Result<bool, DomainError> {
        let mut s = self.state.lock().unwrap();
        if let Some(found) = s.auth_nonces.iter_mut().find(|n| {
            n.nonce == nonce
                && n.wallet_address.eq_ignore_ascii_case(wallet_address)
                && n.chain_id == chain_id
                && n.consumed_at.is_none()
                && n.expires_at > now
        }) {
            found.consumed_at = Some(now);
            return Ok(true);
        }
        Ok(false)
    }

    async fn delete_expired_before(&self, cutoff: DateTime<Utc>) -> Result<u64, DomainError> {
        let mut s = self.state.lock().unwrap();
        let before = s.auth_nonces.len();
        s.auth_nonces.retain(|n| n.expires_at >= cutoff);
        Ok((before - s.auth_nonces.len()) as u64)
    }
}

#[async_trait]
impl UserRepository for InMemoryStore {
    async fn upsert_login(
        &self,
        wallet_address: &str,
        login_at: DateTime<Utc>,
    ) -> Result<UserAccount, DomainError> {
        let mut s = self.state.lock().unwrap();
        let addr = wallet_address.to_ascii_lowercase();
        if let Some(u) = s
            .users
            .iter_mut()
            .find(|u| u.wallet_address.eq_ignore_ascii_case(&addr))
        {
            u.last_login_at = login_at;
            return Ok(u.clone());
        }
        let user = UserAccount {
            id: Some(s.alloc_id()),
            wallet_address: addr,
            created_at: login_at,
            last_login_at: login_at,
        };
        s.users.push(user.clone());
        Ok(user)
    }

    async fn find_by_wallet_address(
        &self,
        wallet_address: &str,
    ) -> Result<Option<UserAccount>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.users
            .iter()
            .find(|u| u.wallet_address.eq_ignore_ascii_case(wallet_address))
            .cloned())
    }
}

#[async_trait]
impl DealEventRepository for InMemoryStore {
    async fn save_if_absent(&self, event: &DealEvent) -> Result<bool, DomainError> {
        let mut s = self.state.lock().unwrap();
        if event.tx_hash.is_some()
            && event.log_index.is_some()
            && s.deal_events
                .iter()
                .any(|e| e.tx_hash == event.tx_hash && e.log_index == event.log_index)
        {
            return Ok(false);
        }
        let mut saved = event.clone();
        saved.id = Some(s.alloc_id());
        s.deal_events.push(saved);
        Ok(true)
    }

    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<DealEvent>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.deal_events
            .iter()
            .filter(|e| e.trade_id.eq_ignore_ascii_case(trade_id))
            .cloned()
            .collect())
    }
}

#[async_trait]
impl ChainEventRepository for InMemoryStore {
    async fn record_if_absent(&self, event: &VerifiedChainEvent) -> Result<bool, DomainError> {
        let mut s = self.state.lock().unwrap();
        if s.chain_events.iter().any(|e| {
            e.tx_hash.eq_ignore_ascii_case(&event.tx_hash) && e.log_index == event.log_index
        }) {
            return Ok(false);
        }
        s.chain_events.push(event.clone());
        Ok(true)
    }
}

#[async_trait]
impl BlockchainTransactionRepository for InMemoryStore {
    async fn save_or_update(
        &self,
        transaction: &BlockchainTransaction,
    ) -> Result<BlockchainTransaction, DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = transaction.clone();
        if let Some(pos) = s
            .blockchain_transactions
            .iter()
            .position(|t| t.tx_hash.eq_ignore_ascii_case(&saved.tx_hash))
        {
            saved.id = s.blockchain_transactions[pos].id;
            s.blockchain_transactions[pos] = saved.clone();
        } else {
            saved.id = Some(s.alloc_id());
            s.blockchain_transactions.push(saved.clone());
        }
        Ok(saved)
    }

    async fn find_by_tx_hash(
        &self,
        tx_hash: &str,
    ) -> Result<Option<BlockchainTransaction>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.blockchain_transactions
            .iter()
            .find(|t| t.tx_hash.eq_ignore_ascii_case(tx_hash))
            .cloned())
    }

    async fn find_by_trade_id_order_by_created_at_asc(
        &self,
        trade_id: &str,
    ) -> Result<Vec<BlockchainTransaction>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.blockchain_transactions
            .iter()
            .filter(|t| t.trade_id.eq_ignore_ascii_case(trade_id))
            .cloned()
            .collect())
    }
}

#[async_trait]
impl DisputeEvidenceRepository for InMemoryStore {
    async fn save(&self, evidence: &DisputeEvidence) -> Result<DisputeEvidence, DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = evidence.clone();
        if saved.id.is_none() {
            saved.id = Some(s.alloc_id());
        }
        s.dispute_evidence.push(saved.clone());
        Ok(saved)
    }

    async fn find_by_dispute_id_order_by_created_at_asc(
        &self,
        dispute_id: i64,
    ) -> Result<Vec<DisputeEvidence>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.dispute_evidence
            .iter()
            .filter(|e| e.dispute_id == dispute_id)
            .cloned()
            .collect())
    }

    async fn find_by_id_and_dispute_id(
        &self,
        evidence_id: i64,
        dispute_id: i64,
    ) -> Result<Option<DisputeEvidence>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.dispute_evidence
            .iter()
            .find(|e| e.id == Some(evidence_id) && e.dispute_id == dispute_id)
            .cloned())
    }
}

#[async_trait]
impl RevokedSessionRepository for InMemoryStore {
    async fn revoke(&self, session: &RevokedSession) -> Result<(), DomainError> {
        let mut s = self.state.lock().unwrap();
        if !s.revoked_sessions.iter().any(|r| r.jti == session.jti) {
            let mut saved = session.clone();
            saved.wallet_address = saved.wallet_address.to_ascii_lowercase();
            s.revoked_sessions.push(saved);
        }
        Ok(())
    }

    async fn is_revoked(&self, jti: &str, now: DateTime<Utc>) -> Result<bool, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.revoked_sessions
            .iter()
            .any(|r| r.jti == jti && r.expires_at > now))
    }

    async fn delete_expired_before(&self, cutoff: DateTime<Utc>) -> Result<u64, DomainError> {
        let mut s = self.state.lock().unwrap();
        let before = s.revoked_sessions.len();
        s.revoked_sessions.retain(|r| r.expires_at >= cutoff);
        Ok((before - s.revoked_sessions.len()) as u64)
    }
}

#[async_trait]
impl AuditLogRepository for InMemoryStore {
    async fn append(&self, entry: &AuditLogEntry) -> Result<(), DomainError> {
        let mut s = self.state.lock().unwrap();
        let mut saved = entry.clone();
        saved.id = Some(s.alloc_id());
        saved.actor_address = saved.actor_address.as_deref().map(str::to_ascii_lowercase);
        let prev_hash = s
            .chained_audit_logs
            .last()
            .map(|c| c.entry_hash.clone())
            .unwrap_or_else(|| AUDIT_GENESIS_HASH.to_string());
        let entry_hash = compute_audit_entry_hash(&prev_hash, &saved);
        s.audit_logs.push(saved.clone());
        s.chained_audit_logs.push(ChainedAuditLogEntry {
            entry: saved,
            prev_hash,
            entry_hash,
        });
        Ok(())
    }

    async fn list_all(&self) -> Result<Vec<ChainedAuditLogEntry>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.chained_audit_logs.clone())
    }
}

#[async_trait]
impl ChainSyncStateRepository for InMemoryStore {
    async fn find_primary(&self) -> Result<Option<ChainSyncState>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.chain_sync_state.clone())
    }

    async fn save(&self, state: &ChainSyncState) -> Result<ChainSyncState, DomainError> {
        let mut s = self.state.lock().unwrap();
        s.chain_sync_state = Some(state.clone());
        Ok(state.clone())
    }
}

#[derive(Default)]
pub struct FakeGatewayState {
    pub enabled: bool,
    pub latest_block: i64,
    pub trades: HashMap<String, OnChainTradeSnapshot>,
    pub transactions: HashMap<String, TransactionVerificationResult>,
    pub logs: Vec<VerifiedChainEvent>,
}

#[derive(Clone)]
pub struct FakeBlockchainGateway {
    pub state: Arc<Mutex<FakeGatewayState>>,
}

impl FakeBlockchainGateway {
    pub fn new(enabled: bool) -> Arc<Self> {
        Arc::new(Self {
            state: Arc::new(Mutex::new(FakeGatewayState {
                enabled,
                latest_block: 100,
                trades: HashMap::new(),
                transactions: HashMap::new(),
                logs: Vec::new(),
            })),
        })
    }
}

#[async_trait]
impl BlockchainGateway for FakeBlockchainGateway {
    fn is_enabled(&self) -> bool {
        self.state.lock().unwrap().enabled
    }
    fn chain_id(&self) -> i64 {
        43113
    }
    fn chain_name(&self) -> &str {
        "Avalanche Fuji C-Chain"
    }
    fn contract_address(&self) -> &str {
        TEST_CONTRACT
    }
    fn deployment_block(&self) -> i64 {
        1
    }
    fn confirmations_required(&self) -> i32 {
        1
    }
    fn sync_batch_size(&self) -> i64 {
        100
    }
    async fn fetch_trade(
        &self,
        trade_id: &str,
    ) -> Result<Option<OnChainTradeSnapshot>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.trades.get(&trade_id.to_ascii_lowercase()).cloned())
    }
    async fn inspect_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<Option<TransactionVerificationResult>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.transactions.get(&tx_hash.to_ascii_lowercase()).cloned())
    }
    async fn fetch_latest_block_number(&self) -> Result<i64, DomainError> {
        Ok(self.state.lock().unwrap().latest_block)
    }
    async fn fetch_logs(
        &self,
        from_block: i64,
        to_block: i64,
    ) -> Result<Vec<VerifiedChainEvent>, DomainError> {
        let s = self.state.lock().unwrap();
        Ok(s.logs
            .iter()
            .filter(|e| e.block_number >= from_block && e.block_number <= to_block)
            .cloned()
            .collect())
    }
}

#[derive(Default)]
pub struct FakeEvidenceStorage {
    pub files: Mutex<HashMap<String, Vec<u8>>>,
    pub return_local_file_payload: bool,
}

impl FakeEvidenceStorage {
    pub fn new(return_local_file_payload: bool) -> Arc<Self> {
        Arc::new(Self {
            files: Mutex::new(HashMap::new()),
            return_local_file_payload,
        })
    }
}

#[async_trait]
impl EvidenceStoragePort for FakeEvidenceStorage {
    async fn store(
        &self,
        dispute_id: i64,
        original_filename: &str,
        declared_mime_type: Option<&str>,
        bytes: &[u8],
    ) -> Result<StoredAttachment, DomainError> {
        let key = format!("{dispute_id}/{original_filename}");
        self.files
            .lock()
            .unwrap()
            .insert(key.clone(), bytes.to_vec());
        Ok(StoredAttachment {
            sanitized_file_name: original_filename.to_string(),
            mime_type: declared_mime_type.unwrap_or("text/plain").to_string(),
            size_bytes: bytes.len() as i64,
            sha256_hex: String::new(),
            storage_key: key,
        })
    }

    async fn load(&self, storage_key: &str) -> Result<Vec<u8>, DomainError> {
        self.files
            .lock()
            .unwrap()
            .get(storage_key)
            .cloned()
            .ok_or_else(|| DomainError::not_found("Evidence file missing from storage."))
    }

    async fn open_download(
        &self,
        storage_key: &str,
    ) -> Result<EvidenceDownloadPayload, DomainError> {
        if self.return_local_file_payload {
            Ok(EvidenceDownloadPayload::LocalFile(PathBuf::from(
                storage_key,
            )))
        } else {
            let bytes = self.load(storage_key).await?;
            Ok(EvidenceDownloadPayload::Bytes(bytes))
        }
    }

    async fn delete_best_effort(&self, storage_key: &str) {
        self.files.lock().unwrap().remove(storage_key);
    }

    async fn is_storage_ready(&self) -> bool {
        true
    }
}

pub fn sample_bound_deal(trade_id: &str, status: DealStatus) -> Deal {
    let now = Utc::now();
    Deal {
        id: Some(1),
        trade_id: trade_id.to_ascii_lowercase(),
        chain_id: 43113,
        contract_address: TEST_CONTRACT.to_string(),
        seller: "0x1111111111111111111111111111111111111111".to_string(),
        buyer: Some("0x2222222222222222222222222222222222222222".to_string()),
        arbiter: "0x3333333333333333333333333333333333333333".to_string(),
        amount_wei: "2000000000000000000".to_string(),
        terms_hash: format!("0x{}", "a".repeat(64)),
        funding_deadline: DateTime::from_timestamp(now.timestamp() + 3600, 0).unwrap(),
        delivery_deadline: DateTime::from_timestamp(now.timestamp() + 7200, 0).unwrap(),
        inspection_window_seconds: 86_400,
        delivered_at: None,
        funded_at: Some(now),
        status,
        on_chain_bound: true,
        settled: status.is_settled(),
        create_tx_hash: Some(format!("0x{}", "c".repeat(64))),
        buyer_award_wei: None,
        seller_award_wei: None,
        title: "SEApp UIT Escrow Deal".to_string(),
        description: "Test escrow deal for SEApp UIT verification".to_string(),
        terms: "Standard milestone acceptance terms".to_string(),
        canonical_terms_json: "{}".to_string(),
        schema_version: 1,
        created_at: now,
        updated_at: now,
    }
}
