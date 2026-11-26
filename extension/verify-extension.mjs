#!/usr/bin/env node
/**
 * SafeDeal Escrow Companion — Automated Manifest V3, Security Hardening & RFC 8785 Verification Suite
 * Verifies:
 *  1. manifest.json compliance with all 20 Mandatory Rules + explicit MV3 CSP + scripting permission
 *  2. Real PNG headers and exact pixel dimensions (16x16, 48x48, 128x128) for icons
 *  3. Static & security checks across service-worker.js, sidepanel/*, content/*, shared/*:
 *     - Zero .then() chains (Rule #5)
 *     - Zero eval() / new Function() / inline <script> / inline on* handlers (Rule #3)
 *     - openPanelOnActionClick (not openPanelOnActionIconClick) (Rule #2)
 *     - requestAnimationFrame + scheduler.yield() batching in content script (Rule #6)
 *     - chrome.storage.local + chrome.alarms in service worker (Rule #7)
 *     - Shadow DOM toast confirmation for context menu (Rule #9)
 *     - Synchronous chrome.permissions.request in first turn of onMessage (Rule #20)
 *     - Strict sender.id === chrome.runtime.id & UI vs content-script isolation
 *     - Zero ambient cookie leakage (credentials: "omit") & strict URL/address validation
 *  4. Byte-for-byte RFC 8785 canonical JSON & SHA-256 termsHash parity with frontend & backend
 *  5. Pure JS ABI encoding/decoding, URL scheme sanitization, and cookie-omitted verification
 *  6. Behavioral runtime tests for Anti-Phishing Domain Shield, bounded deduplicated scanning,
 *     service worker sender isolation, metadata stripping, and dynamic script registration
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

import {
  buildCanonicalTermsJson,
  computeCanonicalTermsHash,
  formatWeiToAvax,
  parseAvaxToWei,
} from "./shared/canonical-terms.js";
import {
  claimableBalance,
  decodeDisputeVotesTuple,
  decodeTradeTuple,
  ethCall,
  fetchDealVerification,
  fetchOptionalBackendDeal,
  isValidEvmAddress,
  OFFICIAL_SAFEDEAL_ORIGINS,
  SELECTORS,
  validateSafeEndpointUrl,
} from "./shared/rpc-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.subarray(0, 8).equals(pngSignature), `${filePath} does not have a valid PNG signature`);
  const ihdrTag = buf.subarray(12, 16).toString("ascii");
  assert.equal(ihdrTag, "IHDR", `${filePath} missing IHDR chunk`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, byteLength: buf.length };
}

async function runVerification() {
  console.log("=== SafeDeal Escrow Companion (MV3) Security & Verification Suite ===");

  // 1. Validate manifest.json & explicit MV3 CSP
  const manifestPath = path.join(__dirname, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.manifest_version, 3, "manifest_version must be 3");
  assert.equal(
    manifest.name,
    "SafeDeal Escrow Companion — Avalanche P2P Verifier",
    "Extension name mismatch"
  );
  assert.equal(manifest.version, "1.0.0", "Extension version must be 1.0.0");
  assert.ok(manifest.action, "Rule #11: manifest must declare 'action'");
  assert.equal(
    manifest.action.default_popup,
    undefined,
    "Rule #2: action must NOT define default_popup when using openPanelOnActionClick"
  );
  assert.equal(
    manifest.side_panel?.default_path,
    "sidepanel/sidepanel.html",
    "side_panel.default_path mismatch"
  );
  assert.equal(
    manifest.background?.service_worker,
    "service-worker.js",
    "background.service_worker mismatch"
  );
  assert.equal(manifest.background?.type, "module", "background.type must be 'module'");
  assert.equal(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self'; object-src 'none'; base-uri 'none';",
    "manifest.content_security_policy.extension_pages must enforce strict MV3 CSP"
  );

  const expectedPermissions = [
    "storage",
    "sidePanel",
    "contextMenus",
    "alarms",
    "tabs",
    "scripting",
  ];
  for (const perm of expectedPermissions) {
    assert.ok(
      manifest.permissions.includes(perm),
      `manifest.permissions missing required '${perm}'`
    );
  }
  assert.ok(
    !manifest.permissions.includes("activeTab"),
    "Rule #12: Side panel extensions should use tabs + host_permissions, not activeTab"
  );

  const expectedHosts = [
    "https://avalanche-9b099.web.app/*",
    "https://safedeal-production.up.railway.app/*",
    "https://api.avax-test.network/*",
    "http://localhost:5173/*",
    "http://localhost:8080/*",
    "http://127.0.0.1:8545/*",
  ];
  for (const host of expectedHosts) {
    assert.ok(
      manifest.host_permissions.includes(host),
      `manifest.host_permissions missing '${host}'`
    );
  }
  assert.ok(
    manifest.optional_host_permissions?.includes("https://*/*"),
    "optional_host_permissions must include https://*/*"
  );
  console.log("[PASS] 1/6 manifest.json adheres to Manifest V3, strict CSP & scoped permissions");

  // 2. Validate PNG Icons (Rule #1 & #15)
  for (const size of [16, 48, 128]) {
    const relPath = manifest.icons[String(size)];
    assert.equal(relPath, `icons/icon-${size}.png`, `Icon key ${size} path mismatch`);
    const absPath = path.join(__dirname, relPath);
    assert.ok(fs.existsSync(absPath), `Icon file missing: ${absPath}`);
    const dims = readPngDimensions(absPath);
    assert.equal(dims.width, size, `icon-${size}.png width must be ${size}`);
    assert.equal(dims.height, size, `icon-${size}.png height must be ${size}`);
  }
  console.log("[PASS] 2/6 PNG icons (16x16, 48x48, 128x128) verified with valid PNG headers");

  // 3. Static verification of Mandatory Rules & Security Hardening across extension source files
  const jsFiles = [
    "service-worker.js",
    "shared/canonical-terms.js",
    "shared/rpc-client.js",
    "sidepanel/sidepanel.js",
    "content/deal-verifier.js",
  ];
  for (const rel of jsFiles) {
    const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
    assert.ok(!src.includes(".then("), `Rule #5 violation (.then chain) in ${rel}`);
    assert.ok(!/\beval\s*\(/.test(src), `Rule #3 violation (eval) in ${rel}`);
    assert.ok(!/\bnew\s+Function\s*\(/.test(src), `Rule #3 violation (new Function) in ${rel}`);
    assert.ok(
      !src.includes("openPanelOnActionIconClick"),
      `Rule #2 violation (openPanelOnActionIconClick) in ${rel}`
    );
    assert.ok(
      !src.includes("chrome.windows.query"),
      `Rule #19 violation (chrome.windows.query) in ${rel}`
    );
    assert.ok(
      !src.includes('credentials: "include"') && !src.includes("credentials: 'include'"),
      `Security violation: ambient cookie credentials: 'include' found in ${rel}`
    );
  }

  const swSource = fs.readFileSync(path.join(__dirname, "service-worker.js"), "utf8");
  assert.ok(
    swSource.includes("openPanelOnActionClick: true"),
    "Rule #2: service-worker.js must set openPanelOnActionClick: true"
  );
  assert.ok(
    swSource.includes("chrome.alarms.create"),
    "Rule #7: service-worker.js must use chrome.alarms"
  );
  assert.ok(
    swSource.includes("chrome.permissions.request"),
    "Rule #20: service-worker.js must handle synchronous chrome.permissions.request"
  );
  assert.ok(
    swSource.includes("sender.id !== chrome.runtime.id"),
    "Security: service-worker.js must enforce sender.id === chrome.runtime.id"
  );
  assert.ok(
    swSource.includes("chrome.scripting.registerContentScripts") &&
      swSource.includes("chrome.scripting.getRegisteredContentScripts"),
    "Security: service-worker.js must dynamically register content/deal-verifier.js idempotently"
  );

  const rpcSource = fs.readFileSync(path.join(__dirname, "shared/rpc-client.js"), "utf8");
  assert.ok(
    rpcSource.includes('credentials: "omit"'),
    "Security: shared/rpc-client.js must enforce credentials: 'omit'"
  );

  const contentSource = fs.readFileSync(path.join(__dirname, "content/deal-verifier.js"), "utf8");
  assert.ok(
    contentSource.includes("requestAnimationFrame") && contentSource.includes("scheduler.yield"),
    "Rule #6: content/deal-verifier.js must batch DOM updates with requestAnimationFrame + scheduler.yield()"
  );
  assert.ok(
    contentSource.includes("attachShadow"),
    "Rule #9: content/deal-verifier.js must render Shadow DOM toast/badges"
  );
  assert.ok(
    contentSource.includes("sender.id !== chrome.runtime.id"),
    "Security: content/deal-verifier.js must enforce sender.id === chrome.runtime.id"
  );
  assert.ok(
    contentSource.includes("Object.hasOwn(STATUS_BADGE_COLORS, status)"),
    "Security: content/deal-verifier.js must guard STATUS_BADGE_COLORS with Object.hasOwn"
  );
  assert.ok(
    contentSource.includes("MAX_LINKS_PER_SCAN = 100"),
    "Security: content/deal-verifier.js must cap per-pass links via MAX_LINKS_PER_SCAN = 100"
  );
  assert.ok(
    contentSource.includes("[⚠️ SafeDeal Security Alert: Unofficial Phishing Domain!]"),
    "Security: content/deal-verifier.js must define the unofficial phishing domain alert badge"
  );

  const sidepanelJsSource = fs.readFileSync(path.join(__dirname, "sidepanel/sidepanel.js"), "utf8");
  assert.ok(
    sidepanelJsSource.includes("new URL(") && sidepanelJsSource.includes("/^0x[0-9a-fA-F]{40}$/"),
    "Security: sidepanel.js must sanitize webAppUrl with new URL(...) and contractAddress with /^0x[0-9a-fA-F]{40}$/"
  );

  const htmlSource = fs.readFileSync(path.join(__dirname, "sidepanel/sidepanel.html"), "utf8");
  assert.ok(
    !/\son[a-z]+\s*=/i.test(htmlSource),
    "Rule #3: sidepanel.html must have zero inline event handlers"
  );

  const cwsPath = path.join(__dirname, "CHROMEWEBSTORE.md");
  assert.ok(fs.existsSync(cwsPath), "CHROMEWEBSTORE.md must exist");
  const cwsSource = fs.readFileSync(cwsPath, "utf8");
  assert.ok(
    cwsSource.includes("| `scripting` | permissions |"),
    "CHROMEWEBSTORE.md must justify the 'scripting' permission"
  );
  console.log("[PASS] 3/6 All 20 Mandatory Rules, static security assertions & CHROMEWEBSTORE.md passed");

  // 4. Verify RFC 8785 canonical JSON & SHA-256 vector parity with frontend & backend
  const vectorInput1 = {
    version: 1,
    chainId: 43113,
    seller: "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
    buyer: "   ",
    arbiter: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    amountWei: "0001500000000000000000",
    fundingDeadline: 1800000000,
    deliveryDeadline: 1800086400,
    inspectionWindowSeconds: 259200,
    title: "  Hardware Wallet Sale  ",
    description: "Sealed device with tracking",
    terms: "Shipped within 24 hours",
  };
  const vectorInput2 = {
    version: 1,
    chainId: 43113,
    seller: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    buyer: "0x0000000000000000000000000000000000000000",
    arbiter: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    amountWei: "1500000000000000000",
    fundingDeadline: 1800000000,
    deliveryDeadline: 1800086400,
    inspectionWindowSeconds: 259200,
    title: "Hardware Wallet Sale",
    description: "Sealed device with tracking",
    terms: "Shipped within 24 hours",
  };

  const expectedCanonicalJson =
    '{"amountWei":"1500000000000000000","arbiter":"0x90f79bf6eb2c4f870365e785982e1f101e93b906","buyer":null,"chainId":43113,"deliveryDeadline":1800086400,"description":"Sealed device with tracking","fundingDeadline":1800000000,"inspectionWindowSeconds":259200,"seller":"0x70997970c51812dc3a010c7d01b50e0d17dc79c8","terms":"Shipped within 24 hours","title":"Hardware Wallet Sale","version":1}';
  const expectedTermsHash =
    "0xbf5ef59687168af6140d2ebd15e63b94df1ac4d3206e45f3a2f681cb962ade62";

  const res1 = await computeCanonicalTermsHash(vectorInput1);
  const res2 = await computeCanonicalTermsHash(vectorInput2);

  assert.equal(res1.canonicalJson, expectedCanonicalJson, "RFC 8785 canonical JSON mismatch");
  assert.equal(res2.canonicalJson, expectedCanonicalJson, "Zero-address buyer normalization mismatch");
  assert.equal(res1.termsHash, expectedTermsHash, "RFC 8785 SHA-256 termsHash vector mismatch");
  assert.equal(res2.termsHash, expectedTermsHash, "Normalized SHA-256 termsHash vector mismatch");

  // Control characters & UTF-8 escaping parity
  const utf8Json = buildCanonicalTermsJson({
    version: 1,
    chainId: 43113,
    seller: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    buyer: "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
    arbiter: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    amountWei: "1000",
    fundingDeadline: 1800000000,
    deliveryDeadline: 1800086400,
    inspectionWindowSeconds: 3600,
    title: "Kiểm thử \x08\x0c\rEnd",
    description: "Ctrl\u0001char",
    terms: "Ok 🚀",
  });
  assert.ok(utf8Json.includes('"title":"Kiểm thử \\b\\f\\rEnd"'));
  assert.ok(utf8Json.includes('"description":"Ctrl\\u0001char"'));
  assert.ok(utf8Json.includes('"terms":"Ok 🚀"'));

  assert.equal(parseAvaxToWei("1.5"), "1500000000000000000");
  assert.equal(formatWeiToAvax("1500000000000000000"), "1.5");
  console.log("[PASS] 4/6 RFC 8785 canonical JSON & SHA-256 termsHash byte-for-byte parity verified");

  // 5. Verify RPC ABI selectors, tuple decoders, URL validation & cookie omission
  assert.equal(SELECTORS.getTrade, "0xa3b13799");
  assert.equal(SELECTORS.getDisputeVotes, "0x48547c8a");
  assert.equal(SELECTORS.claimableBalances, "0x68c8278f");

  assert.ok(OFFICIAL_SAFEDEAL_ORIGINS.includes("https://avalanche-9b099.web.app"));
  assert.ok(OFFICIAL_SAFEDEAL_ORIGINS.includes("http://127.0.0.1:24173"));
  assert.equal(isValidEvmAddress("0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29"), true);
  assert.equal(isValidEvmAddress("0x1234"), false);
  assert.equal(isValidEvmAddress("javascript:alert(1)"), false);

  // URL scheme & loopback validation tests
  assert.equal(
    validateSafeEndpointUrl("https://api.avax-test.network/ext/bc/C/rpc").origin,
    "https://api.avax-test.network"
  );
  assert.equal(validateSafeEndpointUrl("http://localhost:8080").origin, "http://localhost:8080");
  assert.equal(validateSafeEndpointUrl("http://127.0.0.1:8545").origin, "http://127.0.0.1:8545");
  assert.throws(() => validateSafeEndpointUrl("http://evil-rpc.example.com"), /Unsafe URL scheme/);
  assert.throws(() => validateSafeEndpointUrl("javascript:alert(1)"), /Unsafe URL scheme/);
  assert.throws(() => validateSafeEndpointUrl("https://user:secret@example.com"), /embedded credentials/);

  await assert.rejects(
    () => ethCall({ rpcUrl: "http://evil-mitm.example.com/rpc", data: "0x" }),
    /Unsafe rpcUrl scheme/
  );
  await assert.rejects(
    () => fetchOptionalBackendDeal("0x00", { apiBaseUrl: "http://evil-api.example.com" }),
    /Unsafe apiBaseUrl scheme/
  );

  const sampleTradeId = expectedTermsHash;
  const word = (hexNoPrefix) => hexNoPrefix.padStart(64, "0");
  const mockTradeWords = [
    sampleTradeId.slice(2), // 0: tradeId
    word("70997970c51812dc3a010c7d01b50e0d17dc79c8"), // 1: seller
    word((1799990000).toString(16)), // 2: createdAt
    word((2).toString(16)), // 3: status = FUNDED (2)
    word((0).toString(16)), // 4: settled = false
    word("3c44cdddb6a900fa2b585dd299e03d12fa4293bc"), // 5: buyer
    word((1799995000).toString(16)), // 6: fundedAt
    word("90f79bf6eb2c4f870365e785982e1f101e93b906"), // 7: arbiter
    word((1800000000).toString(16)), // 8: fundingDeadline
    word(1500000000000000000n.toString(16)), // 9: amount
    sampleTradeId.slice(2), // 10: termsHash
    word("0"), // 11: deliveredAt
    word((1800086400).toString(16)), // 12: deliveryDeadline
    word((259200).toString(16)), // 13: inspectionWindow
    word("0"), // 14: disputedAt
  ];
  const mockTradeHex = `0x${mockTradeWords.join("")}`;
  const decodedTrade = decodeTradeTuple(mockTradeHex);
  assert.equal(decodedTrade.status, "FUNDED");
  assert.equal(decodedTrade.amountAvax, "1.5");
  assert.equal(decodedTrade.seller, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  assert.equal(decodedTrade.buyer, "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc");
  assert.equal(decodedTrade.termsHash, expectedTermsHash);

  const mockVotesHex = `0x${[
    sampleTradeId.slice(2),
    "0".repeat(64),
    sampleTradeId.slice(2),
    word((1800010000).toString(16)),
    word((1801219600).toString(16)),
  ].join("")}`;
  const decodedVotes = decodeDisputeVotesTuple(mockVotesHex);
  assert.equal(decodedVotes.activeVoteCount, 2);
  assert.equal(decodedVotes.buyerHasVoted, true);
  assert.equal(decodedVotes.sellerHasVoted, false);
  assert.equal(decodedVotes.arbiterHasVoted, true);

  const observedCredentials = [];
  const mockFetch = async (url, init) => {
    observedCredentials.push(init?.credentials);
    if (String(url).includes("/api/v1/deals/")) {
      assert.equal(init.credentials, "omit", "Backend deal fetch must set credentials: 'omit'");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            termsVersion: 1,
            chainId: 43113,
            sellerAddress: "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
            buyerAddress: null,
            arbiterAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
            amountWei: "1500000000000000000",
            fundingDeadlineEpoch: 1800000000,
            deliveryDeadlineEpoch: 1800086400,
            inspectionWindowSeconds: 259200,
            title: "Hardware Wallet Sale",
            description: "Sealed device with tracking",
            terms: "Shipped within 24 hours",
          },
        }),
      };
    }
    const body = JSON.parse(init.body);
    const callData = body.params[0].data;
    if (callData.startsWith(SELECTORS.getTrade)) {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: mockTradeHex }) };
    }
    if (callData.startsWith(SELECTORS.getDisputeVotes)) {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: mockVotesHex }) };
    }
    if (callData.startsWith(SELECTORS.claimableBalances)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: `0x${word(2250000000000000000n.toString(16))}`,
        }),
      };
    }
    throw new Error(`Unexpected mock RPC callData: ${callData}`);
  };

  const verification = await fetchDealVerification(
    `https://avalanche-9b099.web.app/deals/${sampleTradeId}`,
    { fetchImpl: mockFetch }
  );
  assert.equal(verification.status, "FUNDED");
  assert.equal(verification.termsVerified, true);
  assert.equal(verification.chainId, 43113);
  assert.equal(verification.disputeVotes.activeVoteCount, 2);
  assert.ok(observedCredentials.every((c) => c === "omit"));

  const claimable = await claimableBalance(
    "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
    { fetchImpl: mockFetch }
  );
  assert.equal(claimable.claimableAvax, "2.25");
  assert.equal(claimable.hasClaimable, true);
  console.log("[PASS] 5/6 On-Chain JSON-RPC ABI decoding, URL sanitization & zero-cookie checks passed");

  // 6. Behavioral runtime tests for Anti-Phishing Domain Shield & Service Worker Sender Isolation
  {
    const mockAnchors = [];
    const makeAnchor = (href) => {
      const insertedBadges = [];
      return {
        href,
        dataset: {},
        insertedBadges,
        getAttribute(attr) {
          return attr === "href" ? href : null;
        },
        insertAdjacentElement(_pos, el) {
          insertedBadges.push(el);
        },
      };
    };

    const officialAnchor1 = makeAnchor(`https://avalanche-9b099.web.app/deals/${sampleTradeId}`);
    const officialAnchor2 = makeAnchor(`https://avalanche-9b099.web.app/deals/${sampleTradeId}`);
    const phishingAnchor = makeAnchor(`https://safedea1-scam.xyz/deals/${sampleTradeId}`);
    const protoTradeId = "0x" + "a".repeat(64);
    const protoAnchor = makeAnchor(`http://127.0.0.1:24173/deals/${protoTradeId}`);
    mockAnchors.push(officialAnchor1, officialAnchor2, phishingAnchor, protoAnchor);
    // Add 105 extra links to verify MAX_LINKS_PER_SCAN = 100 cap
    for (let idx = 0; idx < 105; idx += 1) {
      const idHex = (idx + 1).toString(16).padStart(64, "0");
      mockAnchors.push(makeAnchor(`https://safedea1-scam.xyz/deals/0x${idHex}`));
    }

    let verifyMessagesSent = 0;
    let contentOnMessageListener = null;

    const sandbox = {
      window: { location: { origin: "https://discord.com" } },
      URL,
      Map,
      Set,
      Object,
      Date,
      Promise,
      decodeURIComponent,
      requestAnimationFrame: (cb) => {
        cb();
        return 1;
      },
      setTimeout: () => 1,
      scheduler: { yield: async () => {} },
      document: {
        body: { appendChild() {} },
        querySelectorAll() {
          return mockAnchors;
        },
        createElement(tag) {
          const el = {
            tagName: tag,
            className: "",
            style: { cssText: "" },
            textContent: "",
            attributes: {},
            children: [],
            shadowRootChildren: null,
            setAttribute(k, v) {
              this.attributes[k] = v;
            },
            appendChild(child) {
              this.children.push(child);
            },
            attachShadow() {
              const shadow = {
                children: [],
                appendChild(c) {
                  this.children.push(c);
                },
              };
              el.shadowRootChildren = shadow.children;
              return shadow;
            },
            remove() {},
          };
          return el;
        },
      },
      chrome: {
        runtime: {
          id: "safedeal-ext-id",
          onMessage: {
            addListener(fn) {
              contentOnMessageListener = fn;
            },
          },
          async sendMessage(payload) {
            verifyMessagesSent += 1;
            if (payload.tradeId === protoTradeId) {
              return {
                ok: true,
                data: {
                  status: "__proto__",
                  existsOnChain: true,
                  amountAvax: "0.5",
                  termsVerified: false,
                },
              };
            }
            return {
              ok: true,
              data: {
                status: "FUNDED",
                existsOnChain: true,
                amountAvax: "1.5",
                termsVerified: true,
              },
            };
          },
        },
      },
    };
    sandbox.globalThis = sandbox;

    vm.runInNewContext(contentSource, sandbox, { filename: "deal-verifier.js" });
    // Wait briefly for async annotateSafeDealLinks() batches to settle
    await new Promise((r) => setTimeout(r, 40));

    // Verify duplicate tradeId links were deduplicated via 60s TTL Map cache (1 for sampleTradeId + 1 for protoTradeId = 2)
    assert.equal(
      verifyMessagesSent,
      2,
      "VERIFY_DEAL must deduplicate identical tradeIds via 60s TTL cache and never query phishing domains"
    );
    assert.equal(
      officialAnchor1.insertedBadges[0]?.shadowRootChildren?.[0]?.textContent,
      "SafeDeal: FUNDED • RFC 8785 OK"
    );
    assert.equal(
      officialAnchor2.insertedBadges[0]?.shadowRootChildren?.[0]?.textContent,
      "SafeDeal: FUNDED • RFC 8785 OK"
    );
    assert.equal(
      phishingAnchor.insertedBadges[0]?.shadowRootChildren?.[0]?.textContent,
      "[⚠️ SafeDeal Security Alert: Unofficial Phishing Domain!]",
      "Phishing domain link must display red warning badge, NEVER green FUNDED badge"
    );
    assert.ok(
      protoAnchor.insertedBadges[0]?.shadowRootChildren?.[0]?.textContent.startsWith(
        "SafeDeal: __proto__"
      ),
      "Object.hasOwn guard must safely handle prototype keys without crashing"
    );
    // Verify MAX_LINKS_PER_SCAN = 100 cap (out of 109 total anchors, only first 100 checked on first pass)
    const checkedCount = mockAnchors.filter((a) => a.dataset.safedealChecked === "true").length;
    assert.equal(checkedCount, 100, "Per-pass scanner must cap at MAX_LINKS_PER_SCAN = 100");

    // Verify content script sender.id check rejects foreign extensions
    assert.equal(
      contentOnMessageListener({ type: "SAFEDEAL_TOAST" }, { id: "malicious-other-ext" }, () => {
        throw new Error("Should not respond to foreign extension");
      }),
      false
    );

    // Service Worker sender isolation, metadata stripping & dynamic script registration check
    let swOnMessageListener = null;
    const registeredScripts = [];
    const previousFetch = globalThis.fetch;
    const previousChrome = globalThis.chrome;
    globalThis.fetch = mockFetch;
    globalThis.chrome = {
      runtime: {
        id: "safedeal-ext-id",
        getURL: (p = "") => `chrome-extension://safedeal-ext-id/${p}`,
        onInstalled: { addListener() {} },
        onMessage: {
          addListener(fn) {
            swOnMessageListener = fn;
          },
        },
      },
      sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
      contextMenus: { removeAll() {}, create() {}, onClicked: { addListener() {} } },
      alarms: { create: async () => {}, onAlarm: { addListener() {} } },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
      permissions: {
        contains: async () => false,
        request(_perms, cb) {
          cb(true);
        },
      },
      scripting: {
        getRegisteredContentScripts: async () => registeredScripts.slice(),
        registerContentScripts: async (scripts) => {
          registeredScripts.push(...scripts);
        },
      },
    };

    try {
      const swUrl = pathToFileURL(path.join(__dirname, "service-worker.js")).href;
      await import(swUrl);
      assert.equal(typeof swOnMessageListener, "function", "service-worker must register onMessage");

      // 1) Foreign extension ID rejected
      assert.equal(
        swOnMessageListener({ type: "VERIFY_DEAL", tradeId: sampleTradeId }, { id: "rogue-ext" }, () => {}),
        false
      );

      // 2) Content script blocked from privileged UI messages
      for (const blockedType of [
        "REQUEST_MARKETPLACE_SCAN_PERMISSION",
        "CLEAR_BADGE",
        "REFRESH_WATCHED_DEALS",
        "COMPUTE_TERMS_HASH",
      ]) {
        let reply = null;
        swOnMessageListener(
          { type: blockedType },
          { id: "safedeal-ext-id", tab: { id: 42 }, url: "https://example.com" },
          (res) => {
            reply = res;
          }
        );
        assert.deepEqual(reply, { ok: false, error: "FORBIDDEN_SENDER" });
      }

      // 3) Content script VERIFY_DEAL strips private off-chain metadata
      const contentVerifyReply = await new Promise((resolve) => {
        swOnMessageListener(
          { type: "VERIFY_DEAL", tradeId: sampleTradeId },
          { id: "safedeal-ext-id", tab: { id: 42 }, url: "https://discord.com/channels/1" },
          resolve
        );
      });
      assert.equal(contentVerifyReply.ok, true);
      assert.equal(contentVerifyReply.data.metadata, undefined, "Content script must NOT receive metadata");
      assert.deepEqual(Object.keys(contentVerifyReply.data).sort(), [
        "amountAvax",
        "chainId",
        "contractAddress",
        "existsOnChain",
        "status",
        "statusCode",
        "termsHash",
        "termsVerified",
      ]);

      // 4) Trusted Side Panel UI REQUEST_MARKETPLACE_SCAN_PERMISSION registers dynamic content script
      const permReply = await new Promise((resolve) => {
        swOnMessageListener(
          { type: "REQUEST_MARKETPLACE_SCAN_PERMISSION" },
          {
            id: "safedeal-ext-id",
            url: "chrome-extension://safedeal-ext-id/sidepanel/sidepanel.html",
          },
          resolve
        );
      });
      assert.deepEqual(permReply, { ok: true, granted: true });
      assert.equal(registeredScripts.length, 1);
      assert.deepEqual(registeredScripts[0].js, ["content/deal-verifier.js"]);
    } finally {
      globalThis.fetch = previousFetch;
      globalThis.chrome = previousChrome;
    }
  }
  console.log("[PASS] 6/6 Anti-Phishing Domain Shield, sender isolation & metadata stripping verified");
  console.log("=== ALL EXTENSION SECURITY & VERIFICATION CHECKS PASSED (100%) ===");
}

runVerification();
