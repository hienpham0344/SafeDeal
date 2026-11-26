/**
 * SafeDeal Escrow Companion — Content Script Deal Link Verifier, Anti-Phishing Domain Shield & Shadow DOM Toast
 * Strictly complies with Mandatory Rules #5, #6, and #9:
 * - Rule #5: Uses async/await exclusively (no Promise-chain callbacks)
 * - Rule #6: Batches DOM mutations in chunks of 15 with requestAnimationFrame + scheduler.yield()
 * - Rule #9: Renders isolated Shadow DOM toast confirmation on context-menu capture
 */

const DEAL_LINK_SELECTOR = 'a[href*="/deals/"]';
const BATCH_SIZE = 15;
const MAX_LINKS_PER_SCAN = 100;
const VERIFY_CACHE_TTL_MS = 60_000;
const PHISHING_ALERT_TEXT = "[⚠️ SafeDeal Security Alert: Unofficial Phishing Domain!]";

const OFFICIAL_SAFEDEAL_ORIGINS = new Set([
  "https://avalanche-9b099.web.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:14173",
  "http://127.0.0.1:14173",
  "http://localhost:24173",
  "http://127.0.0.1:24173",
]);

const STATUS_BADGE_COLORS = {
  FUNDED: { border: "#10B981", bg: "rgba(16, 185, 129, 0.14)", text: "#34D399" },
  DELIVERED: { border: "#38BDF8", bg: "rgba(56, 189, 248, 0.14)", text: "#7DD3FC" },
  RELEASED: { border: "#10B981", bg: "rgba(16, 185, 129, 0.18)", text: "#6EE7B7" },
  RESOLVED: { border: "#A78BFA", bg: "rgba(167, 139, 250, 0.14)", text: "#C4B5FD" },
  DISPUTED: { border: "#F59E0B", bg: "rgba(245, 158, 11, 0.16)", text: "#FCD34D" },
  CREATED: { border: "#64748B", bg: "rgba(100, 116, 139, 0.16)", text: "#CBD5E1" },
  REFUNDED: { border: "#94A3B8", bg: "rgba(148, 163, 184, 0.14)", text: "#CBD5E1" },
  CANCELLED: { border: "#EF4444", bg: "rgba(239, 68, 68, 0.14)", text: "#FCA5A5" },
  NONE: { border: "#EF4444", bg: "rgba(239, 68, 68, 0.14)", text: "#FCA5A5" },
};

/** @type {Map<string, { expiresAt: number, promise: Promise<unknown> }>} */
const dealVerificationCache = new Map();

/**
 * Deduplicates VERIFY_DEAL lookups per tradeId within a 60s TTL window.
 * @param {string} tradeId
 */
async function getCachedDealVerification(tradeId) {
  const normalizedKey = tradeId.toLowerCase();
  const now = Date.now();
  const existing = dealVerificationCache.get(normalizedKey);
  if (existing && existing.expiresAt > now) {
    return await existing.promise;
  }

  const lookupPromise = (async () => {
    return await chrome.runtime.sendMessage({
      type: "VERIFY_DEAL",
      tradeId,
    });
  })();

  dealVerificationCache.set(normalizedKey, {
    expiresAt: now + VERIFY_CACHE_TTL_MS,
    promise: lookupPromise,
  });

  try {
    const response = await lookupPromise;
    if (!response?.ok) {
      dealVerificationCache.delete(normalizedKey);
    }
    return response;
  } catch (err) {
    dealVerificationCache.delete(normalizedKey);
    throw err;
  }
}

function createPhishingWarningBadgeElement() {
  const host = document.createElement("span");
  host.className = "safedeal-companion-badge-host safedeal-phishing-alert-host";
  host.style.cssText = "display:inline-flex;vertical-align:middle;margin-left:6px;";

  const shadow = host.attachShadow({ mode: "closed" });
  const pill = document.createElement("span");
  pill.setAttribute("role", "alert");
  pill.textContent = PHISHING_ALERT_TEXT;
  pill.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "padding:2px 9px",
    "border-radius:9999px",
    "border:1px solid #EF4444",
    "background:rgba(127, 29, 29, 0.94)",
    "color:#FEF2F2",
    "font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
    "font-size:11px",
    "font-weight:700",
    "line-height:1.3",
    "letter-spacing:0.01em",
    "white-space:nowrap",
  ].join(";");

  shadow.appendChild(pill);
  return host;
}

