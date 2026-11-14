use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

use alloy::eips::BlockNumberOrTag;
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::rpc::types::{Filter, TransactionInput, TransactionRequest};
use alloy::transports::http::reqwest::{Client, Url};
use alloy_primitives::{Address, TxHash};
use async_trait::async_trait;
use futures::stream::{self, StreamExt, TryStreamExt};
use safedeal_domain::blockchain::{
    OnChainTradeSnapshot, TransactionVerificationResult, VerifiedChainEvent,
};
use safedeal_domain::ports::BlockchainGateway;
use safedeal_shared::{DomainError, ZERO_ADDRESS};

use crate::config::BlockchainConfig;

use super::codec::SafeDealContractCodec;

const BLOCK_FETCH_CONCURRENCY: usize = 16;

pub struct AlloyBlockchainGateway {
    provider: Option<DynProvider>,
    enabled: bool,
    chain_id: i64,
    chain_name: String,
    contract_address: String,
    parsed_contract: Option<Address>,
    deployment_block: i64,
    confirmations_required: i32,
    sync_batch_size: i64,
}

impl AlloyBlockchainGateway {
    pub fn new(config: &BlockchainConfig) -> Result<Self, String> {
        let contract_address = config.escrow_contract_address.trim().to_ascii_lowercase();
        let parsed_contract =
            if contract_address.is_empty() || contract_address.eq_ignore_ascii_case(ZERO_ADDRESS) {
                None
            } else {
                Some(
                    contract_address
                        .parse::<Address>()
                        .map_err(|e| format!("Invalid ESCROW_CONTRACT_ADDRESS: {e}"))?,
                )
            };

        let provider = if config.enabled {
            let url = Url::parse(config.rpc_url.trim())
                .map_err(|e| format!("Invalid AVALANCHE_RPC_URL '{}': {e}", config.rpc_url))?;
            let client = Client::builder()
                .timeout(Duration::from_millis(config.rpc_timeout_ms))
                .pool_idle_timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(16)
                .build()
                .map_err(|e| format!("Failed to construct pooled RPC HTTP client: {e}"))?;
            let p = ProviderBuilder::new()
                .disable_recommended_fillers()
                .connect_reqwest(client, url)
                .erased();
            Some(p)
        } else {
            None
        };

        Ok(Self {
            provider,
            enabled: config.enabled,
            chain_id: config.chain_id,
            chain_name: config.chain_name.clone(),
            contract_address,
            parsed_contract,
            deployment_block: config.deployment_block,
            confirmations_required: config.confirmations_required,
            sync_batch_size: config.sync_batch_size,
        })
    }

    fn require_ready_provider(&self) -> Option<(&DynProvider, Address)> {
        if !self.enabled {
            return None;
        }
        let provider = self.provider.as_ref()?;
        let contract = self.parsed_contract?;
        Some((provider, contract))
    }

    async fn fetch_block_timestamp_epoch(
        &self,
        provider: &DynProvider,
        block_number: u64,
    ) -> Result<i64, DomainError> {
        let block = provider
            .get_block_by_number(BlockNumberOrTag::Number(block_number))
            .await
            .map_err(|e| {
                DomainError::external_service(format!(
                    "RPC error reading block timestamp for block {block_number}: {e}"
                ))
            })?;

        let Some(block) = block else {
            return Err(DomainError::external_service(format!(
                "RPC node returned null block header for block {block_number}"
            )));
        };

        i64::try_from(block.header.timestamp).map_err(|_| {
            DomainError::external_service(format!(
                "Block timestamp overflow for block {block_number}"
            ))
        })
    }
}

