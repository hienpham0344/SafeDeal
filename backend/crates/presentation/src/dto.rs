use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use utoipa::ToSchema;

use crate::error::ApiFieldError;
use crate::extractors::ValidateRequest;

pub mod utc_serde {
    use super::*;

    pub fn serialize<S>(dt: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&safedeal_shared::format_iso_utc(*dt))
    }
}

pub mod utc_opt_serde {
    use super::*;

    pub fn serialize<S>(opt: &Option<DateTime<Utc>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match opt {
            Some(dt) => serializer.serialize_str(&safedeal_shared::format_iso_utc(*dt)),
            None => serializer.serialize_none(),
        }
    }
}

/// Deserializes an integer strictly like Jackson: rejects floats or strings, accepts null as None.
fn deserialize_opt_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<i64>::deserialize(deserializer)
}

fn check_not_blank(
    value: &Option<String>,
    field: &str,
    msg: &str,
    errors: &mut Vec<ApiFieldError>,
) -> bool {
    match value.as_deref() {
        Some(v) if !v.trim().is_empty() => true,
        _ => {
            errors.push(ApiFieldError {
                field: field.to_string(),
                message: msg.to_string(),
            });
            false
        }
    }
}

fn check_len_range(
    value: &Option<String>,
    field: &str,
    min: usize,
    max: usize,
    errors: &mut Vec<ApiFieldError>,
) {
    if let Some(v) = value.as_deref() {
        let len = v.chars().count();
        if len < min || len > max {
            errors.push(ApiFieldError {
                field: field.to_string(),
                message: format!("size must be between {min} and {max}"),
            });
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NonceRequest {
    #[schema(min_length = 1)]
    pub address: Option<String>,
    #[serde(default, deserialize_with = "deserialize_opt_i64")]
    #[schema(minimum = 1)]
    pub chain_id: Option<i64>,
}

impl ValidateRequest for NonceRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>> {
        let mut errors = Vec::new();
        check_not_blank(&self.address, "address", "address is required", &mut errors);
        match self.chain_id {
            None => errors.push(ApiFieldError {
                field: "chainId".to_string(),
                message: "chainId is required".to_string(),
            }),
            Some(cid) if cid < 1 => errors.push(ApiFieldError {
                field: "chainId".to_string(),
                message: "must be greater than or equal to 1".to_string(),
            }),
            _ => {}
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NonceResponse {
    pub nonce: String,
    pub domain: String,
    pub uri: String,
    pub chain_id: i64,
    #[serde(with = "utc_serde")]
    pub issued_at: DateTime<Utc>,
    #[serde(with = "utc_serde")]
    pub expiration_time: DateTime<Utc>,
    pub statement: String,
    pub message: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    #[schema(min_length = 1)]
    pub message: Option<String>,
    #[schema(min_length = 1)]
    pub signature: Option<String>,
}

impl ValidateRequest for VerifyRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>> {
        let mut errors = Vec::new();
        check_not_blank(
            &self.message,
            "message",
            "SIWE message is required",
            &mut errors,
        );
        check_not_blank(
            &self.signature,
            "signature",
            "Wallet signature is required",
            &mut errors,
        );
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionUserResponse {
    pub address: String,
    pub chain_id: i64,
    #[serde(with = "utc_serde")]
    pub authenticated_at: DateTime<Utc>,
    pub csrf_token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraftRequest {
    #[schema(min_length = 3, max_length = 160)]
    pub title: Option<String>,
    #[schema(min_length = 10, max_length = 4000)]
    pub description: Option<String>,
    #[schema(min_length = 1)]
    pub amount_wei: Option<String>,
    pub buyer_address: Option<String>,
    #[schema(min_length = 1)]
    pub arbiter_address: Option<String>,
    #[serde(default, deserialize_with = "deserialize_opt_i64")]
    pub funding_deadline_epoch_seconds: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_opt_i64")]
    pub delivery_deadline_epoch_seconds: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_opt_i64")]
    #[schema(minimum = 3600, maximum = 2592000)]
    pub inspection_window_seconds: Option<i64>,
    #[schema(min_length = 10, max_length = 8000)]
    pub terms: Option<String>,
}

impl ValidateRequest for CreateDraftRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>> {
        let mut errors = Vec::new();
        if check_not_blank(&self.title, "title", "must not be blank", &mut errors) {
            check_len_range(&self.title, "title", 3, 160, &mut errors);
        }
        if check_not_blank(
            &self.description,
            "description",
            "must not be blank",
            &mut errors,
        ) {
            check_len_range(&self.description, "description", 10, 4000, &mut errors);
        }
        check_not_blank(&self.amount_wei, "amountWei", "must not be blank", &mut errors);
        check_not_blank(
            &self.arbiter_address,
            "arbiterAddress",
            "must not be blank",
            &mut errors,
        );
        if self.funding_deadline_epoch_seconds.is_none() {
            errors.push(ApiFieldError {
                field: "fundingDeadlineEpochSeconds".to_string(),
                message: "must not be null".to_string(),
            });
        }
        if self.delivery_deadline_epoch_seconds.is_none() {
            errors.push(ApiFieldError {
                field: "deliveryDeadlineEpochSeconds".to_string(),
                message: "must not be null".to_string(),
            });
        }
        match self.inspection_window_seconds {
            None => errors.push(ApiFieldError {
                field: "inspectionWindowSeconds".to_string(),
                message: "must not be null".to_string(),
            }),
            Some(w) if !(3600..=2_592_000).contains(&w) => errors.push(ApiFieldError {
                field: "inspectionWindowSeconds".to_string(),
                message: "must be between 3600 and 2592000".to_string(),
            }),
            _ => {}
        }
        if check_not_blank(&self.terms, "terms", "must not be blank", &mut errors) {
            check_len_range(&self.terms, "terms", 10, 8000, &mut errors);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BindTxRequest {
    #[schema(min_length = 1)]
    pub tx_hash: Option<String>,
}

impl ValidateRequest for BindTxRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>> {
        let mut errors = Vec::new();
        check_not_blank(&self.tx_hash, "txHash", "txHash is required", &mut errors);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Deserialize, Default, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub tx_hash: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DealSummaryResponse {
    pub trade_id: String,
    pub title: String,
    pub description: String,
    pub seller: String,
    pub buyer: Option<String>,
    pub arbiter: String,
    pub amount_wei: String,
    pub terms_hash: String,
    #[serde(with = "utc_serde")]
    pub funding_deadline: DateTime<Utc>,
    #[serde(with = "utc_serde")]
    pub delivery_deadline: DateTime<Utc>,
    pub inspection_window_seconds: i64,
    pub status: String,
    pub on_chain_bound: bool,
    pub settled: bool,
    #[serde(with = "utc_opt_serde")]
    pub delivered_at: Option<DateTime<Utc>>,
    #[serde(with = "utc_opt_serde")]
    pub funded_at: Option<DateTime<Utc>>,
    #[serde(with = "utc_serde")]
    pub created_at: DateTime<Utc>,
    pub dispute_id: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DealDetailResponse {
    pub trade_id: String,
    pub title: String,
    pub description: String,
    pub seller: String,
    pub buyer: Option<String>,
    pub arbiter: String,
    pub amount_wei: String,
    pub terms_hash: String,
    #[serde(with = "utc_serde")]
    pub funding_deadline: DateTime<Utc>,
    #[serde(with = "utc_serde")]
    pub delivery_deadline: DateTime<Utc>,
    pub inspection_window_seconds: i64,
    pub status: String,
    pub on_chain_bound: bool,
    pub settled: bool,
    #[serde(with = "utc_opt_serde")]
    pub delivered_at: Option<DateTime<Utc>>,
    #[serde(with = "utc_opt_serde")]
    pub funded_at: Option<DateTime<Utc>>,
    #[serde(with = "utc_serde")]
    pub created_at: DateTime<Utc>,
    pub dispute_id: Option<i64>,
    pub terms: String,
    pub canonical_terms_json: String,
    pub chain_id: i64,
    pub contract_address: String,
    pub create_tx_hash: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraftResponse {
    pub deal: DealDetailResponse,
    pub trade_id: String,
    pub terms_hash: String,
    pub canonical_terms_json: String,
    pub chain_id: i64,
    pub contract_address: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DealEventResponse {
    pub id: Option<i64>,
    pub event_type: String,
    pub actor_address: Option<String>,
    pub tx_hash: Option<String>,
    pub block_number: Option<i64>,
    pub details: String,
    #[serde(with = "utc_serde")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockchainTransactionResponse {
    pub id: Option<i64>,
    pub tx_hash: String,
    pub operation: String,
    pub status: String,
    pub block_number: Option<i64>,
    pub submitted_by: Option<String>,
    #[serde(with = "utc_serde")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "utc_opt_serde")]
    pub confirmed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DealHistoryResponse {
    pub events: Vec<DealEventResponse>,
    pub transactions: Vec<BlockchainTransactionResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[schema(as = PaginatedResponseDealSummaryResponse)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedDealSummaryResponse {
    pub items: Vec<DealSummaryResponse>,
    pub page: i32,
    pub size: i32,
    pub total_items: i64,
    pub total_pages: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenDisputeRequest {
    #[schema(min_length = 5, max_length = 200)]
    pub reason: Option<String>,
    #[schema(min_length = 10, max_length = 4000)]
    pub summary: Option<String>,
    pub tx_hash: Option<String>,
}

impl ValidateRequest for OpenDisputeRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>> {
        let mut errors = Vec::new();
        if check_not_blank(&self.reason, "reason", "must not be blank", &mut errors) {
            check_len_range(&self.reason, "reason", 5, 200, &mut errors);
        }
        if check_not_blank(&self.summary, "summary", "must not be blank", &mut errors) {
            check_len_range(&self.summary, "summary", 10, 4000, &mut errors);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDisputeRequest {
    #[schema(min_length = 1)]
    pub tx_hash: Option<String>,
    #[schema(min_length = 10, max_length = 4000)]
    pub rationale: Option<String>,
}

impl ValidateRequest for ResolveDisputeRequest {
    fn validate(&self) -> Result<(), Vec<ApiFieldError>> {
        let mut errors = Vec::new();
        check_not_blank(&self.tx_hash, "txHash", "txHash is required", &mut errors);
        if check_not_blank(
            &self.rationale,
            "rationale",
            "must not be blank",
            &mut errors,
        ) {
            check_len_range(&self.rationale, "rationale", 10, 4000, &mut errors);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DisputeDetailResponse {
    pub id: Option<i64>,
    pub trade_id: String,
    pub deal_title: String,
    pub deal_amount_wei: String,
    pub seller: String,
    pub buyer: Option<String>,
    pub arbiter: String,
    pub opened_by: String,
    pub reason: String,
    pub summary: String,
    pub status: String,
    pub buyer_award_wei: Option<String>,
    pub seller_award_wei: Option<String>,
    pub resolution_rationale: Option<String>,
    pub open_tx_hash: Option<String>,
    pub resolve_tx_hash: Option<String>,
    #[serde(with = "utc_serde")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "utc_opt_serde")]
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DisputeEvidenceResponse {
    pub id: Option<i64>,
    pub dispute_id: i64,
    pub submitted_by: String,
    pub title: String,
    pub notes: String,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub sha256_hex: Option<String>,
    pub has_attachment: bool,
    #[serde(with = "utc_serde")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatusResponse {
    pub status: String,
    pub service: String,
    pub chain_id: i64,
    pub chain_name: String,
    pub escrow_contract_configured: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessStatusResponse {
    pub status: String,
    pub service: String,
    pub database_connected: bool,
    pub evidence_storage_ready: bool,
    pub siwe_configured: bool,
    pub blockchain_enabled: bool,
    pub escrow_contract_configured: bool,
    pub chain_id: i64,
}