function createShadowBadgeElement(verificationData) {
  const host = document.createElement("span");
  host.className = "safedeal-companion-badge-host";
  host.style.cssText = "display:inline-flex;vertical-align:middle;margin-left:6px;";

  const shadow = host.attachShadow({ mode: "closed" });
  const pill = document.createElement("span");

  const status =
    typeof verificationData.status === "string" && verificationData.status
      ? verificationData.status
      : "NONE";
  const palette = Object.hasOwn(STATUS_BADGE_COLORS, status)
    ? STATUS_BADGE_COLORS[status]
    : STATUS_BADGE_COLORS.CREATED;
  const hashSummary =
    verificationData.termsVerified === true
      ? " • RFC 8785 OK"
      : verificationData.existsOnChain
        ? ` • ${verificationData.amountAvax} AVAX`
        : " • Not Found On-Chain";

  pill.textContent = `SafeDeal: ${status}${hashSummary}`;
  pill.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "padding:2px 8px",
    "border-radius:9999px",
    `border:1px solid ${palette.border}`,
    `background:${palette.bg}`,
    `color:${palette.text}`,
    "font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
    "font-size:11px",
    "font-weight:600",
    "line-height:1.3",
    "letter-spacing:0.01em",
    "white-space:nowrap",
  ].join(";");

  shadow.appendChild(pill);
  return host;
}

/**
 * Rule #6: Non-blocking DOM scanner batching updates in chunks of 15 with
 * requestAnimationFrame and yielding via scheduler.yield() between batches.
 * Caps per-pass scanning at MAX_LINKS_PER_SCAN (100) and blocks unofficial phishing origins.
 */
async function annotateSafeDealLinks() {
  const anchors = Array.from(document.querySelectorAll(DEAL_LINK_SELECTOR))
    .filter((el) => !el.dataset.safedealChecked)
    .slice(0, MAX_LINKS_PER_SCAN);

  for (let i = 0; i < anchors.length; i += BATCH_SIZE) {
    const slice = anchors.slice(i, i + BATCH_SIZE);

    const verifications = await Promise.all(
      slice.map(async (anchor) => {
        anchor.dataset.safedealChecked = "true";
        let parsedUrl;
        try {
          parsedUrl = new URL(anchor.href, window.location.origin);
        } catch {
          return null;
        }

        const match = parsedUrl.href.match(/\/deals\/(0x[0-9a-fA-F]{64})/);
        if (!match) return null;

        if (!OFFICIAL_SAFEDEAL_ORIGINS.has(parsedUrl.origin)) {
          return { anchor, isPhishingDomain: true, response: null };
        }

        try {
          const tradeId = decodeURIComponent(match[1]);
          const response = await getCachedDealVerification(tradeId);
          return { anchor, isPhishingDomain: false, response };
        } catch {
          return null;
        }
      })
    );

    await new Promise((resolve) =>
      requestAnimationFrame(() => {
        for (const item of verifications) {
          if (!item) continue;
          if (item.isPhishingDomain) {
            const alertHost = createPhishingWarningBadgeElement();
            item.anchor.insertAdjacentElement("afterend", alertHost);
            continue;
          }
          if (!item.response?.ok || !item.response.data) continue;
          const badgeHost = createShadowBadgeElement(item.response.data);
          item.anchor.insertAdjacentElement("afterend", badgeHost);
        }
        resolve();
      })
    );

    if (globalThis.scheduler?.yield) {
      await globalThis.scheduler.yield();
    }
  }
}

/**
 * Rule #9: Displays an isolated Shadow DOM toast notification confirming a context menu action.
 * @param {string} message
 */
function showShadowToast(message) {
  requestAnimationFrame(() => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });

    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const dot = document.createElement("span");
    dot.style.cssText =
      "width:8px;height:8px;border-radius:9999px;background:#10B981;box-shadow:0 0 8px #10B981;flex-shrink:0;";

    const label = document.createElement("span");
    label.textContent = message;

    toast.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "background:#090D16",
      "color:#F8FAFC",
      "padding:11px 16px",
      "border-radius:10px",
      "border:1px solid #10B981",
      "font-family:system-ui,-apple-system, BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "font-size:13px",
      "font-weight:500",
      "box-shadow:0 16px 32px -8px rgba(0, 0, 0, 0.65)",
    ].join(";");

    toast.appendChild(dot);
    toast.appendChild(label);
    shadow.appendChild(toast);
    document.body.appendChild(host);

    setTimeout(() => {
      host.remove();
    }, 3200);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) {
    return false;
  }
  if (msg?.type === "SAFEDEAL_TOAST") {
    showShadowToast(msg.message || "Saved to SafeDeal Escrow Side Panel");
    sendResponse({ shown: true });
    return false;
  }
  if (msg?.type === "RESCAN_SAFEDEAL_LINKS") {
    (async () => {
      await annotateSafeDealLinks();
      sendResponse({ scanned: true });
    })();
    return true;
  }
  return false;
});

annotateSafeDealLinks();
