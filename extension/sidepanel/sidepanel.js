/**
 * SafeDeal Escrow Companion — Side Panel Controller
 * Strictly complies with Chrome Extensions MV3 rules:
 * - Zero inline scripts or event handlers
 * - 100% async/await (zero Promise-chain callbacks)
 * - Uses chrome.storage.local for persistence
 */

import { computeCanonicalTermsHash } from "../shared/canonical-terms.js";
import {
  claimableBalance,
  DEFAULT_ESCROW_CONTRACT,
  DEFAULT_WEB_APP_URL,
  fetchDealVerification,
} from "../shared/rpc-client.js";

const SAMPLE_TRADE_ID =
  "0xbf5ef59687168af6140d2ebd15e63b94df1ac4d3206e45f3a2f681cb962ade62";

let lastVerifiedDeal = null;

function shortenHex(value, prefix = 8, suffix = 6) {
  if (!value || typeof value !== "string") return "—";
  if (value.length <= prefix + suffix + 2) return value;
  return `${value.slice(0, prefix)}…${value.slice(-suffix)}`;
}

function formatEpochSeconds(epochSeconds) {
  const num = Number(epochSeconds || 0);
  if (!num) return "—";
  return new Date(num * 1000).toLocaleString();
}

function setBanner(el, text, variant = "ok") {
  el.textContent = text;
  el.className = `status-banner ${variant}`;
}

function activateTab(tabName) {
  const buttons = document.querySelectorAll(".tab-btn");
  for (const btn of buttons) {
    const isMatch = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isMatch);
    btn.setAttribute("aria-selected", String(isMatch));
  }

  const panels = {
    verify: document.getElementById("panel-verify"),
    hash: document.getElementById("panel-hash"),
    watched: document.getElementById("panel-watched"),
  };

  for (const [key, panel] of Object.entries(panels)) {
    if (panel) {
      panel.classList.toggle("active", key === tabName);
    }
  }
}

function renderVerifyResult(data) {
  lastVerifiedDeal = data;
  const card = document.getElementById("verify-result-card");
  card.classList.remove("hidden");

  document.getElementById("res-status-badge").textContent = data.status;
  document.getElementById("res-amount-avax").textContent = `${data.amountAvax} AVAX`;
  document.getElementById("res-trade-id").textContent = data.queriedTradeId;
  document.getElementById("res-terms-hash").textContent = data.termsHash;
  document.getElementById("res-seller").textContent = shortenHex(data.seller);
  document.getElementById("res-buyer").textContent = data.buyer
    ? shortenHex(data.buyer)
    : "Open Buyer (0x0)";
  document.getElementById("res-arbiter").textContent = shortenHex(data.arbiter);
  document.getElementById("res-settled").textContent = data.settled ? "Yes (Claimable)" : "Locked";
  document.getElementById("res-funding-deadline").textContent = formatEpochSeconds(
    data.fundingDeadline
  );
  document.getElementById("res-delivery-deadline").textContent = formatEpochSeconds(
    data.deliveryDeadline
  );
  document.getElementById("res-inspection-window").textContent = data.inspectionWindow
    ? `${data.inspectionWindow}s`
    : "—";

  const votes = data.disputeVotes;
  document.getElementById("res-dispute-votes").textContent = votes
    ? `${votes.activeVoteCount} / 3 votes cast`
    : "0 / 3";

  const snowtraceLink = document.getElementById("res-snowtrace-link");
  snowtraceLink.href = `https://testnet.snowtrace.io/address/${data.contractAddress || DEFAULT_ESCROW_CONTRACT}`;

  const watchBtn = document.getElementById("btn-watch-current");
  watchBtn.disabled = false;
}

async function handleVerifySubmit(event) {
  event.preventDefault();
  const inputEl = document.getElementById("input-trade-id");
  const banner = document.getElementById("verify-status-banner");
  const rawValue = inputEl.value.trim();
  if (!rawValue) return;

  setBanner(banner, "Querying Avalanche Fuji C-Chain RPC (eth_call)…", "warn");

  try {
    const data = await fetchDealVerification(rawValue);
    renderVerifyResult(data);

    if (data.existsOnChain) {
      const hashNote =
        data.termsVerified === true
          ? " • Off-chain RFC 8785 termsHash verified!"
          : "";
      setBanner(
        banner,
        `On-chain trade found (${data.status} • ${data.amountAvax} AVAX)${hashNote}`,
        "ok"
      );
    } else {
      setBanner(
        banner,
        "Queried Avalanche Fuji contract: tradeId is currently NONE (not yet created on-chain).",
        "warn"
      );
    }
  } catch (err) {
    setBanner(
      banner,
      err instanceof Error ? err.message : "Failed to verify deal on-chain.",
      "error"
    );
  }
}

