mod common;

use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use alloy::eips::BlockNumberOrTag;
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::rpc::types::{TransactionInput, TransactionRequest};
use alloy::sol_types::{sol, SolCall, SolValue};
use alloy::transports::http::reqwest::Url;
use alloy_primitives::{Address, B256, U256};
use common::{
    build_multipart_file_body, build_test_config, extract_set_cookie_value, resolve_repo_root,
    test_db_url, truncate_all_tables, DbTestGuard, TestWallet,
};
use safedeal_api::assemble_application;
use safedeal_domain::ports::{BlockchainGateway, DealEventRepository};
use safedeal_infrastructure::blockchain::AlloyBlockchainGateway;
use safedeal_infrastructure::persistence::{create_pg_pool, run_migrations};
use serde_json::{json, Value};
use sha3::Digest;
use tempfile::TempDir;
use tokio::net::TcpListener;

sol! {
    #![sol(alloy_sol_types = ::alloy::sol_types)]
    #[allow(clippy::too_many_arguments, missing_docs)]
    interface ISafeDealEscrowLive {
        function createTrade(
            bytes32 tradeId,
            address preassignedBuyer,
            address arbiter,
            uint256 amount,
            bytes32 termsHash,
            uint64 fundingDeadline,
            uint64 deliveryDeadline,
            uint64 inspectionWindow
        ) external;
        function fundTrade(bytes32 tradeId) external payable;
        function markDelivered(bytes32 tradeId) external;
        function releaseFunds(bytes32 tradeId) external;
        function openDispute(bytes32 tradeId) external;
        function resolveDispute(bytes32 tradeId, uint256 buyerAmount, uint256 sellerAmount) external;
        function withdraw() external;
        function claimableBalances(address account) external view returns (uint256);
    }
}

struct AnvilProcess {
    child: Child,
    rpc_url: String,
}

impl Drop for AnvilProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn find_foundry_bin(name: &str) -> PathBuf {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let home_bin = Path::new(&home).join(".foundry/bin").join(name);
        if home_bin.is_file() {
            return home_bin;
        }
    }
    let tmp_bin = Path::new("/tmp/foundry-tool").join(name);
    if tmp_bin.is_file() {
        return tmp_bin;
    }
    panic!("Foundry binary '{name}' not found on PATH, ~/.foundry/bin, or /tmp/foundry-tool");
}

fn pick_free_port() -> u16 {
    let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    listener.local_addr().expect("local addr").port()
}

