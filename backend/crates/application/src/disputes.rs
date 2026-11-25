use std::sync::Arc;

use chrono::{DateTime, Utc};
use safedeal_domain::blockchain::OnChainEventType;
use safedeal_domain::deal::{Deal, DealStatus};
use safedeal_domain::dispute::{
    AuditLogEntry, Dispute, DisputeEvidence, DisputeStatus, DisputeVote,
    DEFAULT_DISPUTE_TIMEOUT_SECONDS,
};
use safedeal_domain::ports::{
    in_tx, AuditLogRepository, BlockchainGateway, DisputeEvidenceRepository,
    EvidenceDownloadPayload, EvidenceStoragePort, UnitOfWork,
};
use safedeal_shared::{CorrelationIdContext, DomainError, EthFormatValidator};

use crate::deals::SyncDealUseCase;
use crate::indexer::AUTO_INDEXED_DISPUTE_REASON;

#[derive(Debug, Clone)]
pub struct DisputeWithDeal {
    pub dispute: Dispute,
    pub deal: Deal,
    pub votes: Vec<DisputeVote>,
}

#[derive(Debug, Clone)]
pub struct EvidenceDownloadTarget {
    pub metadata: DisputeEvidence,
    pub payload: EvidenceDownloadPayload,
}

#[derive(Debug, Clone)]
pub struct UploadEvidenceCommand<'a> {
    pub dispute_id: i64,
    pub caller_address: &'a str,
    pub title: &'a str,
    pub notes: &'a str,
    pub original_filename: Option<&'a str>,
    pub declared_mime_type: Option<&'a str>,
    pub file_bytes: Option<&'a [u8]>,
}

pub struct DisputeUseCase {
    uow: Arc<dyn UnitOfWork>,
    evidence_repo: Arc<dyn DisputeEvidenceRepository>,
    audit_log_repo: Arc<dyn AuditLogRepository>,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
    sync_deal_use_case: Arc<SyncDealUseCase>,
    evidence_storage: Arc<dyn EvidenceStoragePort>,
}

impl DisputeUseCase {
    pub fn new(
        uow: Arc<dyn UnitOfWork>,
        evidence_repo: Arc<dyn DisputeEvidenceRepository>,
        audit_log_repo: Arc<dyn AuditLogRepository>,
        blockchain_gateway: Arc<dyn BlockchainGateway>,
        sync_deal_use_case: Arc<SyncDealUseCase>,
        evidence_storage: Arc<dyn EvidenceStoragePort>,
    ) -> Self {
        Self {
            uow,
            evidence_repo,
            audit_log_repo,
            blockchain_gateway,
            sync_deal_use_case,
            evidence_storage,
        }
    }

