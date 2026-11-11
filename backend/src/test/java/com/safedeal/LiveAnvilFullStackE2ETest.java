package com.safedeal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.safedeal.application.synchronization.BlockchainEventIndexerService;
import com.safedeal.domain.port.DealEventRepository;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.web3j.abi.FunctionEncoder;
import org.web3j.abi.FunctionReturnDecoder;
import org.web3j.abi.TypeReference;
import org.web3j.abi.datatypes.Address;
import org.web3j.abi.datatypes.Function;
import org.web3j.abi.datatypes.Type;
import org.web3j.abi.datatypes.generated.Bytes32;
import org.web3j.abi.datatypes.generated.Uint256;
import org.web3j.abi.datatypes.generated.Uint64;
import org.web3j.crypto.Credentials;
import org.web3j.crypto.ECKeyPair;
import org.web3j.crypto.Keys;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.DefaultBlockParameterName;
import org.web3j.protocol.core.methods.request.Transaction;
import org.web3j.protocol.core.methods.response.EthCall;
import org.web3j.protocol.core.methods.response.EthSendTransaction;
import org.web3j.protocol.core.methods.response.TransactionReceipt;
import org.web3j.protocol.http.HttpService;
import org.web3j.tx.RawTransactionManager;
import org.web3j.tx.response.PollingTransactionReceiptProcessor;
import org.web3j.utils.Numeric;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@EnabledIfSystemProperty(named = "liveAnvilE2e", matches = "true")
class LiveAnvilFullStackE2ETest {

    private static final long CHAIN_ID = 31337L;
    private static final BigInteger GAS_PRICE = BigInteger.valueOf(2_000_000_000L);
    private static final BigInteger GAS_LIMIT = BigInteger.valueOf(600_000L);
    private static final BigInteger FIFTY_AVAX_WEI = new BigInteger("50000000000000000000");

    @LocalServerPort
    private int serverPort;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private BlockchainEventIndexerService blockchainEventIndexerService;

    @Autowired
    private DealEventRepository dealEventRepository;

    @DynamicPropertySource
    static void bindLiveAnvilProperties(DynamicPropertyRegistry registry) {
        String rpcUrl = System.getProperty("liveAnvilRpcUrl", "http://127.0.0.1:8545");
        String contract = System.getProperty("liveAnvilContract", "");
        String dbUrl = System.getProperty(
            "liveAnvilDbUrl",
            "jdbc:h2:mem:safedeal_live_e2e;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1"
        );
        String dbUser = System.getProperty("liveAnvilDbUser", dbUrl.startsWith("jdbc:postgresql:") ? "safedeal" : "sa");
        String dbPass = System.getProperty("liveAnvilDbPassword", dbUrl.startsWith("jdbc:postgresql:") ? "safedeal" : "");
        String dbDriver = System.getProperty(
            "liveAnvilDbDriver",
            dbUrl.startsWith("jdbc:postgresql:") ? "org.postgresql.Driver" : "org.h2.Driver"
        );
        registry.add("spring.datasource.url", () -> dbUrl);
        registry.add("spring.datasource.username", () -> dbUser);
        registry.add("spring.datasource.password", () -> dbPass);
        registry.add("spring.datasource.driver-class-name", () -> dbDriver);
        registry.add("safedeal.blockchain.enabled", () -> "true");
        registry.add("safedeal.blockchain.rpc-url", () -> rpcUrl);
        registry.add("safedeal.blockchain.escrow-contract-address", () -> contract);
        registry.add("safedeal.blockchain.chain-id", () -> "31337");
        registry.add("safedeal.blockchain.confirmations-required", () -> "1");
        registry.add("safedeal.blockchain.deployment-block", () -> "0");
    }

    private static final class ActorClient {
        final ECKeyPair keyPair;
        final Credentials credentials;
        final String address;
        final CookieManager cookies;
        final HttpClient http;
        final RawTransactionManager txManager;

        ActorClient(Web3j web3j, ECKeyPair keyPair) {
            this.keyPair = keyPair;
            this.credentials = Credentials.create(keyPair);
            this.address = ("0x" + Keys.getAddress(keyPair)).toLowerCase();
            this.cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
            this.http = HttpClient.newBuilder().cookieHandler(this.cookies).build();
            this.txManager = new RawTransactionManager(web3j, credentials, CHAIN_ID);
        }

