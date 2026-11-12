use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use safedeal_domain::blockchain::OnChainEventType;
use safedeal_domain::deal::{Deal, DealStatus};
use safedeal_domain::dispute::{AuditLogEntry, Dispute, DisputeEvidence, DisputeStatus};
use safedeal_domain::ports::{
    in_tx, AuditLogRepository, BlockchainGateway, DisputeEvidenceRepository, EvidenceStoragePort,
    UnitOfWork,
};
use safedeal_shared::{CorrelationIdContext, DomainError, EthFormatValidator};

use crate::deals::SyncDealUseCase;

#[derive(Debug, Clone)]
pub struct DisputeWithDeal {
    pub dispute: Dispute,
    pub deal: Deal,
}

#[derive(Debug, Clone)]
pub struct EvidenceDownloadTarget {
    pub metadata: DisputeEvidence,
    pub path: PathBuf,
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
                if repos.disputes().find_by_trade_id(&tid_p1).await?.is_some() {
                    return Err(DomainError::conflict(format!(
                        "A dispute case already exists for trade {tid_p1}"
                    )));
                }
                Ok(found)
            })
        })
        .await?;

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
                let configured_contract = self.blockchain_gateway.contract_address();
                let has_dispute_opened = receipt.succeeded
                    && receipt.to_address.eq_ignore_ascii_case(configured_contract)
                    && receipt.decoded_events.iter().any(|ev| {
                        ev.event_type == OnChainEventType::DisputeOpened
                            && ev
                                .trade_id
                                .as_deref()
                                .is_some_and(|t| t.eq_ignore_ascii_case(&trade_id))
                    });
                if !has_dispute_opened {
                    return Err(DomainError::validation(format!(
                        "Submitted transaction did not emit DisputeOpened for tradeId {trade_id}"
                    )));
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
        let correlation_id = CorrelationIdContext::get_or_default("n/a");
        in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                repos
                    .deals()
                    .find_by_trade_id_for_update(&trade_id)
                    .await?
                    .ok_or_else(|| DomainError::not_found(format!("Deal not found: {trade_id}")))?;
                if repos.disputes().find_by_trade_id(&trade_id).await?.is_some() {
                    return Err(DomainError::conflict(format!(
                        "A dispute case already exists for trade {trade_id}"
                    )));
                }
                let created = repos
                    .disputes()
                    .save(&Dispute {
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
                        created_at: now,
                        resolved_at: None,
                    })
                    .await?;
                let created_id = created
                    .id
                    .ok_or_else(|| DomainError::internal("Saved dispute is missing id"))?;
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
                    deal,
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
                Ok(DisputeWithDeal { dispute, deal })
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
        let cleanup_storage_key = attachment
            .as_ref()
            .map(|att| att.storage_key.clone());

        let result = in_tx(self.uow.as_ref(), move |repos| {
            Box::pin(async move {
                let (file_name, mime_type, size_bytes, sha256_hex, storage_key) =
                    match attachment {
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
                self.evidence_storage
                    .delete_best_effort(&storage_key)
                    .await;
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

        let path = self.evidence_storage.resolve_attachment_path(storage_key)?;
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
            path,
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