    pub async fn open_dispute(
        &self,
        raw_trade_id: &str,
        caller_address: &str,
        reason: &str,
        summary: &str,
        optional_tx_hash: Option<&str>,
    ) -> Result<DisputeWithDeal, DomainError> {
        let trade_id = EthFormatValidator::require_bytes32(Some(raw_trade_id), "tradeId")?;
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;
        let trimmed_reason = require_bounded(reason, "reason", 5, 200)?;
        let trimmed_summary = require_bounded(summary, "summary", 10, 4000)?;
        let tx_hash = match optional_tx_hash {
            Some(s) if !s.trim().is_empty() => {
                Some(EthFormatValidator::require_bytes32(Some(s), "txHash")?)
            }
            _ => None,
        };

        // Phase 1: check existence, role & conflict in short tx
        let tid_p1 = trade_id.clone();
        let caller_p1 = caller.clone();
        let mut deal = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let found = repos
                    .deals()
                    .find_by_trade_id(&tid_p1)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {tid_p1}")))?;
                let is_party = caller_p1.eq_ignore_ascii_case(&found.seller)
                    || found
                        .buyer
                        .as_deref()
                        .is_some_and(|b| b.eq_ignore_ascii_case(&caller_p1));
                if !is_party {
                    return Err(DomainError::forbidden(
                        "Only the deal buyer or seller can file dispute details.",
                    ));
                }
                if let Some(existing) = repos.disputes().find_by_trade_id(&tid_p1).await? {
                    if existing.reason != AUTO_INDEXED_DISPUTE_REASON {
                        return Err(DomainError::conflict(format!(
                            "A dispute case already exists for trade {tid_p1}"
                        )));
                    }
                }
                Ok(found)
            })
        })
        .await?;

        let mut disputed_at_from_chain: Option<DateTime<Utc>> = None;

        // Phase 2: Verify on-chain DISPUTED status (and DisputeOpened tx receipt if provided) OUTSIDE DB tx
        if self.blockchain_gateway.is_enabled() {
            if let Some(ref hash) = tx_hash {
                let receipt = self
                    .blockchain_gateway
                    .inspect_transaction(hash)
                    .await?
                    .ok_or_else(|| {
                        DomainError::validation(format!(
                            "Dispute transaction receipt not found or pending: {hash}"
                        ))
                    })?;
                if !receipt.succeeded {
                    return Err(DomainError::validation(format!(
                        "Dispute transaction reverted on-chain: {hash}"
                    )));
                }
                let opened_ev = receipt.decoded_events.iter().find(|ev| {
                    ev.event_type == OnChainEventType::DisputeOpened
                        && ev
                            .trade_id
                            .as_deref()
                            .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
                });
                let Some(ev) = opened_ev else {
                    return Err(DomainError::validation(format!(
                        "Submitted transaction did not emit DisputeOpened for tradeId {trade_id}"
                    )));
                };
                if ev.block_timestamp_epoch > 0 {
                    disputed_at_from_chain = DateTime::from_timestamp(ev.block_timestamp_epoch, 0);
                }
            }
            if disputed_at_from_chain.is_none() {
                if let Some(snapshot) = self.blockchain_gateway.fetch_trade(&trade_id).await? {
                    if snapshot.disputed_at_epoch > 0 {
                        disputed_at_from_chain =
                            DateTime::from_timestamp(snapshot.disputed_at_epoch, 0);
                    }
                }
            }
            deal = self
                .sync_deal_use_case
                .execute(&trade_id, tx_hash.as_deref(), &caller)
                .await?;
        }

        if deal.status != DealStatus::Disputed {
            return Err(DomainError::validation(format!(
                "On-chain trade status must be DISPUTED before recording dispute metadata (current: {}).",
                deal.status
            )));
        }

        let now = Utc::now();
        let effective_disputed_at = disputed_at_from_chain.unwrap_or(now);
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let current_deal = repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
                if current_deal.status != DealStatus::Disputed {
                    return Err(DomainError::conflict(format!(
                        "On-chain trade status must be DISPUTED before recording dispute metadata (current: {}).",
                        current_deal.status
                    )));
                }
                let to_save = match repos.disputes().find_by_trade_id(&trade_id).await? {
                    Some(existing) if existing.reason != AUTO_INDEXED_DISPUTE_REASON => {
                        return Err(DomainError::conflict(format!(
                            "A dispute case already exists for trade {trade_id}"
                        )));
                    }
                    Some(existing) => Dispute {
                        opened_by: caller.clone(),
                        reason: trimmed_reason,
                        summary: trimmed_summary,
                        open_tx_hash: tx_hash.or(existing.open_tx_hash),
                        disputed_at: disputed_at_from_chain
                            .or(existing.disputed_at)
                            .or(Some(effective_disputed_at)),
                        ..existing
                    },
                    None => Dispute {
                        id: None,
                        trade_id: trade_id.clone(),
                        opened_by: caller.clone(),
                        reason: trimmed_reason,
                        summary: trimmed_summary,
                        status: DisputeStatus::Open,
                        buyer_award_wei: None,
                        seller_award_wei: None,
                        resolution_rationale: None,
                        open_tx_hash: tx_hash,
                        resolve_tx_hash: None,
                        disputed_at: Some(effective_disputed_at),
                        dispute_timeout_seconds: DEFAULT_DISPUTE_TIMEOUT_SECONDS,
                        created_at: now,
                        resolved_at: None,
                    },
                };
                let created = repos.disputes().save(&to_save).await?;
                let created_id = created
                    .id
                    .ok_or_else(|| DomainError::internal("Saved dispute is missing id"))?;
                let votes = repos.dispute_votes().find_by_dispute_id(created_id).await?;
                repos
                    .audit_logs()
                    .append(&AuditLogEntry {
                        id: None,
                        action: "DISPUTE_OPENED".to_string(),
                        actor_address: Some(caller),
                        resource_type: "DISPUTE".to_string(),
                        resource_id: created_id.to_string(),
                        correlation_id: Some(correlation_id),
                        details: format!("Opened dispute metadata for tradeId={trade_id}"),
                        created_at: now,
                    })
                    .await?;
                Ok(DisputeWithDeal {
                    dispute: created,
                    deal: current_deal,
                    votes,
                })
            })
        })
        .await
    }

    pub async fn get_dispute(
        &self,
        dispute_id: i64,
        caller_address: &str,
    ) -> Result<DisputeWithDeal, DomainError> {
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;
        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let dispute = repos
                    .disputes()
                    .find_by_id(dispute_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                    })?;
                let deal = repos
                    .deals()
                    .find_by_trade_id(&dispute.trade_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!(
                            "Parent deal not found for dispute {dispute_id}"
                        ))
                    })?;
                if !deal.is_participant_or_arbiter(Some(&caller)) {
                    return Err(DomainError::forbidden(
                        "Only deal parties or the assigned arbiter may view this dispute.",
                    ));
                }
                let votes = repos.dispute_votes().find_by_dispute_id(dispute_id).await?;
                Ok(DisputeWithDeal {
                    dispute,
                    deal,
                    votes,
                })
            })
        })
        .await
    }

    pub async fn list_evidence(
        &self,
        dispute_id: i64,
        caller_address: &str,
    ) -> Result<Vec<DisputeEvidence>, DomainError> {
        self.get_dispute(dispute_id, caller_address).await?;
        self.evidence_repo
            .find_by_dispute_id_order_by_created_at_asc(dispute_id)
            .await
    }

    pub async fn upload_evidence(
        &self,
        command: UploadEvidenceCommand<'_>,
    ) -> Result<DisputeEvidence, DomainError> {
        let dispute_id = command.dispute_id;
        let caller =
            EthFormatValidator::require_address(Some(command.caller_address), "callerAddress")?;
        let trimmed_title = require_bounded(command.title, "title", 3, 160)?;
        let trimmed_notes = require_bounded(command.notes, "notes", 5, 4000)?;

        let ctx = self.get_dispute(dispute_id, &caller).await?;
        if ctx.dispute.status != DisputeStatus::Open {
            return Err(DomainError::conflict(
                "Evidence can only be added while the dispute is OPEN.",
            ));
        }
        let is_party = caller.eq_ignore_ascii_case(&ctx.deal.seller)
            || ctx
                .deal
                .buyer
                .as_deref()
                .is_some_and(|b| b.eq_ignore_ascii_case(&caller));
        if !is_party {
            return Err(DomainError::forbidden(
                "Only buyer or seller may submit dispute evidence.",
            ));
        }

        let attachment = if let Some(bytes) = command.file_bytes.filter(|b| !b.is_empty()) {
            Some(
                self.evidence_storage
                    .store(
                        dispute_id,
                        command.original_filename.unwrap_or(""),
                        command.declared_mime_type,
                        bytes,
                    )
                    .await?,
            )
        } else {
            None
        };

        let now = Utc::now();
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        let cleanup_storage_key = attachment.as_ref().map(|att| att.storage_key.clone());
        let trade_id_for_lock = ctx.deal.trade_id.clone();

        let result = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id_for_lock)
                    .await?
                    .ok_or_else(|| {
                        DomainError::not_found(format!("Deal not found: {trade_id_for_lock}"))
                    })?;
                let current_dispute =
                    repos
                        .disputes()
                        .find_by_id(dispute_id)
                        .await?
                        .ok_or_else(|| {
                            DomainError::not_found(format!("Dispute not found: {dispute_id}"))
                        })?;
                if current_dispute.status != DisputeStatus::Open {
                    return Err(DomainError::conflict(
                        "Evidence can only be added while the dispute is OPEN.",
                    ));
                }
                let (file_name, mime_type, size_bytes, sha256_hex, storage_key) = match attachment {
                    Some(att) => (
                        Some(att.sanitized_file_name),
                        Some(att.mime_type),
                        Some(att.size_bytes),
                        Some(att.sha256_hex),
                        Some(att.storage_key),
                    ),
                    None => (None, None, None, None, None),
                };
                let saved = repos
                    .dispute_evidence()
                    .save(&DisputeEvidence {
                        id: None,
                        dispute_id,
                        submitted_by: caller.clone(),
                        title: trimmed_title,
                        notes: trimmed_notes,
                        file_name,
                        mime_type,
                        size_bytes,
                        sha256_hex,
                        storage_key,
                        created_at: now,
                    })
                    .await?;
                let saved_id = saved
                    .id
                    .ok_or_else(|| DomainError::internal("Saved dispute evidence missing id"))?;
                repos
                    .audit_logs()
                    .append(&AuditLogEntry {
                        id: None,
                        action: "DISPUTE_EVIDENCE_UPLOADED".to_string(),
                        actor_address: Some(caller),
                        resource_type: "DISPUTE_EVIDENCE".to_string(),
                        resource_id: saved_id.to_string(),
                        correlation_id: Some(correlation_id),
                        details: format!(
                            "Uploaded evidence item for disputeId={dispute_id} hasAttachment={}",
                            saved.has_attachment()
                        ),
                        created_at: now,
                    })
                    .await?;
                Ok(saved)
            })
        })
        .await;

        if result.is_err() {
            if let Some(storage_key) = cleanup_storage_key {
                self.evidence_storage.delete_best_effort(&storage_key).await;
            }
        }

        result
    }

    pub async fn prepare_evidence_download(
        &self,
        dispute_id: i64,
        evidence_id: i64,
        caller_address: &str,
    ) -> Result<EvidenceDownloadTarget, DomainError> {
        let caller = EthFormatValidator::require_address(Some(caller_address), "callerAddress")?;
        self.get_dispute(dispute_id, &caller).await?;

        let evidence = self
            .evidence_repo
            .find_by_id_and_dispute_id(evidence_id, dispute_id)
            .await?
            .ok_or_else(|| DomainError::not_found("Evidence item not found."))?;
        let storage_key = evidence
            .storage_key
            .as_deref()
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| {
                DomainError::not_found("Evidence item does not include a downloadable file.")
            })?;

        let payload = match self.evidence_storage.open_download(storage_key).await? {
            EvidenceDownloadPayload::Bytes(bytes) => {
                evidence.verify_bytes_integrity(&bytes)?;
                EvidenceDownloadPayload::Bytes(bytes)
            }
            EvidenceDownloadPayload::LocalFile(_) => {
                let bytes = self.evidence_storage.load(storage_key).await?;
                evidence.verify_bytes_integrity(&bytes)?;
                EvidenceDownloadPayload::Bytes(bytes)
            }
        };
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        self.audit_log_repo
            .append(&AuditLogEntry {
                id: None,
                action: "DISPUTE_EVIDENCE_DOWNLOADED".to_string(),
                actor_address: Some(caller),
                resource_type: "DISPUTE_EVIDENCE".to_string(),
                resource_id: evidence_id.to_string(),
                correlation_id: Some(correlation_id),
                details: format!("Downloaded attachment for disputeId={dispute_id}"),
                created_at: Utc::now(),
            })
            .await?;

        Ok(EvidenceDownloadTarget {
            metadata: evidence,
            payload,
        })
    }
}