        String csrfToken() {
            return cookies.getCookieStore().getCookies().stream()
                .filter(c -> "safedeal_csrf".equals(c.getName()))
                .map(HttpCookie::getValue)
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing safedeal_csrf cookie for " + address));
        }
    }

    @Test
    void runsFullMultiActorEscrowDisputeArbitrationAndIndexerFlowAgainstLiveAnvil() throws Exception {
        String rpcUrl = System.getProperty("liveAnvilRpcUrl", "http://127.0.0.1:8545");
        String contractAddress = System.getProperty("liveAnvilContract");
        assertThat(contractAddress).matches("^0x[0-9a-fA-F]{40}$");
        String baseUrl = "http://127.0.0.1:" + serverPort;

        Web3j web3j = Web3j.build(new HttpService(rpcUrl));
        PollingTransactionReceiptProcessor receiptProcessor =
            new PollingTransactionReceiptProcessor(web3j, 150, 40);

        try {
            ActorClient seller = new ActorClient(web3j, Keys.createEcKeyPair());
            ActorClient buyer = new ActorClient(web3j, Keys.createEcKeyPair());
            ActorClient arbiter = new ActorClient(web3j, Keys.createEcKeyPair());
            ActorClient outsider = new ActorClient(web3j, Keys.createEcKeyPair());

            fundOnAnvil(rpcUrl, seller.address);
            fundOnAnvil(rpcUrl, buyer.address);
            fundOnAnvil(rpcUrl, arbiter.address);
            fundOnAnvil(rpcUrl, outsider.address);

            siweAuthenticate(baseUrl, seller);
            siweAuthenticate(baseUrl, buyer);
            siweAuthenticate(baseUrl, arbiter);
            siweAuthenticate(baseUrl, outsider);

            // =========================================================================
            // Flow 1: Cooperative Deal Lifecycle (Draft -> Chain Create -> Bind -> Fund -> Deliver -> Release -> Pull Withdraw)
            // =========================================================================
            long latestBlockTs = web3j.ethGetBlockByNumber(DefaultBlockParameterName.LATEST, false)
                .send().getBlock().getTimestamp().longValue();
            long baseEpoch = Math.max(Instant.now().getEpochSecond(), latestBlockTs);
            long fundingDeadline1 = baseEpoch + 3600;
            long deliveryDeadline1 = baseEpoch + 7200;
            BigInteger oneAvaxWei = new BigInteger("1000000000000000000");

            HttpResponse<String> draft1Res = postJson(
                baseUrl + "/api/v1/deals/drafts",
                seller,
                Map.of(
                    "title", "Live Anvil Consulting Agreement",
                    "description", "End-to-end Avalanche escrow verification engagement",
                    "amountWei", oneAvaxWei.toString(),
                    "buyerAddress", buyer.address,
                    "arbiterAddress", arbiter.address,
                    "fundingDeadlineEpochSeconds", fundingDeadline1,
                    "deliveryDeadlineEpochSeconds", deliveryDeadline1,
                    "inspectionWindowSeconds", 86400,
                    "terms", "Seller delivers signed build artifact before inspection release."
                )
            );
            assertThat(draft1Res.statusCode()).isEqualTo(201);
            JsonNode draft1Json = objectMapper.readTree(draft1Res.body());
            String tradeId1 = draft1Json.get("tradeId").asText();
            String termsHash1 = draft1Json.get("termsHash").asText();

            String createTx1 = sendEscrowTx(
                seller,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function(
                    "createTrade",
                    List.of(
                        new Bytes32(Numeric.hexStringToByteArray(tradeId1)),
                        new Address(buyer.address),
                        new Address(arbiter.address),
                        new Uint256(oneAvaxWei),
                        new Bytes32(Numeric.hexStringToByteArray(termsHash1)),
                        new Uint64(fundingDeadline1),
                        new Uint64(deliveryDeadline1),
                        new Uint64(86400L)
                    ),
                    List.of()
                )
            );

            HttpResponse<String> bind1Res = postJson(
                baseUrl + "/api/v1/deals/" + tradeId1 + "/bind-tx",
                seller,
                Map.of("txHash", createTx1)
            );
            assertThat(bind1Res.statusCode()).isEqualTo(200);
            JsonNode bind1Json = objectMapper.readTree(bind1Res.body());
            assertThat(bind1Json.get("status").asText()).isEqualTo("CREATED");
            assertThat(bind1Json.get("onChainBound").asBoolean()).isTrue();
            assertThat(bind1Json.get("createTxHash").asText()).isEqualTo(createTx1.toLowerCase());

            String fundTx1 = sendEscrowTx(
                buyer,
                receiptProcessor,
                contractAddress,
                oneAvaxWei,
                new Function("fundTrade", List.of(new Bytes32(Numeric.hexStringToByteArray(tradeId1))), List.of())
            );
            HttpResponse<String> syncFund1Res = postJson(
                baseUrl + "/api/v1/deals/" + tradeId1 + "/sync",
                buyer,
                Map.of("txHash", fundTx1)
            );
            assertThat(syncFund1Res.statusCode()).isEqualTo(200);
            JsonNode syncFund1Json = objectMapper.readTree(syncFund1Res.body());
            assertThat(syncFund1Json.get("status").asText()).isEqualTo("FUNDED");
            assertThat(syncFund1Json.get("createTxHash").asText()).isEqualTo(createTx1.toLowerCase());

            String deliverTx1 = sendEscrowTx(
                seller,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function("markDelivered", List.of(new Bytes32(Numeric.hexStringToByteArray(tradeId1))), List.of())
            );
            HttpResponse<String> syncDeliver1Res = postJson(
                baseUrl + "/api/v1/deals/" + tradeId1 + "/sync",
                seller,
                Map.of("txHash", deliverTx1)
            );
            assertThat(syncDeliver1Res.statusCode()).isEqualTo(200);
            assertThat(objectMapper.readTree(syncDeliver1Res.body()).get("status").asText()).isEqualTo("DELIVERED");

            String releaseTx1 = sendEscrowTx(
                buyer,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function("releaseFunds", List.of(new Bytes32(Numeric.hexStringToByteArray(tradeId1))), List.of())
            );
            HttpResponse<String> syncRelease1Res = postJson(
                baseUrl + "/api/v1/deals/" + tradeId1 + "/sync",
                buyer,
                Map.of("txHash", releaseTx1)
            );
            assertThat(syncRelease1Res.statusCode()).isEqualTo(200);
            JsonNode release1Json = objectMapper.readTree(syncRelease1Res.body());
            assertThat(release1Json.get("status").asText()).isEqualTo("RELEASED");
            assertThat(release1Json.get("settled").asBoolean()).isTrue();

            assertThat(readClaimableBalance(web3j, contractAddress, seller.address)).isEqualTo(oneAvaxWei);
            BigInteger sellerBalBeforeWithdraw1 = web3j.ethGetBalance(seller.address, DefaultBlockParameterName.LATEST)
                .send().getBalance();
            sendEscrowTx(
                seller,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function("withdraw", List.of(), List.of())
            );
            assertThat(readClaimableBalance(web3j, contractAddress, seller.address)).isEqualTo(BigInteger.ZERO);
            BigInteger sellerBalAfterWithdraw1 = web3j.ethGetBalance(seller.address, DefaultBlockParameterName.LATEST)
                .send().getBalance();
            assertThat(sellerBalAfterWithdraw1).isGreaterThan(sellerBalBeforeWithdraw1);

            HttpResponse<String> history1Res = getJson(baseUrl + "/api/v1/deals/" + tradeId1 + "/history", buyer);
            assertThat(history1Res.statusCode()).isEqualTo(200);
            JsonNode history1Json = objectMapper.readTree(history1Res.body());
            assertThat(history1Json.get("events")).hasSize(5);

            // =========================================================================
            // Flow 2: Dispute + Private Evidence + Split Arbitration + Live Indexer Deduplication
            // =========================================================================
            BigInteger twoAvaxWei = new BigInteger("2000000000000000000");
            BigInteger buyerSplitWei = new BigInteger("1500000000000000000");
            BigInteger sellerSplitWei = new BigInteger("500000000000000000");
            long fundingDeadline2 = baseEpoch + 5400;
            long deliveryDeadline2 = baseEpoch + 9000;

            HttpResponse<String> draft2Res = postJson(
                baseUrl + "/api/v1/deals/drafts",
                seller,
                Map.of(
                    "title", "Live Anvil Dispute & Split Arbitration",
                    "description", "Full live contract split arbitration and indexer verification",
                    "amountWei", twoAvaxWei.toString(),
                    "buyerAddress", buyer.address,
                    "arbiterAddress", arbiter.address,
                    "fundingDeadlineEpochSeconds", fundingDeadline2,
                    "deliveryDeadlineEpochSeconds", deliveryDeadline2,
                    "inspectionWindowSeconds", 7200,
                    "terms", "Disputed milestones settled by arbiter pro-rata."
                )
            );
            assertThat(draft2Res.statusCode()).isEqualTo(201);
            JsonNode draft2Json = objectMapper.readTree(draft2Res.body());
            String tradeId2 = draft2Json.get("tradeId").asText();
            String termsHash2 = draft2Json.get("termsHash").asText();

            String createTx2 = sendEscrowTx(
                seller,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function(
                    "createTrade",
                    List.of(
                        new Bytes32(Numeric.hexStringToByteArray(tradeId2)),
                        new Address(buyer.address),
                        new Address(arbiter.address),
                        new Uint256(twoAvaxWei),
                        new Bytes32(Numeric.hexStringToByteArray(termsHash2)),
                        new Uint64(fundingDeadline2),
                        new Uint64(deliveryDeadline2),
                        new Uint64(7200L)
                    ),
                    List.of()
                )
            );
            assertThat(postJson(baseUrl + "/api/v1/deals/" + tradeId2 + "/bind-tx", seller, Map.of("txHash", createTx2)).statusCode())
                .isEqualTo(200);

            String fundTx2 = sendEscrowTx(
                buyer,
                receiptProcessor,
                contractAddress,
                twoAvaxWei,
                new Function("fundTrade", List.of(new Bytes32(Numeric.hexStringToByteArray(tradeId2))), List.of())
            );
            assertThat(postJson(baseUrl + "/api/v1/deals/" + tradeId2 + "/sync", buyer, Map.of("txHash", fundTx2)).statusCode())
                .isEqualTo(200);

            String openDisputeTx2 = sendEscrowTx(
                buyer,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function("openDispute", List.of(new Bytes32(Numeric.hexStringToByteArray(tradeId2))), List.of())
            );

            HttpResponse<String> disputeRes = postJson(
                baseUrl + "/api/v1/deals/" + tradeId2 + "/disputes",
                buyer,
                Map.of(
                    "reason", "Partial delivery defect",
                    "summary", "Delivered package missed two core acceptance components.",
                    "txHash", openDisputeTx2
                )
            );
            assertThat(disputeRes.statusCode()).isEqualTo(201);
            long disputeId = objectMapper.readTree(disputeRes.body()).get("id").asLong();

            byte[] pngPayload = new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02};
            HttpResponse<String> uploadRes = postMultipartPng(
                baseUrl + "/api/v1/disputes/" + disputeId + "/evidence",
                buyer,
                "Defect Proof PNG",
                "Screenshot confirming failed inspection run.",
                "proof-live.png",
                pngPayload
            );
            assertThat(uploadRes.statusCode()).isEqualTo(201);
            long evidenceId = objectMapper.readTree(uploadRes.body()).get("id").asLong();

            HttpResponse<byte[]> outsiderDownload = getBytes(
                baseUrl + "/api/v1/disputes/" + disputeId + "/evidence/" + evidenceId + "/download",
                outsider
            );
            assertThat(outsiderDownload.statusCode()).isEqualTo(403);

            HttpResponse<byte[]> arbiterDownload = getBytes(
                baseUrl + "/api/v1/disputes/" + disputeId + "/evidence/" + evidenceId + "/download",
                arbiter
            );
            assertThat(arbiterDownload.statusCode()).isEqualTo(200);
            assertThat(arbiterDownload.body()).isEqualTo(pngPayload);

            String resolveTx2 = sendEscrowTx(
                arbiter,
                receiptProcessor,
                contractAddress,
                BigInteger.ZERO,
                new Function(
                    "resolveDispute",
                    List.of(
                        new Bytes32(Numeric.hexStringToByteArray(tradeId2)),
                        new Uint256(buyerSplitWei),
                        new Uint256(sellerSplitWei)
                    ),
                    List.of()
                )
            );

            HttpResponse<String> resolveApiRes = postJson(
                baseUrl + "/api/v1/arbitration/disputes/" + disputeId + "/resolution",
                arbiter,
                Map.of(
                    "txHash", resolveTx2,
                    "rationale", "75% refunded to buyer, 25% awarded to seller per inspection evidence."
                )
            );
            assertThat(resolveApiRes.statusCode()).isEqualTo(200);
            JsonNode resolvedJson = objectMapper.readTree(resolveApiRes.body());
            assertThat(resolvedJson.get("status").asText()).isEqualTo("RESOLVED");
            assertThat(resolvedJson.get("buyerAwardWei").asText()).isEqualTo(buyerSplitWei.toString());
            assertThat(resolvedJson.get("sellerAwardWei").asText()).isEqualTo(sellerSplitWei.toString());

            // Poll live Anvil logs via BlockchainEventIndexerService twice -> idempotent, zero duplicate deal_events
            blockchainEventIndexerService.pollAndIndex();
            int countAfterFirstPoll = dealEventRepository.findByTradeIdOrderByCreatedAtAsc(tradeId2).size();
            int secondPollInserted = blockchainEventIndexerService.pollAndIndex();
            int countAfterSecondPoll = dealEventRepository.findByTradeIdOrderByCreatedAtAsc(tradeId2).size();
            assertThat(secondPollInserted).isEqualTo(0);
            assertThat(countAfterSecondPoll).isEqualTo(countAfterFirstPoll);

            // Buyer and seller each withdraw split proceeds via pull-payment on Anvil
            assertThat(readClaimableBalance(web3j, contractAddress, buyer.address)).isEqualTo(buyerSplitWei);
            assertThat(readClaimableBalance(web3j, contractAddress, seller.address)).isEqualTo(sellerSplitWei);

            BigInteger buyerBefore = web3j.ethGetBalance(buyer.address, DefaultBlockParameterName.LATEST).send().getBalance();
            BigInteger sellerBefore = web3j.ethGetBalance(seller.address, DefaultBlockParameterName.LATEST).send().getBalance();

            sendEscrowTx(buyer, receiptProcessor, contractAddress, BigInteger.ZERO, new Function("withdraw", List.of(), List.of()));
            sendEscrowTx(seller, receiptProcessor, contractAddress, BigInteger.ZERO, new Function("withdraw", List.of(), List.of()));

            assertThat(readClaimableBalance(web3j, contractAddress, buyer.address)).isEqualTo(BigInteger.ZERO);
            assertThat(readClaimableBalance(web3j, contractAddress, seller.address)).isEqualTo(BigInteger.ZERO);
            assertThat(web3j.ethGetBalance(buyer.address, DefaultBlockParameterName.LATEST).send().getBalance())
                .isGreaterThan(buyerBefore);
            assertThat(web3j.ethGetBalance(seller.address, DefaultBlockParameterName.LATEST).send().getBalance())
                .isGreaterThan(sellerBefore);
        } finally {
            web3j.shutdown();
        }
    }

    private void fundOnAnvil(String rpcUrl, String address) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
            "jsonrpc", "2.0",
            "method", "anvil_setBalance",
            "params", List.of(address, "0x" + FIFTY_AVAX_WEI.toString(16)),
            "id", 1
        ));
        HttpRequest req = HttpRequest.newBuilder(URI.create(rpcUrl))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        HttpResponse<String> res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(objectMapper.readTree(res.body()).has("error")).isFalse();
    }

    private void siweAuthenticate(String baseUrl, ActorClient actor) throws Exception {
        String nonceBody = objectMapper.writeValueAsString(Map.of("address", actor.address, "chainId", CHAIN_ID));
        HttpRequest nonceReq = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/auth/nonce"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(nonceBody))
            .build();
        HttpResponse<String> nonceRes = actor.http.send(nonceReq, HttpResponse.BodyHandlers.ofString());
        assertThat(nonceRes.statusCode()).isEqualTo(200);

        String message = objectMapper.readTree(nonceRes.body()).get("message").asText();
        String sig = SiweAuthAndSecurityIntegrationTest.signPersonalMessage(actor.keyPair, message);

        String verifyBody = objectMapper.writeValueAsString(Map.of("message", message, "signature", sig));
        HttpRequest verifyReq = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/auth/verify"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(verifyBody))
            .build();
        HttpResponse<String> verifyRes = actor.http.send(verifyReq, HttpResponse.BodyHandlers.ofString());
        assertThat(verifyRes.statusCode()).isEqualTo(200);
    }

    private HttpResponse<String> postJson(String url, ActorClient actor, Object payload) throws Exception {
        String json = objectMapper.writeValueAsString(payload);
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/json")
            .header("X-CSRF-Token", actor.csrfToken())
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        return actor.http.send(req, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> getJson(String url, ActorClient actor) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).GET().build();
        return actor.http.send(req, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<byte[]> getBytes(String url, ActorClient actor) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).GET().build();
        return actor.http.send(req, HttpResponse.BodyHandlers.ofByteArray());
    }

    private HttpResponse<String> postMultipartPng(
        String url,
        ActorClient actor,
        String title,
        String notes,
        String filename,
        byte[] fileBytes
    ) throws Exception {
        String boundary = "----SafeDealBoundary" + UUID.randomUUID().toString().replace("-", "");
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        writeTextPart(bos, boundary, "title", title);
        writeTextPart(bos, boundary, "notes", notes);
        bos.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        bos.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n").getBytes(StandardCharsets.UTF_8));
        bos.write("Content-Type: image/png\r\n\r\n".getBytes(StandardCharsets.UTF_8));
        bos.write(fileBytes);
        bos.write("\r\n".getBytes(StandardCharsets.UTF_8));
        bos.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .header("X-CSRF-Token", actor.csrfToken())
            .POST(HttpRequest.BodyPublishers.ofByteArray(bos.toByteArray()))
            .build();
        return actor.http.send(req, HttpResponse.BodyHandlers.ofString());
    }

    private static void writeTextPart(ByteArrayOutputStream bos, String boundary, String name, String value) throws Exception {
        bos.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        bos.write(("Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        bos.write(value.getBytes(StandardCharsets.UTF_8));
        bos.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }

    private static String sendEscrowTx(
        ActorClient sender,
        PollingTransactionReceiptProcessor receiptProcessor,
        String contractAddress,
        BigInteger valueWei,
        Function fn
    ) throws Exception {
        String encoded = FunctionEncoder.encode(fn);
        EthSendTransaction sent = sender.txManager.sendTransaction(GAS_PRICE, GAS_LIMIT, contractAddress, encoded, valueWei);
        assertThat(sent.hasError()).as("Transaction broadcast error: %s", sent.hasError() ? sent.getError().getMessage() : "").isFalse();
        TransactionReceipt receipt = receiptProcessor.waitForTransactionReceipt(sent.getTransactionHash());
        assertThat(receipt.isStatusOK()).as("Transaction reverted: %s", sent.getTransactionHash()).isTrue();
        return sent.getTransactionHash();
    }

    @SuppressWarnings("rawtypes")
    private static BigInteger readClaimableBalance(Web3j web3j, String contractAddress, String account) throws Exception {
        Function fn = new Function(
            "claimableBalances",
            List.of(new Address(account)),
            List.of(new TypeReference<Uint256>() {})
        );
        EthCall call = web3j.ethCall(
            Transaction.createEthCallTransaction(account, contractAddress, FunctionEncoder.encode(fn)),
            DefaultBlockParameterName.LATEST
        ).send();
        assertThat(call.hasError()).isFalse();
        List<Type> out = FunctionReturnDecoder.decode(call.getValue(), fn.getOutputParameters());
        return ((Uint256) out.get(0)).getValue();
    }
}
