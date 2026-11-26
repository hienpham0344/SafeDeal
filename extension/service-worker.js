/**
 * SafeDeal Escrow Companion — Manifest V3 Ephemeral Service Worker
 * Strictly adheres to all 20 Mandatory Rules of the chrome-extensions skill:
 * - Rule #2 & #11: Explicitly sets openPanelOnActionClick: true (no default_popup)
 * - Rule #4: Reads tab.url & tab.title with "tabs" permission declared
 * - Rule #5: 100% async/await (zero Promise-chain callbacks) + return true in onMessage
 * - Rule #7: Zero global mutable state; persists everything in chrome.storage.local + chrome.alarms
 * - Rule #9: Context menu action sets "NEW" badge, opens Side Panel, and triggers Shadow DOM toast
 * - Rule #20: Calls chrome.permissions.request synchronously in the first turn before any await
 */

import { computeCanonicalTermsHash } from "./shared/canonical-terms.js";
import {
  claimableBalance,
  DEFAULT_API_BASE_URL,
  DEFAULT_ESCROW_CONTRACT,
  DEFAULT_FUJI_RPC_URL,
  DEFAULT_WEB_APP_URL,
  fetchDealVerification,
} from "./shared/rpc-client.js";

const CONTEXT_MENU_ID = "safedeal-draft-from-selection";
const ALARM_NAME = "safedeal-poll-deals";
const DYNAMIC_SCANNER_SCRIPT_ID = "safedeal-all-sites-verifier";

async function getStorageConfig() {
  const stored = await chrome.storage.local.get([
    "rpcUrl",
    "contractAddress",
    "apiBaseUrl",
    "webAppUrl",
  ]);
  return {
    rpcUrl: stored.rpcUrl || DEFAULT_FUJI_RPC_URL,
    contractAddress: stored.contractAddress || DEFAULT_ESCROW_CONTRACT,
    apiBaseUrl: stored.apiBaseUrl || DEFAULT_API_BASE_URL,
    webAppUrl: stored.webAppUrl || DEFAULT_WEB_APP_URL,
  };
}

/**
 * Idempotently registers `content/deal-verifier.js` for all HTTPS sites when the user
 * has opted in to cross-site marketplace & anti-phishing link scanning.
 */
async function ensureMarketplaceScannerRegistered() {
  if (!chrome.scripting?.getRegisteredContentScripts || !chrome.scripting?.registerContentScripts) {
    return false;
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_SCANNER_SCRIPT_ID],
  });
  if (Array.isArray(existing) && existing.length > 0) {
    return true;
  }
  await chrome.scripting.registerContentScripts([
    {
      id: DYNAMIC_SCANNER_SCRIPT_ID,
      matches: ["https://*/*"],
      excludeMatches: ["https://avalanche-9b099.web.app/*"],
      js: ["content/deal-verifier.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
  return true;
}

async function pollWatchedDeals() {
  const { watchedDeals = [] } = await chrome.storage.local.get("watchedDeals");
  if (!Array.isArray(watchedDeals) || watchedDeals.length === 0) {
    return [];
  }

  const config = await getStorageConfig();
  const updatedDeals = [];
  let changedCount = 0;

  for (const entry of watchedDeals) {
    if (!entry?.tradeId) continue;
    try {
      const latest = await fetchDealVerification(entry.tradeId, config);
      if (entry.status && entry.status !== latest.status) {
        changedCount += 1;
      }
      updatedDeals.push({
        tradeId: latest.queriedTradeId,
        status: latest.status,
        statusCode: latest.statusCode,
        amountAvax: latest.amountAvax,
        amountWei: latest.amountWei,
        seller: latest.seller,
        buyer: latest.buyer,
        arbiter: latest.arbiter,
        termsHash: latest.termsHash,
        fundingDeadline: latest.fundingDeadline,
        deliveryDeadline: latest.deliveryDeadline,
        settled: latest.settled,
        existsOnChain: latest.existsOnChain,
        title: latest.metadata?.title || entry.title || null,
        updatedAt: Date.now(),
      });
    } catch {
      updatedDeals.push(entry);
    }
  }

  await chrome.storage.local.set({
    watchedDeals: updatedDeals,
    lastPolledAt: Date.now(),
  });

  if (changedCount > 0) {
    await chrome.action.setBadgeText({ text: String(changedCount) });
    await chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
  }

  return updatedDeals;
}

// Rule #2 & #11: Open Side Panel automatically when user clicks the toolbar icon
chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Draft SafeDeal Escrow from "%s"',
      contexts: ["selection"],
    });
  });

  // Rule #7: Use chrome.alarms instead of setInterval in ephemeral service workers
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

  if (details.reason === "install") {
    await chrome.storage.local.set({
      watchedDeals: [],
      draftSelection: null,
      rpcUrl: DEFAULT_FUJI_RPC_URL,
      contractAddress: DEFAULT_ESCROW_CONTRACT,
      apiBaseUrl: DEFAULT_API_BASE_URL,
      webAppUrl: DEFAULT_WEB_APP_URL,
    });
  }

  if (chrome.permissions?.contains) {
    try {
      const hasAllSites = await chrome.permissions.contains({ origins: ["https://*/*"] });
      if (hasAllSites) {
        await ensureMarketplaceScannerRegistered();
      }
    } catch {
      // Optional permission not granted yet
    }
  }
});

