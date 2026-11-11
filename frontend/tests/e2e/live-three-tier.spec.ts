import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { safeDealEscrowAbi } from "../../src/contracts/SafeDealEscrow";

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const LIVE_E2E_ENABLED = runtimeEnv.LIVE_E2E_ENABLED === "1";
const RPC_URL = runtimeEnv.LIVE_E2E_RPC_URL ?? "http://127.0.0.1:18545";
const API_URL = runtimeEnv.LIVE_E2E_API_URL ?? "http://127.0.0.1:18080";
const CONTRACT_ADDRESS = (runtimeEnv.LIVE_E2E_CONTRACT_ADDRESS ?? "") as `0x${string}`;

// Minimal valid 1x1 transparent PNG
const VALID_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
  0x00, 0x05, 0x00, 0x01, 0xe2, 0x26, 0x05, 0x9b,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const anvilLiveChain = defineChain({
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

interface ActorContext {
  readonly role: string;
  readonly account: PrivateKeyAccount;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly runtimeErrors: string[];
}

async function rpcPost(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message ?? `RPC error for ${method}`);
  }
  return payload.result;
}

async function createAndAuthenticateActor(browser: Browser, role: string): Promise<ActorContext> {
  const account = privateKeyToAccount(generatePrivateKey());
  // Fund generated EOA with 100 AVAX on live Anvil (0x56bc75e2d63100000 wei)
  await rpcPost("anvil_setBalance", [account.address, "0x56bc75e2d63100000"]);

  const walletClient = createWalletClient({
    account,
    chain: anvilLiveChain,
    transport: http(RPC_URL),
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  const authDiagnostics: string[] = [];
  page.on("pageerror", (err) => {
    runtimeErrors.push(`${role} pageerror: ${err.message}`);
    authDiagnostics.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      authDiagnostics.push(`console.error: ${msg.text()}`);
    }
  });
  page.on("requestfailed", (req) => {
    authDiagnostics.push(`requestfailed ${req.method()} ${req.url()}: ${req.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", async (res) => {
    if (res.url().startsWith(API_URL) && res.status() >= 500) {
      runtimeErrors.push(`${role} API ${res.status()} at ${res.url()}`);
    }
    if (
      res.url().startsWith(API_URL) &&
      res.status() >= 400 &&
      !(res.url().endsWith("/api/v1/auth/me") && res.status() === 401)
    ) {
      const body = await res.text().catch(() => "");
      authDiagnostics.push(`HTTP ${res.status()} ${res.url()} -> ${body}`);
    }
  });

  await page.exposeFunction("__e2eWalletRpc", async (rawPayload: string) => {
    const { method, params } = JSON.parse(rawPayload) as { method: string; params?: unknown[] };
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return "0x7a69";
        case "net_version":
          return "31337";
        case "wallet_switchEthereumChain":
          return null;
        case "personal_sign": {
          const rawMessage = String(params?.[0] ?? "");
          const message = rawMessage.startsWith("0x") ? { raw: rawMessage as `0x${string}` } : rawMessage;
          return await account.signMessage({ message });
        }
        case "eth_sendTransaction": {
          const tx = (params?.[0] ?? {}) as {
            to?: `0x${string}`;
            data?: `0x${string}`;
            value?: `0x${string}`;
            gas?: `0x${string}`;
          };
          return await walletClient.sendTransaction({
            account,
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : 0n,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
        }
        default:
          return await rpcPost(method, params ?? []);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      authDiagnostics.push(`rpc ${method} error: ${msg}`);
      throw error;
    }
  });

  await page.addInitScript((addr: string) => {
    const listeners: Record<string, Array<(arg: unknown) => void>> = {};
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      selectedAddress: addr,
      chainId: "0x7a69",
      on: (event: string, cb: (arg: unknown) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      },
      removeListener: () => undefined,
      request: async (args: { method: string; params?: unknown[] }) => {
        const bridge = (window as unknown as { __e2eWalletRpc: (json: string) => Promise<unknown> }).__e2eWalletRpc;
        return await bridge(JSON.stringify(args));
      },
    };
  }, account.address);

  await page.goto("/dashboard");
  await page.getByRole("main").getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Connect Injected Wallet" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Sign In", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("dialog").getByRole("button", { name: "Sign In", exact: true }).click();
  try {
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  } catch (err) {
    const dialogAlert = await page.getByRole("dialog").locator('[role="alert"]').textContent().catch(() => null);
    const dialogText = await page.getByRole("dialog").innerText().catch(() => "<closed>");
    throw new Error(
      `Actor '${role}' (${account.address}) failed SIWE sign-in.\n` +
        `Dialog alert: ${dialogAlert ?? "<none>"}\n` +
        `Dialog text: ${dialogText.replace(/\s+/g, " ")}\n` +
        `Diagnostics: ${authDiagnostics.join(" | ") || "<none>"}\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { role, account, context, page, runtimeErrors };
}

async function createAndBindDealThroughUi(params: {
  page: Page;
  title: string;
  description: string;
  amountAvax: string;
  arbiterAddress: string;
  buyerAddress?: string;
  terms: string;
}): Promise<`0x${string}`> {
  const { page, title, description, amountAvax, arbiterAddress, buyerAddress, terms } = params;
  await page.goto("/create");

  await page.fill("#deal-title", title);
  await page.fill("#deal-description", description);
  await page.fill("#deal-amount", amountAvax);
  await page.fill("#deal-arbiter", arbiterAddress);
  if (buyerAddress) {
    await page.fill("#deal-buyer", buyerAddress);
  } else {
    await page.fill("#deal-buyer", "");
  }
  await page.fill("#deal-terms", terms);

  await page.getByRole("button", { name: "Preview On-Chain Transaction" }).click();
  await expect(page.getByRole("button", { name: "Create Trade On-Chain" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Create Trade On-Chain" }).click();

  try {
    await expect(page.getByText("Deal Created & Bound")).toBeVisible({ timeout: 25_000 });
  } catch (err) {
    const alertTexts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    throw new Error(
      `Deal creation/binding failed for '${title}' (url=${page.url()}).\n` +
        `Visible alerts: ${alertTexts.join(" | ") || "<none>"}\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const shareUrl = await page.locator("code").first().innerText();
  const match = shareUrl.match(/\/deals\/(0x[0-9a-fA-F]{64})/);
  expect(match?.[1], `Expected tradeId inside shareUrl=${shareUrl}`).toBeTruthy();
  return match![1] as `0x${string}`;
}

test.describe("Live Unmocked 3-Tier Browser -> Backend -> Anvil E2E", () => {
  test.skip(!LIVE_E2E_ENABLED, "Set LIVE_E2E_ENABLED=1 (via scripts/e2e-live.sh) to run unmocked 3-tier E2E.");

  test("executes full cooperative, refund, and dispute split-arbitration lifecycles against real backend and Anvil", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(CONTRACT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const publicClient = createPublicClient({
      chain: anvilLiveChain,
      transport: http(RPC_URL),
    });

    const seller = await createAndAuthenticateActor(browser, "seller");
    const buyer = await createAndAuthenticateActor(browser, "buyer");
    const arbiter = await createAndAuthenticateActor(browser, "arbiter");
    const outsider = await createAndAuthenticateActor(browser, "outsider");

    try {
      // Verify live /api/v1/health/ready returns READY over HTTP
      const readyRes = await seller.page.request.get(`${API_URL}/api/v1/health/ready`);
      expect(readyRes.status()).toBe(200);
      const readyBody = (await readyRes.json()) as { status: string; databaseConnected: boolean; escrowContractConfigured: boolean };
      expect(readyBody.status).toBe("READY");
      expect(readyBody.databaseConnected).toBe(true);
      expect(readyBody.escrowContractConfigured).toBe(true);

      // =====================================================================
      // Flow 1: Cooperative Escrow (CREATED -> FUNDED -> DELIVERED -> RELEASED -> Seller withdraw)
      // =====================================================================
      const tradeId1 = await createAndBindDealThroughUi({
        page: seller.page,
        title: "Live 3-Tier Cooperative Audit",
        description: "End-to-end unmocked Avalanche escrow cooperative delivery.",
        amountAvax: "0.5",
        arbiterAddress: arbiter.account.address,
        buyerAddress: buyer.account.address,
        terms: "Seller delivers signed build artifact before release.",
      });

      await buyer.page.goto(`/deals/${tradeId1}`);
      await expect(buyer.page.getByText("CREATED", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText("(client SHA-256 verified)")).toBeVisible({ timeout: 15_000 });
      await buyer.page.getByRole("button", { name: /Fund Escrow \(0\.5 AVAX\)/ }).click();
      await expect(buyer.page.getByText("FUNDED", { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      // Reload verifies DB persistence
      await buyer.page.reload();
      await expect(buyer.page.getByText("FUNDED", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

      await seller.page.goto(`/deals/${tradeId1}`);
      await expect(seller.page.getByRole("button", { name: "Mark Delivered" })).toBeVisible({ timeout: 15_000 });
      await seller.page.getByRole("button", { name: "Mark Delivered" }).click();
      await expect(seller.page.getByText("DELIVERED", { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      await buyer.page.reload();
      await expect(buyer.page.getByRole("button", { name: "Approve & Release Funds" })).toBeVisible({ timeout: 15_000 });
      await buyer.page.getByRole("button", { name: "Approve & Release Funds" }).click();
      await expect(buyer.page.getByText("RELEASED", { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      // Verified event timeline recorded cleanly
      await expect(buyer.page.getByText("TRADE_CREATED", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText("TRADE_FUNDED", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText("DELIVERY_MARKED", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText("FUNDS_RELEASED", { exact: true })).toBeVisible({ timeout: 15_000 });

      // Seller pulls claimable funds to 0 wei
      await seller.page.reload();
      await expect(seller.page.getByText(/0\.5 AVAX ready for pull-withdrawal/i)).toBeVisible({ timeout: 15_000 });
      await seller.page.getByRole("button", { name: "Withdraw AVAX" }).click();
      await expect(seller.page.getByText(/Withdrawal confirmed on-chain/i)).toBeVisible({ timeout: 25_000 });

      const sellerClaimableAfterFlow1 = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: safeDealEscrowAbi,
        functionName: "claimableBalances",
        args: [seller.account.address],
      });
      expect(sellerClaimableAfterFlow1).toBe(0n);

      // =====================================================================
      // Flow 2: Voluntary Seller Refund on Open-Buyer Trade (FUNDED -> REFUNDED -> Buyer withdraw)
      // =====================================================================
      const tradeId2 = await createAndBindDealThroughUi({
        page: seller.page,
        title: "Live 3-Tier Open-Buyer Refund",
        description: "End-to-end voluntary refund flow on open-buyer deal link.",
        amountAvax: "0.25",
        arbiterAddress: arbiter.account.address,
        terms: "Open buyer funds escrow and seller issues voluntary refund.",
      });

      await buyer.page.goto(`/deals/${tradeId2}`);
      await expect(buyer.page.getByRole("button", { name: /Fund Escrow \(0\.25 AVAX\)/ })).toBeVisible({
        timeout: 15_000,
      });
      await buyer.page.getByRole("button", { name: /Fund Escrow \(0\.25 AVAX\)/ }).click();
      await expect(buyer.page.getByText("FUNDED", { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      await seller.page.goto(`/deals/${tradeId2}`);
      await expect(seller.page.getByRole("button", { name: "Voluntary Refund to Buyer" })).toBeVisible({
        timeout: 15_000,
      });
      await seller.page.getByRole("button", { name: "Voluntary Refund to Buyer" }).click();
      await expect(seller.page.getByText("REFUNDED", { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      await buyer.page.reload();
      await expect(buyer.page.getByText(/0\.25 AVAX ready for pull-withdrawal/i)).toBeVisible({ timeout: 15_000 });
      await buyer.page.getByRole("button", { name: "Withdraw AVAX" }).click();
      await expect(buyer.page.getByText(/Withdrawal confirmed on-chain/i)).toBeVisible({ timeout: 25_000 });

      const buyerClaimableAfterFlow2 = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: safeDealEscrowAbi,
        functionName: "claimableBalances",
        args: [buyer.account.address],
      });
      expect(buyerClaimableAfterFlow2).toBe(0n);

      // =====================================================================
      // Flow 3: Dispute + Evidence PNG Upload/Download + RBAC Check + Split Arbiter Resolution
      // =====================================================================
      const tradeId3 = await createAndBindDealThroughUi({
        page: seller.page,
        title: "Live 3-Tier Split Arbitration",
        description: "End-to-end dispute evidence upload, non-participant block, and arbiter split.",
        amountAvax: "0.6",
        arbiterAddress: arbiter.account.address,
        buyerAddress: buyer.account.address,
        terms: "Disputed deliverable subject to split settlement by arbiter.",
      });

      await buyer.page.goto(`/deals/${tradeId3}`);
      await expect(buyer.page.getByRole("button", { name: /Fund Escrow \(0\.6 AVAX\)/ })).toBeVisible({
        timeout: 15_000,
      });
      await buyer.page.getByRole("button", { name: /Fund Escrow \(0\.6 AVAX\)/ }).click();
      await expect(buyer.page.getByText("FUNDED", { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      await buyer.page.getByRole("button", { name: "Open Dispute" }).click();
      await buyer.page
        .getByPlaceholder("Short reason (e.g. Deliverable incomplete)")
        .fill("Incomplete delivery artifact");
      await buyer.page
        .getByPlaceholder("Explain the dispute facts for the arbiter")
        .fill("Delivered archive lacks required test evidence screenshot.");
      await buyer.page.getByRole("button", { name: "Confirm Dispute" }).click();

      await expect(buyer.page).toHaveURL(/\/disputes\/\d+$/, { timeout: 25_000 });
      const disputeMatch = buyer.page.url().match(/\/disputes\/(\d+)$/);
      expect(disputeMatch?.[1]).toBeTruthy();
      const disputeId = disputeMatch![1]!;

      // Upload real valid PNG multipart attachment & verify SHA-256 + byte-for-byte download
      type SetInputPayload = Extract<Parameters<Page["setInputFiles"]>[1], { buffer: unknown }>;
      const runtimeBuffer = (globalThis as unknown as { Buffer: { from(bytes: Uint8Array): SetInputPayload["buffer"] } })
        .Buffer;
      await buyer.page.fill("#ev-title", "Proof Screenshot PNG");
      await buyer.page.fill("#ev-notes", "Captured verification output.");
      await buyer.page.setInputFiles("#ev-file", {
        name: "proof-evidence.png",
        mimeType: "image/png",
        buffer: runtimeBuffer.from(VALID_PNG_BYTES),
      });
      await buyer.page.getByRole("button", { name: "Submit Evidence" }).click();

      await expect(buyer.page.getByText("Evidence recorded securely")).toBeVisible({ timeout: 15_000 });
      const downloadLink = buyer.page.getByRole("link", { name: "proof-evidence.png" });
      await expect(downloadLink).toBeVisible({ timeout: 15_000 });
      const downloadHref = await downloadLink.getAttribute("href");
      expect(downloadHref).toBeTruthy();

      const downloadRes = await buyer.page.request.get(downloadHref!);
      expect(downloadRes.status()).toBe(200);
      const downloadedBytes = new Uint8Array(await downloadRes.body());
      expect(Array.from(downloadedBytes)).toEqual(Array.from(VALID_PNG_BYTES));

      // Non-participant outsider must be rejected cleanly with 403 / access denied
      const outsiderDisputeRes = await outsider.page.request.get(`${API_URL}/api/v1/disputes/${disputeId}`);
      expect(outsiderDisputeRes.status()).toBe(403);
      await outsider.page.goto(`/disputes/${disputeId}`);
      await expect(outsider.page.getByText("Access Denied or Not Found")).toBeVisible({ timeout: 15_000 });

      // Arbiter inspects assigned disputes and resolves 0.2 Buyer / 0.4 Seller split
      await arbiter.page.goto("/arbiter");
      await expect(arbiter.page.getByText(new RegExp(`Dispute #${disputeId}`))).toBeVisible({ timeout: 15_000 });
      await arbiter.page.fill(`#buyer-alloc-${disputeId}`, "0.2");
      await arbiter.page.fill(`#seller-alloc-${disputeId}`, "0.4");
      const settlementRationale =
        "Partial milestone verified from proof-evidence.png; splitting 0.2 AVAX to buyer and 0.4 AVAX to seller.";
      await arbiter.page.fill(`#rationale-${disputeId}`, settlementRationale);
      await arbiter.page.getByRole("button", { name: "Sign & Submit Settlement On-Chain" }).click();
      await expect(arbiter.page.getByText(/Dispute settled on-chain/i)).toBeVisible({ timeout: 25_000 });

      await buyer.page.reload();
      await expect(buyer.page.getByText("RESOLVED", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText(/Buyer Award:.*0\.2 AVAX/i)).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText(/Seller Award:.*0\.4 AVAX/i)).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText(`Rationale: ${settlementRationale}`)).toBeVisible({ timeout: 15_000 });

      // Both Buyer (0.2 AVAX) and Seller (0.4 AVAX) withdraw on DealDetailsPage -> contract claimable 0 wei
      await buyer.page.goto(`/deals/${tradeId3}`);
      await expect(buyer.page.getByText("RESOLVED", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await expect(buyer.page.getByText(/0\.2 AVAX ready for pull-withdrawal/i)).toBeVisible({ timeout: 15_000 });
      await buyer.page.getByRole("button", { name: "Withdraw AVAX" }).click();
      await expect(buyer.page.getByText(/Withdrawal confirmed on-chain/i)).toBeVisible({ timeout: 25_000 });

      await seller.page.goto(`/deals/${tradeId3}`);
      await expect(seller.page.getByText("RESOLVED", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await expect(seller.page.getByText(/0\.4 AVAX ready for pull-withdrawal/i)).toBeVisible({ timeout: 15_000 });
      await seller.page.getByRole("button", { name: "Withdraw AVAX" }).click();
      await expect(seller.page.getByText(/Withdrawal confirmed on-chain/i)).toBeVisible({ timeout: 25_000 });

      expect(
        await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: safeDealEscrowAbi,
          functionName: "claimableBalances",
          args: [buyer.account.address],
        })
      ).toBe(0n);
      expect(
        await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: safeDealEscrowAbi,
          functionName: "claimableBalances",
          args: [seller.account.address],
        })
      ).toBe(0n);

      expect([
        ...seller.runtimeErrors,
        ...buyer.runtimeErrors,
        ...arbiter.runtimeErrors,
        ...outsider.runtimeErrors,
      ]).toEqual([]);
    } finally {
      await Promise.all([
        seller.context.close(),
        buyer.context.close(),
        arbiter.context.close(),
        outsider.context.close(),
      ]);
    }
  });
});