fn require_bounded(raw: &str, field: &str, min: usize, max: usize) -> Result<String, DomainError> {
    let trimmed = raw.trim();
    let char_len = trimmed.chars().count();
    if char_len < min || char_len > max {
        return Err(DomainError::validation(format!(
            "{field} length must be between {min} and {max} characters."
        )));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::AUTO_INDEXED_DISPUTE_SUMMARY;
    use crate::test_support::{
        sample_bound_deal, FakeBlockchainGateway, FakeEvidenceStorage, InMemoryStore,
    };
    use safedeal_domain::ports::{DealRepository, DisputeRepository};

    #[tokio::test]
    async fn open_dispute_backfills_auto_created_fallback_dispute_and_rejects_duplicate_user_dispute(
    ) {
        let store = InMemoryStore::new();
        let gateway = FakeBlockchainGateway::new(false);
        let storage = FakeEvidenceStorage::new(true);
        let sync_uc = Arc::new(SyncDealUseCase::new(
            Arc::clone(&store) as Arc<dyn UnitOfWork>,
            Arc::clone(&gateway) as Arc<dyn BlockchainGateway>,
        ));
        let dispute_uc = DisputeUseCase::new(
            Arc::clone(&store) as Arc<dyn UnitOfWork>,
            Arc::clone(&store) as Arc<dyn DisputeEvidenceRepository>,
            Arc::clone(&store) as Arc<dyn AuditLogRepository>,
            Arc::clone(&gateway) as Arc<dyn BlockchainGateway>,
            sync_uc,
            storage,
        );

        let trade_id = format!("0x{}", "b".repeat(64));
        let deal = sample_bound_deal(&trade_id, DealStatus::Disputed);
        let buyer = deal.buyer.clone().unwrap();
        DealRepository::save(store.as_ref(), &deal).await.unwrap();

        // Seed auto-indexed fallback dispute row
        let fallback = DisputeRepository::save(
            store.as_ref(),
            &Dispute {
                id: None,
                trade_id: trade_id.clone(),
                opened_by: deal.seller.clone(),
                reason: AUTO_INDEXED_DISPUTE_REASON.to_string(),
                summary: AUTO_INDEXED_DISPUTE_SUMMARY.to_string(),
                status: DisputeStatus::Open,
                buyer_award_wei: None,
                seller_award_wei: None,
                resolution_rationale: None,
                open_tx_hash: None,
                resolve_tx_hash: None,
                disputed_at: Some(Utc::now()),
                dispute_timeout_seconds: DEFAULT_DISPUTE_TIMEOUT_SECONDS,
                created_at: Utc::now(),
                resolved_at: None,
            },
        )
        .await
        .unwrap();

        let tx_hash = format!("0x{}", "d".repeat(64));
        let backfilled = dispute_uc
            .open_dispute(
                &trade_id,
                &buyer,
                "Missing milestone deliverables",
                "Seller submitted incomplete build without unit test suite.",
                Some(&tx_hash),
            )
            .await
            .expect("backfill auto-created dispute");

        assert_eq!(backfilled.dispute.id, fallback.id);
        assert_eq!(backfilled.dispute.opened_by, buyer);
        assert_eq!(backfilled.dispute.reason, "Missing milestone deliverables");
        assert_eq!(
            backfilled.dispute.summary,
            "Seller submitted incomplete build without unit test suite."
        );
        assert_eq!(
            backfilled.dispute.open_tx_hash.as_deref(),
            Some(tx_hash.as_str())
        );

        // Subsequent open_dispute call must fail with Conflict because reason is now user-provided
        let err = dispute_uc
            .open_dispute(
                &trade_id,
                &buyer,
                "Second attempt",
                "Should fail with 409 Conflict now.",
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Conflict { .. }));
    }

    #[tokio::test]
    async fn prepare_evidence_download_verifies_sha256_integrity_for_local_file_payloads() {
        let store = InMemoryStore::new();
        let gateway = FakeBlockchainGateway::new(false);
        let storage = FakeEvidenceStorage::new(true);
        let sync_uc = Arc::new(SyncDealUseCase::new(
            Arc::clone(&store) as Arc<dyn UnitOfWork>,
            Arc::clone(&gateway) as Arc<dyn BlockchainGateway>,
        ));
        let dispute_uc = DisputeUseCase::new(
            Arc::clone(&store) as Arc<dyn UnitOfWork>,
            Arc::clone(&store) as Arc<dyn DisputeEvidenceRepository>,
            Arc::clone(&store) as Arc<dyn AuditLogRepository>,
            Arc::clone(&gateway) as Arc<dyn BlockchainGateway>,
            sync_uc,
            Arc::clone(&storage) as Arc<dyn EvidenceStoragePort>,
        );

        let trade_id = format!("0x{}", "e".repeat(64));
        let deal = sample_bound_deal(&trade_id, DealStatus::Disputed);
        let buyer = deal.buyer.clone().unwrap();
        DealRepository::save(store.as_ref(), &deal).await.unwrap();

        let dispute = DisputeRepository::save(
            store.as_ref(),
            &Dispute {
                id: Some(10),
                trade_id: trade_id.clone(),
                opened_by: buyer.clone(),
                reason: "Defective artifact".to_string(),
                summary: "Verifying local file SHA-256 check.".to_string(),
                status: DisputeStatus::Open,
                buyer_award_wei: None,
                seller_award_wei: None,
                resolution_rationale: None,
                open_tx_hash: None,
                resolve_tx_hash: None,
                disputed_at: Some(Utc::now()),
                dispute_timeout_seconds: DEFAULT_DISPUTE_TIMEOUT_SECONDS,
                created_at: Utc::now(),
                resolved_at: None,
            },
        )
        .await
        .unwrap();

        let original_bytes = b"hello".to_vec();
        let sha256_hex =
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".to_string();
        let storage_key = "10/proof.txt".to_string();
        storage
            .files
            .lock()
            .unwrap()
            .insert(storage_key.clone(), original_bytes.clone());

        let evidence = DisputeEvidenceRepository::save(
            store.as_ref(),
            &DisputeEvidence {
                id: Some(55),
                dispute_id: dispute.id.unwrap(),
                submitted_by: buyer.clone(),
                title: "Proof".to_string(),
                notes: "Original file".to_string(),
                file_name: Some("proof.txt".to_string()),
                mime_type: Some("text/plain".to_string()),
                size_bytes: Some(original_bytes.len() as i64),
                sha256_hex: Some(sha256_hex),
                storage_key: Some(storage_key.clone()),
                created_at: Utc::now(),
            },
        )
        .await
        .unwrap();

        // Untampered LocalFile is loaded, verified, and returned as Bytes
        let target = dispute_uc
            .prepare_evidence_download(dispute.id.unwrap(), evidence.id.unwrap(), &buyer)
            .await
            .expect("valid local evidence download");
        assert_eq!(
            target.payload,
            EvidenceDownloadPayload::Bytes(original_bytes)
        );

        // Tamper with stored file bytes -> prepare_evidence_download must reject with SHA-256 mismatch
        storage
            .files
            .lock()
            .unwrap()
            .insert(storage_key, b"tampered-on-disk-bytes".to_vec());
        let err = dispute_uc
            .prepare_evidence_download(dispute.id.unwrap(), evidence.id.unwrap(), &buyer)
            .await
            .unwrap_err();
        assert!(matches!(err, DomainError::Internal(_)));
        assert!(err.to_string().contains("SHA-256 mismatch"));
    }
}