// Rule #9: Context menu action persists selection, updates badge, opens Side Panel, and shows toast
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) {
    return;
  }

  const draftSelection = {
    terms: info.selectionText.trim(),
    sourceUrl: tab?.url ?? "",
    sourceTitle: tab?.title ?? "",
    capturedAt: Date.now(),
  };

  // Rule #7: Store in chrome.storage.local (never in global variables)
  await chrome.storage.local.set({ draftSelection });
  await chrome.action.setBadgeText({ text: "NEW" });
  await chrome.action.setBadgeBackgroundColor({ color: "#10B981" });

  if (tab?.windowId !== undefined) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch {
      // Side panel may already be open or restricted on chrome:// URLs
    }
  }

  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "SAFEDEAL_TOAST",
        message: "Selection captured into SafeDeal Escrow Side Panel!",
      });
    } catch {
      // Content script is only injected on matched origins; toolbar badge provides visual confirmation
    }
  }
});

// Rule #7: Alarm listener refreshes watched deals in the background
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await pollWatchedDeals();
  }
});

// Rule #5 & #20: Sender-isolated message dispatcher with synchronous permissions.request
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) return false;

  const isTrustedExtensionUi =
    !sender.tab &&
    typeof sender.url === "string" &&
    sender.url.startsWith(chrome.runtime.getURL(""));
  const isContentScript = Boolean(sender.tab);

  if (message?.type === "REQUEST_MARKETPLACE_SCAN_PERMISSION") {
    if (!isTrustedExtensionUi) {
      sendResponse({ ok: false, error: "FORBIDDEN_SENDER" });
      return false;
    }
    // Rule #20: MUST call chrome.permissions.request synchronously in the first turn before any await
    chrome.permissions.request({ origins: ["https://*/*"] }, (granted) => {
      (async () => {
        try {
          if (granted) {
            await ensureMarketplaceScannerRegistered();
          }
          sendResponse({ ok: true, granted: Boolean(granted) });
        } catch (err) {
          sendResponse({
            ok: false,
            granted: Boolean(granted),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    });
    return true;
  }

  if (
    (message?.type === "CLEAR_BADGE" ||
      message?.type === "REFRESH_WATCHED_DEALS" ||
      message?.type === "COMPUTE_TERMS_HASH") &&
    !isTrustedExtensionUi
  ) {
    sendResponse({ ok: false, error: "FORBIDDEN_SENDER" });
    return false;
  }

  (async () => {
    try {
      const config = await getStorageConfig();

      if (message?.type === "VERIFY_DEAL") {
        const fullData = await fetchDealVerification(message.tradeId, config);
        const data = isContentScript
          ? {
              status: fullData.status,
              statusCode: fullData.statusCode,
              existsOnChain: fullData.existsOnChain,
              amountAvax: fullData.amountAvax,
              termsHash: fullData.termsHash,
              termsVerified: fullData.termsVerified,
              contractAddress: fullData.contractAddress,
              chainId: fullData.chainId,
            }
          : fullData;
        sendResponse({ ok: true, data });
      } else if (message?.type === "COMPUTE_TERMS_HASH") {
        const data = await computeCanonicalTermsHash(message.payload);
        sendResponse({ ok: true, data });
      } else if (message?.type === "CHECK_CLAIMABLE_BALANCE") {
        const data = await claimableBalance(message.address, config);
        sendResponse({ ok: true, data });
      } else if (message?.type === "REFRESH_WATCHED_DEALS") {
        const data = await pollWatchedDeals();
        sendResponse({ ok: true, data });
      } else if (message?.type === "CLEAR_BADGE") {
        await chrome.action.setBadgeText({ text: "" });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "UNKNOWN_MESSAGE_TYPE" });
      }
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return true; // Rule #5: Keep message channel open for async response
});