async fn start_anvil() -> AnvilProcess {
    let anvil_bin = find_foundry_bin("anvil");
    let port = pick_free_port();
    let rpc_url = format!("http://127.0.0.1:{port}");
    let child = Command::new(&anvil_bin)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--chain-id",
            "31337",
            "--silent",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn anvil");

    let proc = AnvilProcess { child, rpc_url };
    let client = reqwest::Client::new();
    for _ in 0..40 {
        if let Ok(res) = client
            .post(&proc.rpc_url)
            .json(&json!({"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}))
            .send()
            .await
        {
            if res.status().is_success() {
                return proc;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("Anvil did not become ready on {}", proc.rpc_url);
}

async fn deploy_escrow_contract(repo_root: &Path, rpc_url: &str) -> Address {
    let forge_bin = find_foundry_bin("forge");
    let mut key_bytes = [0u8; 32];
    k256::elliptic_curve::rand_core::RngCore::fill_bytes(
        &mut k256::elliptic_curve::rand_core::OsRng,
        &mut key_bytes,
    );
    let signing_key =
        k256::ecdsa::SigningKey::from_bytes((&key_bytes).into()).expect("signing key");
    let vk = signing_key.verifying_key().to_encoded_point(false);
    let digest = sha3::Keccak256::digest(&vk.as_bytes()[1..]);
    let deployer_addr = format!("0x{}", hex::encode(&digest[12..]));
    let deployer_pk_hex = format!("0x{}", hex::encode(key_bytes));

    let client = reqwest::Client::new();
    // 100 ETH in hex
    client
        .post(rpc_url)
        .json(&json!({
            "jsonrpc": "2.0",
            "method": "anvil_setBalance",
            "params": [deployer_addr, "0x56bc75e2d63100000"],
            "id": 1
        }))
        .send()
        .await
        .expect("fund deployer")
        .error_for_status()
        .expect("anvil_setBalance ok");

    let blockchain_dir = repo_root.join("blockchain");
    let rpc_url_owned = rpc_url.to_string();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(&forge_bin)
            .current_dir(&blockchain_dir)
            .env("DEPLOYER_PRIVATE_KEY", &deployer_pk_hex)
            .args([
                "script",
                "script/Deploy.s.sol:Deploy",
                "--rpc-url",
                &rpc_url_owned,
                "--broadcast",
            ])
            .output()
            .expect("run forge script Deploy.s.sol")
    })
    .await
    .expect("join forge deploy");

    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success(),
        "forge script deploy failed:\n{combined}"
    );

    let addr_str = combined
        .lines()
        .find_map(|line| line.split("SafeDealEscrow deployed at:").nth(1))
        .map(str::trim)
        .expect("extract SafeDealEscrow deployed address");
    addr_str
        .parse::<Address>()
        .expect("parse deployed SafeDealEscrow Address")
}

struct LiveActor {
    wallet: TestWallet,
    address_typed: Address,
    http: reqwest::Client,
    session_cookie: String,
    csrf_cookie: String,
}

impl LiveActor {
    async fn setup(rpc_url: &str, api_base: &str) -> Self {
        let wallet = TestWallet::random();
        let address_typed: Address = wallet.address.parse().expect("valid actor address");
        let http = reqwest::Client::new();

        // Fund 50 AVAX and impersonate on Anvil
        http.post(rpc_url)
            .json(&json!({
                "jsonrpc": "2.0",
                "method": "anvil_setBalance",
                "params": [wallet.address, "0x2b5e3af16b1880000"],
                "id": 1
            }))
            .send()
            .await
            .expect("anvil_setBalance")
            .error_for_status()
            .expect("anvil_setBalance status");

        http.post(rpc_url)
            .json(&json!({
                "jsonrpc": "2.0",
                "method": "anvil_impersonateAccount",
                "params": [wallet.address],
                "id": 2
            }))
            .send()
            .await
            .expect("anvil_impersonateAccount")
            .error_for_status()
            .expect("anvil_impersonateAccount status");

        // SIWE authenticate against real HTTP API
        let nonce_res = http
            .post(format!("{api_base}/api/v1/auth/nonce"))
            .json(&json!({
                "address": wallet.address,
                "chainId": 31337
            }))
            .send()
            .await
            .expect("nonce request");
        assert_eq!(nonce_res.status(), reqwest::StatusCode::OK);
        let nonce_json: Value = nonce_res.json().await.expect("nonce json");
        let message = nonce_json["message"].as_str().expect("SIWE message");
        let signature = wallet.sign_personal(message);

        let verify_res = http
            .post(format!("{api_base}/api/v1/auth/verify"))
            .json(&json!({
                "message": message,
                "signature": signature
            }))
            .send()
            .await
            .expect("verify request");
        assert_eq!(verify_res.status(), reqwest::StatusCode::OK);

        let headers = verify_res.headers().clone();
        let mut set_cookies = axum::http::HeaderMap::new();
        for hv in headers.get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = hv.to_str() {
                if let Ok(val) = axum::http::HeaderValue::from_str(s) {
                    set_cookies.append(axum::http::header::SET_COOKIE, val);
                }
            }
        }
        let session_cookie =
            extract_set_cookie_value(&set_cookies, "safedeal_session").expect("session cookie");
        let csrf_cookie =
            extract_set_cookie_value(&set_cookies, "safedeal_csrf").expect("csrf cookie");

        Self {
            wallet,
            address_typed,
            http,
            session_cookie,
            csrf_cookie,
        }
    }

    fn cookie_header(&self) -> String {
        format!(
            "safedeal_session={}; safedeal_csrf={}",
            self.session_cookie, self.csrf_cookie
        )
    }

    async fn post_json(&self, url: &str, payload: Value) -> (u16, Value) {
        let res = self
            .http
            .post(url)
            .header(reqwest::header::COOKIE, self.cookie_header())
            .header("X-CSRF-Token", &self.csrf_cookie)
            .json(&payload)
            .send()
            .await
            .expect("post json");
        let status = res.status().as_u16();
        let val: Value = res.json().await.expect("response json");
        (status, val)
    }

    async fn get_json(&self, url: &str) -> (u16, Value) {
        let res = self
            .http
            .get(url)
            .header(reqwest::header::COOKIE, self.cookie_header())
            .send()
            .await
            .expect("get json");
        let status = res.status().as_u16();
        let val: Value = res.json().await.expect("response json");
        (status, val)
    }

    async fn get_bytes(&self, url: &str) -> (u16, Vec<u8>) {
        let res = self
            .http
            .get(url)
            .header(reqwest::header::COOKIE, self.cookie_header())
            .send()
            .await
            .expect("get bytes");
        let status = res.status().as_u16();
        let bytes = res.bytes().await.expect("bytes").to_vec();
        (status, bytes)
    }
}

async fn send_escrow_call(
    provider: &DynProvider,
    sender: Address,
    contract: Address,
    value: U256,
    calldata: Vec<u8>,
) -> String {
    let tx = TransactionRequest::default()
        .from(sender)
        .to(contract)
        .value(value)
        .input(TransactionInput::new(calldata.into()));

    let pending = provider
        .send_transaction(tx)
        .await
        .expect("send transaction");
    let receipt = pending.get_receipt().await.expect("wait receipt");
    assert!(receipt.status(), "On-chain transaction reverted");
    format!("{:#x}", receipt.transaction_hash)
}

async fn read_claimable(provider: &DynProvider, contract: Address, account: Address) -> U256 {
    let calldata = ISafeDealEscrowLive::claimableBalancesCall { account }.abi_encode();
    let tx = TransactionRequest::default()
        .to(contract)
        .input(TransactionInput::new(calldata.into()));
    let raw = provider.call(tx).await.expect("claimableBalances call");
    U256::abi_decode(&raw).expect("decode claimable uint256")
}

#[tokio::test]
async fn runs_full_multi_actor_escrow_dispute_arbitration_and_indexer_flow_on_live_anvil() {
    let repo_root = resolve_repo_root();
    let anvil = start_anvil().await;
    let contract_addr = deploy_escrow_contract(&repo_root, &anvil.rpc_url).await;
    let contract_hex = format!("{contract_addr:#x}");

    let db_url = test_db_url();
    let _guard = DbTestGuard::acquire(&db_url).await;
    let evidence_dir = TempDir::new().expect("temp evidence");

    let config = build_test_config(
        &db_url,
        evidence_dir.path(),
        &[
            ("AVALANCHE_RPC_URL", &anvil.rpc_url),
            ("ESCROW_CONTRACT_ADDRESS", &contract_hex),
            ("BLOCKCHAIN_SYNC_ENABLED", "true"),
            ("BLOCKCHAIN_CONFIRMATIONS_REQUIRED", "1"),
            ("ESCROW_DEPLOYMENT_BLOCK", "0"),
            ("RATE_LIMIT_ENABLED", "false"),
        ],
    );

    let pool = create_pg_pool(&config.database).await.expect("pg pool");
    run_migrations(&pool).await.expect("migrations");
    truncate_all_tables(&pool).await;

    let gateway: Arc<dyn BlockchainGateway> =
        Arc::new(AlloyBlockchainGateway::new(&config.blockchain).expect("alloy gateway"));
    let components = assemble_application(&config, pool.clone(), gateway).expect("assemble app");
    let indexer = Arc::clone(&components.indexer);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind live test server");
    let addr = listener.local_addr().expect("server addr");
    let api_base = format!("http://127.0.0.1:{}", addr.port());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let service = components
        .router
        .into_make_service_with_connect_info::<SocketAddr>();
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, service)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    let rpc_parsed: Url = anvil.rpc_url.parse().expect("rpc url");
    let rpc_provider: DynProvider = ProviderBuilder::new()
        .disable_recommended_fillers()
        .connect_http(rpc_parsed)
        .erased();

    let seller = LiveActor::setup(&anvil.rpc_url, &api_base).await;
    let buyer = LiveActor::setup(&anvil.rpc_url, &api_base).await;
    let arbiter = LiveActor::setup(&anvil.rpc_url, &api_base).await;
    let outsider = LiveActor::setup(&anvil.rpc_url, &api_base).await;

    // Flow 1: Cooperative Deal Lifecycle
    let latest_block = rpc_provider
        .get_block_by_number(BlockNumberOrTag::Latest)
        .await
        .expect("latest block")
        .expect("block present");
    let base_epoch = chrono::Utc::now()
        .timestamp()
        .max(latest_block.header.timestamp as i64);
    let funding_deadline_1 = base_epoch + 3600;
    let delivery_deadline_1 = base_epoch + 7200;
    let one_avax = U256::from(1_000_000_000_000_000_000u128);

    let (status, draft1) = seller
        .post_json(
            &format!("{api_base}/api/v1/deals/drafts"),
            json!({
                "title": "Live Anvil Consulting Agreement",
                "description": "End-to-end Avalanche escrow verification engagement",
                "amountWei": one_avax.to_string(),
                "buyerAddress": buyer.wallet.address,
                "arbiterAddress": arbiter.wallet.address,
                "fundingDeadlineEpochSeconds": funding_deadline_1,
                "deliveryDeadlineEpochSeconds": delivery_deadline_1,
                "inspectionWindowSeconds": 86400,
                "terms": "Seller delivers signed build artifact before inspection release."
            }),
        )
        .await;
    assert_eq!(status, 201);
    let trade_id_1 = draft1["tradeId"].as_str().unwrap().to_string();
    let terms_hash_1 = draft1["termsHash"].as_str().unwrap().to_string();
    let tid1_b256: B256 = trade_id_1.parse().unwrap();
    let thash1_b256: B256 = terms_hash_1.parse().unwrap();

    let create_tx_1 = send_escrow_call(
        &rpc_provider,
        seller.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::createTradeCall {
            tradeId: tid1_b256,
            preassignedBuyer: buyer.address_typed,
            arbiter: arbiter.address_typed,
            amount: one_avax,
            termsHash: thash1_b256,
            fundingDeadline: funding_deadline_1 as u64,
            deliveryDeadline: delivery_deadline_1 as u64,
            inspectionWindow: 86_400,
        }
        .abi_encode(),
    )
    .await;

    let (bind_st, bind_body) = seller
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_1}/bind-tx"),
            json!({ "txHash": create_tx_1 }),
        )
        .await;
    assert_eq!(bind_st, 200);
    assert_eq!(bind_body["status"], "CREATED");
    assert_eq!(bind_body["onChainBound"], true);
    assert_eq!(bind_body["createTxHash"], create_tx_1);

    let fund_tx_1 = send_escrow_call(
        &rpc_provider,
        buyer.address_typed,
        contract_addr,
        one_avax,
        ISafeDealEscrowLive::fundTradeCall { tradeId: tid1_b256 }.abi_encode(),
    )
    .await;
    let (sf_st, sf_body) = buyer
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_1}/sync"),
            json!({ "txHash": fund_tx_1 }),
        )
        .await;
    assert_eq!(sf_st, 200);
    assert_eq!(sf_body["status"], "FUNDED");
    assert_eq!(sf_body["createTxHash"], create_tx_1);

    let deliver_tx_1 = send_escrow_call(
        &rpc_provider,
        seller.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::markDeliveredCall { tradeId: tid1_b256 }.abi_encode(),
    )
    .await;
    let (sd_st, sd_body) = seller
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_1}/sync"),
            json!({ "txHash": deliver_tx_1 }),
        )
        .await;
    assert_eq!(sd_st, 200);
    assert_eq!(sd_body["status"], "DELIVERED");

    let release_tx_1 = send_escrow_call(
        &rpc_provider,
        buyer.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::releaseFundsCall { tradeId: tid1_b256 }.abi_encode(),
    )
    .await;
    let (sr_st, sr_body) = buyer
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_1}/sync"),
            json!({ "txHash": release_tx_1 }),
        )
        .await;
    assert_eq!(sr_st, 200);
    assert_eq!(sr_body["status"], "RELEASED");
    assert_eq!(sr_body["settled"], true);

    assert_eq!(
        read_claimable(&rpc_provider, contract_addr, seller.address_typed).await,
        one_avax
    );
    let seller_bal_before = rpc_provider
        .get_balance(seller.address_typed)
        .await
        .expect("seller balance before");
    send_escrow_call(
        &rpc_provider,
        seller.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::withdrawCall {}.abi_encode(),
    )
    .await;
    assert_eq!(
        read_claimable(&rpc_provider, contract_addr, seller.address_typed).await,
        U256::ZERO
    );
    let seller_bal_after = rpc_provider
        .get_balance(seller.address_typed)
        .await
        .expect("seller balance after");
    assert!(seller_bal_after > seller_bal_before);

    let (hist_st, hist_body) = buyer
        .get_json(&format!("{api_base}/api/v1/deals/{trade_id_1}/history"))
        .await;
    assert_eq!(hist_st, 200);
    assert_eq!(hist_body["events"].as_array().unwrap().len(), 5);

    // Flow 2: Dispute + Private Evidence + Split Arbitration + Live Indexer Deduplication
    let two_avax = U256::from(2_000_000_000_000_000_000u128);
    let buyer_split = U256::from(1_500_000_000_000_000_000u128);
    let seller_split = U256::from(500_000_000_000_000_000u128);
    let funding_deadline_2 = base_epoch + 5400;
    let delivery_deadline_2 = base_epoch + 9000;

    let (d2_st, draft2) = seller
        .post_json(
            &format!("{api_base}/api/v1/deals/drafts"),
            json!({
                "title": "Live Anvil Dispute & Split Arbitration",
                "description": "Full live contract split arbitration and indexer verification",
                "amountWei": two_avax.to_string(),
                "buyerAddress": buyer.wallet.address,
                "arbiterAddress": arbiter.wallet.address,
                "fundingDeadlineEpochSeconds": funding_deadline_2,
                "deliveryDeadlineEpochSeconds": delivery_deadline_2,
                "inspectionWindowSeconds": 7200,
                "terms": "Disputed milestones settled by arbiter pro-rata."
            }),
        )
        .await;
    assert_eq!(d2_st, 201);
    let trade_id_2 = draft2["tradeId"].as_str().unwrap().to_string();
    let terms_hash_2 = draft2["termsHash"].as_str().unwrap().to_string();
    let tid2_b256: B256 = trade_id_2.parse().unwrap();
    let thash2_b256: B256 = terms_hash_2.parse().unwrap();

    let create_tx_2 = send_escrow_call(
        &rpc_provider,
        seller.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::createTradeCall {
            tradeId: tid2_b256,
            preassignedBuyer: buyer.address_typed,
            arbiter: arbiter.address_typed,
            amount: two_avax,
            termsHash: thash2_b256,
            fundingDeadline: funding_deadline_2 as u64,
            deliveryDeadline: delivery_deadline_2 as u64,
            inspectionWindow: 7200,
        }
        .abi_encode(),
    )
    .await;
    let (b2_st, _) = seller
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_2}/bind-tx"),
            json!({ "txHash": create_tx_2 }),
        )
        .await;
    assert_eq!(b2_st, 200);

    let fund_tx_2 = send_escrow_call(
        &rpc_provider,
        buyer.address_typed,
        contract_addr,
        two_avax,
        ISafeDealEscrowLive::fundTradeCall { tradeId: tid2_b256 }.abi_encode(),
    )
    .await;
    let (sf2_st, _) = buyer
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_2}/sync"),
            json!({ "txHash": fund_tx_2 }),
        )
        .await;
    assert_eq!(sf2_st, 200);

    let open_dispute_tx_2 = send_escrow_call(
        &rpc_provider,
        buyer.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::openDisputeCall { tradeId: tid2_b256 }.abi_encode(),
    )
    .await;
    let (disp_st, disp_body) = buyer
        .post_json(
            &format!("{api_base}/api/v1/deals/{trade_id_2}/disputes"),
            json!({
                "reason": "Partial delivery defect",
                "summary": "Delivered package missed two core acceptance components.",
                "txHash": open_dispute_tx_2
            }),
        )
        .await;
    assert_eq!(disp_st, 201);
    let dispute_id = disp_body["id"].as_i64().unwrap();

    let png_payload = [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02];
    let boundary = "----SafeDealLiveBoundary123";
    let multipart_body = build_multipart_file_body(
        boundary,
        &[
            ("title", "Defect Proof PNG"),
            ("notes", "Screenshot confirming failed inspection run."),
        ],
        Some(("file", "proof-live.png", "image/png", &png_payload)),
    );
    let upload_res = buyer
        .http
        .post(format!("{api_base}/api/v1/disputes/{dispute_id}/evidence"))
        .header(reqwest::header::COOKIE, buyer.cookie_header())
        .header("X-CSRF-Token", &buyer.csrf_cookie)
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(multipart_body)
        .send()
        .await
        .expect("upload evidence");
    assert_eq!(upload_res.status().as_u16(), 201);
    let evidence_json: Value = upload_res.json().await.expect("evidence json");
    let evidence_id = evidence_json["id"].as_i64().unwrap();

    let (outsider_dl_st, _) = outsider
        .get_bytes(&format!(
            "{api_base}/api/v1/disputes/{dispute_id}/evidence/{evidence_id}/download"
        ))
        .await;
    assert_eq!(outsider_dl_st, 403);

    let (arbiter_dl_st, arbiter_dl_bytes) = arbiter
        .get_bytes(&format!(
            "{api_base}/api/v1/disputes/{dispute_id}/evidence/{evidence_id}/download"
        ))
        .await;
    assert_eq!(arbiter_dl_st, 200);
    assert_eq!(arbiter_dl_bytes.as_slice(), &png_payload);

    let resolve_tx_2 = send_escrow_call(
        &rpc_provider,
        arbiter.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::resolveDisputeCall {
            tradeId: tid2_b256,
            buyerAmount: buyer_split,
            sellerAmount: seller_split,
        }
        .abi_encode(),
    )
    .await;
    let (res_st, res_body) = arbiter
        .post_json(
            &format!("{api_base}/api/v1/arbitration/disputes/{dispute_id}/resolution"),
            json!({
                "txHash": resolve_tx_2,
                "rationale": "75% refunded to buyer, 25% awarded to seller per inspection evidence."
            }),
        )
        .await;
    assert_eq!(res_st, 200);
    assert_eq!(res_body["status"], "RESOLVED");
    assert_eq!(res_body["buyerAwardWei"], buyer_split.to_string());
    assert_eq!(res_body["sellerAwardWei"], seller_split.to_string());

    // Live indexer polling twice against real Anvil must be idempotent with 0 duplicates
    let first_indexed = indexer.poll_and_index().await.expect("first live poll");
    let count_after_first = components
        .repos
        .deal_events
        .find_by_trade_id_order_by_created_at_asc(&trade_id_2)
        .await
        .unwrap()
        .len();
    assert_eq!(first_indexed, 1);
    let second_indexed = indexer.poll_and_index().await.expect("second live poll");
    assert_eq!(second_indexed, 0);
    let count_after_second = components
        .repos
        .deal_events
        .find_by_trade_id_order_by_created_at_asc(&trade_id_2)
        .await
        .unwrap()
        .len();
    assert_eq!(count_after_second, count_after_first);

    // Pull-payment withdraw by buyer and seller on Anvil
    assert_eq!(
        read_claimable(&rpc_provider, contract_addr, buyer.address_typed).await,
        buyer_split
    );
    assert_eq!(
        read_claimable(&rpc_provider, contract_addr, seller.address_typed).await,
        seller_split
    );
    let buyer_before = rpc_provider.get_balance(buyer.address_typed).await.unwrap();
    let seller_before = rpc_provider
        .get_balance(seller.address_typed)
        .await
        .unwrap();
    send_escrow_call(
        &rpc_provider,
        buyer.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::withdrawCall {}.abi_encode(),
    )
    .await;
    send_escrow_call(
        &rpc_provider,
        seller.address_typed,
        contract_addr,
        U256::ZERO,
        ISafeDealEscrowLive::withdrawCall {}.abi_encode(),
    )
    .await;
    assert_eq!(
        read_claimable(&rpc_provider, contract_addr, buyer.address_typed).await,
        U256::ZERO
    );
    assert_eq!(
        read_claimable(&rpc_provider, contract_addr, seller.address_typed).await,
        U256::ZERO
    );
    assert!(rpc_provider.get_balance(buyer.address_typed).await.unwrap() > buyer_before);
    assert!(
        rpc_provider
            .get_balance(seller.address_typed)
            .await
            .unwrap()
            > seller_before
    );

    let _ = shutdown_tx.send(());
    let _ = server_handle.await;
    pool.close().await;
}