async function renderWatchedDeals() {
  const container = document.getElementById("watched-deals-list");
  const { watchedDeals = [] } = await chrome.storage.local.get("watchedDeals");

  container.replaceChildren();
  if (!Array.isArray(watchedDeals) || watchedDeals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = 'No watched deals yet. Verify a deal and click "+ Watch Deal".';
    container.appendChild(empty);
    return;
  }

  for (const item of watchedDeals) {
    const row = document.createElement("div");
    row.className = "watched-item";

    const top = document.createElement("div");
    top.className = "watched-item-top";

    const badge = document.createElement("span");
    badge.className = "deal-status-badge";
    badge.textContent = `${item.status || "NONE"} • ${item.amountAvax || "0"} AVAX`;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:4px;";

    const inspectBtn = document.createElement("button");
    inspectBtn.type = "button";
    inspectBtn.className = "ghost-btn";
    inspectBtn.textContent = "Inspect";
    inspectBtn.addEventListener("click", async () => {
      document.getElementById("input-trade-id").value = item.tradeId;
      activateTab("verify");
      document.getElementById("form-verify-deal").requestSubmit();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost-btn";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      const current = await chrome.storage.local.get("watchedDeals");
      const next = (current.watchedDeals || []).filter((d) => d.tradeId !== item.tradeId);
      await chrome.storage.local.set({ watchedDeals: next });
      await renderWatchedDeals();
    });

    actions.appendChild(inspectBtn);
    actions.appendChild(removeBtn);
    top.appendChild(badge);
    top.appendChild(actions);

    const idLine = document.createElement("div");
    idLine.className = "mono break-all";
    idLine.style.cssText = "font-size:11px;color:#94a3b8;";
    idLine.textContent = item.tradeId;

    row.appendChild(top);
    row.appendChild(idLine);
    container.appendChild(row);
  }
}

async function handleWatchCurrentDeal() {
  if (!lastVerifiedDeal?.queriedTradeId) return;
  const { watchedDeals = [] } = await chrome.storage.local.get("watchedDeals");
  const filtered = watchedDeals.filter((d) => d.tradeId !== lastVerifiedDeal.queriedTradeId);
  filtered.unshift({
    tradeId: lastVerifiedDeal.queriedTradeId,
    status: lastVerifiedDeal.status,
    statusCode: lastVerifiedDeal.statusCode,
    amountAvax: lastVerifiedDeal.amountAvax,
    amountWei: lastVerifiedDeal.amountWei,
    seller: lastVerifiedDeal.seller,
    buyer: lastVerifiedDeal.buyer,
    arbiter: lastVerifiedDeal.arbiter,
    termsHash: lastVerifiedDeal.termsHash,
    updatedAt: Date.now(),
  });
  await chrome.storage.local.set({ watchedDeals: filtered.slice(0, 25) });
  await renderWatchedDeals();

  const banner = document.getElementById("verify-status-banner");
  setBanner(banner, "Added to Watched Deals (auto-polled every minute via chrome.alarms).", "ok");
}

function readTermsFormInput() {
  return {
    version: 1,
    chainId: Number(document.getElementById("hash-chain-id").value || 43113),
    seller: document.getElementById("hash-seller").value,
    buyer: document.getElementById("hash-buyer").value || null,
    arbiter: document.getElementById("hash-arbiter").value,
    amountWei: document.getElementById("hash-amount-wei").value,
    fundingDeadline: Number(document.getElementById("hash-funding-dl").value),
    deliveryDeadline: Number(document.getElementById("hash-delivery-dl").value),
    inspectionWindowSeconds: Number(document.getElementById("hash-inspection").value),
    title: document.getElementById("hash-title").value,
    description: document.getElementById("hash-description").value,
    terms: document.getElementById("hash-terms").value,
  };
}

async function recomputeTermsHash() {
  const input = readTermsFormInput();
  const { canonicalJson, termsHash } = await computeCanonicalTermsHash(input);
  document.getElementById("output-terms-hash").textContent = termsHash;
  document.getElementById("output-canonical-json").textContent = canonicalJson;
  return { canonicalJson, termsHash, input };
}

async function loadDraftSelectionFromStorage() {
  const { draftSelection } = await chrome.storage.local.get("draftSelection");
  const banner = document.getElementById("captured-selection-banner");
  if (!draftSelection || !draftSelection.terms) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  const sourceTitleEl = document.getElementById("captured-source-title");
  sourceTitleEl.textContent = draftSelection.sourceTitle
    ? `${draftSelection.sourceTitle} (${draftSelection.sourceUrl || "page selection"})`
    : draftSelection.sourceUrl || "Captured from context menu";

  document.getElementById("hash-terms").value = draftSelection.terms;
  if (draftSelection.sourceTitle) {
    document.getElementById("hash-title").value = draftSelection.sourceTitle.slice(0, 80);
  }
  activateTab("hash");
  await recomputeTermsHash();
  await chrome.action.setBadgeText({ text: "" });
}

