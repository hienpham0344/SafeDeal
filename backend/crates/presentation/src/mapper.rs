use safedeal_application::disputes::DisputeWithDeal;
use safedeal_domain::deal::{BlockchainTransaction, Deal, DealEvent};
use safedeal_domain::dispute::DisputeEvidence;

use crate::dto::{
    BlockchainTransactionResponse, DealDetailResponse, DealEventResponse, DealSummaryResponse,
    DisputeDetailResponse, DisputeEvidenceResponse,
};

pub fn to_summary(deal: &Deal, dispute_id: Option<i64>) -> DealSummaryResponse {
    DealSummaryResponse {
        trade_id: deal.trade_id.clone(),
        title: deal.title.clone(),
        description: deal.description.clone(),
        seller: deal.seller.clone(),
        buyer: deal.buyer.clone(),
        arbiter: deal.arbiter.clone(),
        amount_wei: deal.amount_wei.clone(),
        terms_hash: deal.terms_hash.clone(),
        funding_deadline: deal.funding_deadline,
        delivery_deadline: deal.delivery_deadline,
        inspection_window_seconds: deal.inspection_window_seconds,
        status: deal.status.as_str().to_string(),
        on_chain_bound: deal.on_chain_bound,
        settled: deal.settled,
        delivered_at: deal.delivered_at,
        funded_at: deal.funded_at,
        created_at: deal.created_at,
        dispute_id,
    }
}

pub fn to_detail(deal: &Deal, dispute_id: Option<i64>) -> DealDetailResponse {
    DealDetailResponse {
        trade_id: deal.trade_id.clone(),
        title: deal.title.clone(),
        description: deal.description.clone(),
        seller: deal.seller.clone(),
        buyer: deal.buyer.clone(),
        arbiter: deal.arbiter.clone(),
        amount_wei: deal.amount_wei.clone(),
        terms_hash: deal.terms_hash.clone(),
        funding_deadline: deal.funding_deadline,
        delivery_deadline: deal.delivery_deadline,
        inspection_window_seconds: deal.inspection_window_seconds,
        status: deal.status.as_str().to_string(),
        on_chain_bound: deal.on_chain_bound,
        settled: deal.settled,
        delivered_at: deal.delivered_at,
        funded_at: deal.funded_at,
        created_at: deal.created_at,
        dispute_id,
        terms: deal.terms.clone(),
        canonical_terms_json: deal.canonical_terms_json.clone(),
        chain_id: deal.chain_id,
        contract_address: deal.contract_address.clone(),
        create_tx_hash: deal.create_tx_hash.clone(),
    }
}

pub fn to_event_response(ev: DealEvent) -> DealEventResponse {
    DealEventResponse {
        id: ev.id,
        event_type: ev.event_type,
        actor_address: ev.actor_address,
        tx_hash: ev.tx_hash,
        block_number: ev.block_number,
        details: ev.details,
        created_at: ev.created_at,
    }
}

pub fn to_tx_response(tx: BlockchainTransaction) -> BlockchainTransactionResponse {
    BlockchainTransactionResponse {
        id: tx.id,
        tx_hash: tx.tx_hash,
        operation: tx.operation,
        status: tx.status,
        block_number: tx.block_number,
        submitted_by: tx.submitted_by,
        created_at: tx.created_at,
        confirmed_at: tx.confirmed_at,
    }
}

pub fn to_dispute_detail(ctx: DisputeWithDeal) -> DisputeDetailResponse {
    let d = ctx.dispute;
    let deal = ctx.deal;
    DisputeDetailResponse {
        id: d.id,
        trade_id: d.trade_id,
        deal_title: deal.title,
        deal_amount_wei: deal.amount_wei,
        seller: deal.seller,
        buyer: deal.buyer,
        arbiter: deal.arbiter,
        opened_by: d.opened_by,
        reason: d.reason,
        summary: d.summary,
        status: d.status.as_str().to_string(),
        buyer_award_wei: d.buyer_award_wei,
        seller_award_wei: d.seller_award_wei,
        resolution_rationale: d.resolution_rationale,
        open_tx_hash: d.open_tx_hash,
        resolve_tx_hash: d.resolve_tx_hash,
        created_at: d.created_at,
        resolved_at: d.resolved_at,
    }
}

pub fn to_evidence_response(ev: DisputeEvidence) -> DisputeEvidenceResponse {
    let has_attachment = ev.has_attachment();
    DisputeEvidenceResponse {
        id: ev.id,
        dispute_id: ev.dispute_id,
        submitted_by: ev.submitted_by,
        title: ev.title,
        notes: ev.notes,
        file_name: ev.file_name,
        mime_type: ev.mime_type,
        size_bytes: ev.size_bytes,
        sha256_hex: ev.sha256_hex,
        has_attachment,
        created_at: ev.created_at,
    }
}