#[async_trait]
impl BlockchainGateway for AlloyBlockchainGateway {
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
        trade_id: &str,
    ) -> Result<Option<OnChainTradeSnapshot>, DomainError> {
        let Some((provider, contract)) = self.require_ready_provider() else {
            return Ok(None);
        };
        let calldata = SafeDealContractCodec::encode_get_trade_call_data(trade_id)?;
        let tx = TransactionRequest::default()
            .to(contract)
            .input(TransactionInput::new(calldata.into()));

        let raw = provider.call(tx).await.map_err(|e| {
            DomainError::external_service(format!("RPC error calling getTrade for {trade_id}: {e}"))
        })?;
        SafeDealContractCodec::decode_get_trade_response(&raw)
    }

    async fn inspect_transaction(
        &self,
        tx_hash: &str,
    ) -> Result<Option<TransactionVerificationResult>, DomainError> {
        let Some((provider, configured_contract)) = self.require_ready_provider() else {
            return Ok(None);
        };
        let normalized_hash = tx_hash.trim().to_ascii_lowercase();
        let parsed_hash: TxHash = normalized_hash
            .parse()
            .map_err(|_| DomainError::validation("txHash must be valid 32-byte hex."))?;

        let receipt = provider
            .get_transaction_receipt(parsed_hash)
            .await
            .map_err(|e| {
                DomainError::external_service(format!(
                    "RPC error reading receipt for {normalized_hash}: {e}"
                ))
            })?;

        let Some(receipt) = receipt else {
            return Ok(None);
        };

        let block_number_u64 = receipt.block_number.ok_or_else(|| {
            DomainError::external_service("Transaction receipt missing blockNumber")
        })?;
        let block_number = i64::try_from(block_number_u64)
            .map_err(|_| DomainError::external_service("Receipt blockNumber exceeds i64 range"))?;
        let block_timestamp = self
            .fetch_block_timestamp_epoch(provider, block_number_u64)
            .await?;

        let succeeded = receipt.status();
        let mut decoded_events = Vec::new();
        if succeeded {
            for log_entry in receipt.logs() {
                if log_entry.address() == configured_contract {
                    if let Some(ev) =
                        SafeDealContractCodec::decode_rpc_log(log_entry, block_timestamp)?
                    {
                        decoded_events.push(ev);
                    }
                }
            }
        }

        Ok(Some(TransactionVerificationResult {
            tx_hash: normalized_hash,
            succeeded,
            block_number,
            from_address: format!("{:#x}", receipt.from),
            to_address: receipt
                .to
                .map(|addr| format!("{addr:#x}"))
                .unwrap_or_default(),
            decoded_events,
        }))
    }

    async fn fetch_latest_block_number(&self) -> Result<i64, DomainError> {
        if !self.enabled {
            return Ok(0);
        }
        let Some(provider) = self.provider.as_ref() else {
            return Ok(0);
        };
        let latest = provider.get_block_number().await.map_err(|e| {
            DomainError::external_service(format!("RPC error reading latest block number: {e}"))
        })?;
        i64::try_from(latest)
            .map_err(|_| DomainError::external_service("Latest blockNumber exceeds i64 range"))
    }

    async fn fetch_logs(
        &self,
        from_block: i64,
        to_block: i64,
    ) -> Result<Vec<VerifiedChainEvent>, DomainError> {
        let Some((provider, contract)) = self.require_ready_provider() else {
            return Ok(Vec::new());
        };
        if to_block < from_block {
            return Ok(Vec::new());
        }

        let from_u64 = u64::try_from(from_block)
            .map_err(|_| DomainError::validation("fromBlock must be non-negative"))?;
        let to_u64 = u64::try_from(to_block)
            .map_err(|_| DomainError::validation("toBlock must be non-negative"))?;

        let filter = Filter::new()
            .address(contract)
            .from_block(from_u64)
            .to_block(to_u64);

        let logs = provider.get_logs(&filter).await.map_err(|e| {
            DomainError::external_service(format!(
                "RPC error fetching logs in range [{from_block}, {to_block}]: {e}"
            ))
        })?;

        if logs.is_empty() {
            return Ok(Vec::new());
        }

        // Deduplicate unique block numbers and resolve block headers concurrently with bounded concurrency.
        let mut unique_blocks = BTreeSet::new();
        for entry in &logs {
            let bn = entry.block_number.ok_or_else(|| {
                DomainError::external_service("RPC log missing blockNumber during fetchLogs")
            })?;
            unique_blocks.insert(bn);
        }

        let block_timestamps: HashMap<u64, i64> = stream::iter(unique_blocks)
            .map(|bn| async move {
                let ts = self.fetch_block_timestamp_epoch(provider, bn).await?;
                Ok::<(u64, i64), DomainError>((bn, ts))
            })
            .buffer_unordered(BLOCK_FETCH_CONCURRENCY)
            .try_collect()
            .await?;

        let mut decoded = Vec::with_capacity(logs.len());
        for entry in &logs {
            let bn = entry.block_number.ok_or_else(|| {
                DomainError::external_service("RPC log missing blockNumber during decode")
            })?;
            let ts = block_timestamps.get(&bn).copied().ok_or_else(|| {
                DomainError::external_service(format!("Missing resolved timestamp for block {bn}"))
            })?;
            if let Some(ev) = SafeDealContractCodec::decode_rpc_log(entry, ts)? {
                decoded.push(ev);
            }
        }

        Ok(decoded)
    }
}