async function handleClaimableCheck(event) {
  event.preventDefault();
  const addrInput = document.getElementById("input-wallet-address");
  const banner = document.getElementById("claimable-result");
  const address = addrInput.value.trim();
  if (!address) return;

  setBanner(banner, "Checking claimableBalances(address) on Avalanche Fuji…", "warn");
  try {
    const res = await claimableBalance(address);
    setBanner(
      banner,
      `Claimable Pull-Payment Balance: ${res.claimableAvax} AVAX (${res.claimableWei} wei)`,
      res.hasClaimable ? "ok" : "warn"
    );
  } catch (err) {
    setBanner(
      banner,
      err instanceof Error ? err.message : "Failed to query claimable balance.",
      "error"
    );
  }
}

async function initSidePanel() {
  // Tab switching
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => {
      activateTab(btn.dataset.tab);
    });
  }

  // View 1: On-Chain Verifier
  document.getElementById("form-verify-deal").addEventListener("submit", handleVerifySubmit);
  document.getElementById("btn-watch-current").addEventListener("click", handleWatchCurrentDeal);
  document.getElementById("btn-fill-sample-trade").addEventListener("click", () => {
    document.getElementById("input-trade-id").value = SAMPLE_TRADE_ID;
    document.getElementById("form-verify-deal").requestSubmit();
  });

  // View 2: RFC 8785 Terms Hash & Draft
  document.getElementById("form-terms-hash").addEventListener("submit", async (e) => {
    e.preventDefault();
    await recomputeTermsHash();
  });

  document.getElementById("btn-template-vector").addEventListener("click", async () => {
    document.getElementById("hash-title").value = "Hardware Wallet Sale";
    document.getElementById("hash-description").value = "Sealed device with tracking";
    document.getElementById("hash-terms").value = "Shipped within 24 hours";
    document.getElementById("hash-amount-wei").value = "1500000000000000000";
    document.getElementById("hash-seller").value = "0x70997970C51812DC3A010C7D01B50E0D17DC79C8";
    document.getElementById("hash-buyer").value = "";
    document.getElementById("hash-arbiter").value = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
    document.getElementById("hash-chain-id").value = "43113";
    document.getElementById("hash-funding-dl").value = "1800000000";
    document.getElementById("hash-delivery-dl").value = "1800086400";
    document.getElementById("hash-inspection").value = "259200";
    await recomputeTermsHash();
  });

  document.getElementById("btn-template-uit-freelance").addEventListener("click", async () => {
    document.getElementById("hash-title").value = "Freelance Đồ án UI/UX & Web3 DApp (SEApp UIT)";
    document.getElementById("hash-description").value =
      "Thiết kế Figma + Frontend React/TypeScript bàn giao qua GitHub repo";
    document.getElementById("hash-terms").value =
      "Bàn giao source code pass CI + tài liệu hướng dẫn chạy local trong 72h; nghiệm thu trong 24h.";
    document.getElementById("hash-amount-wei").value = "2500000000000000000";
    await recomputeTermsHash();
  });

  document.getElementById("btn-copy-terms-hash").addEventListener("click", async () => {
    const text = document.getElementById("output-terms-hash").textContent.trim();
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById("btn-copy-terms-hash");
    btn.textContent = "Copied!";
    setTimeout(() => {
      btn.textContent = "Copy Hash";
    }, 1500);
  });

  document.getElementById("btn-open-create-dapp").addEventListener("click", async () => {
    const { input, termsHash } = await recomputeTermsHash();
    const { webAppUrl = DEFAULT_WEB_APP_URL } = await chrome.storage.local.get("webAppUrl");
    const params = new URLSearchParams({
      title: input.title,
      description: input.description,
      terms: input.terms,
      termsHash,
    });
    await chrome.tabs.create({
      url: `${webAppUrl.replace(/\/+$/, "")}/create?${params.toString()}`,
    });
  });

  document.getElementById("btn-clear-selection").addEventListener("click", async () => {
    await chrome.storage.local.set({ draftSelection: null });
    document.getElementById("captured-selection-banner").classList.add("hidden");
  });

  // View 3: Watched Deals & Claimable AVAX
  document.getElementById("form-claimable").addEventListener("submit", handleClaimableCheck);
  document.getElementById("btn-refresh-watched").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "REFRESH_WATCHED_DEALS" });
    await renderWatchedDeals();
  });

  document
    .getElementById("btn-request-scan-permission")
    .addEventListener("click", async () => {
      const statusEl = document.getElementById("permission-status");
      const response = await chrome.runtime.sendMessage({
        type: "REQUEST_MARKETPLACE_SCAN_PERMISSION",
      });
      if (response?.granted) {
        setBanner(statusEl, "Cross-site marketplace link scanner enabled!", "ok");
      } else {
        setBanner(statusEl, "Permission request declined; scanner active on SafeDeal only.", "warn");
      }
    });

  await recomputeTermsHash();
  await renderWatchedDeals();
  await loadDraftSelectionFromStorage();

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.draftSelection?.newValue) {
      await loadDraftSelectionFromStorage();
    }
    if (changes.watchedDeals) {
      await renderWatchedDeals();
    }
  });
}

initSidePanel();
