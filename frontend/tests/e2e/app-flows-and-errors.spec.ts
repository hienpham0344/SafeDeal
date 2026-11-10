import { expect, test } from "@playwright/test";

const TEST_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SAMPLE_TRADE_ID = "0x1111111111111111111111111111111111111111111111111111111111111111";

test.describe("Application Navigation, Error Boundaries & Wallet Session UI", () => {
  test("renders informational routes, API health status, and unavailable fallback safely", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { name: "How SafeDeal Works" })).toBeVisible();
    await expect(page.getByText("Important Trust Limitation")).toBeVisible();

    // Backend healthy state
    await page.route("**/api/v1/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "UP",
          service: "safedeal-api",
          chainId: 31337,
          chainName: "Anvil Local",
          escrowContractConfigured: true,
        }),
      });
    });

    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Support & Network Verification" })).toBeVisible();
    await expect(page.getByRole("main").getByText("Anvil Local (31337)")).toBeVisible();

    // Backend down state should render clean "Unavailable" indicator without crashing
    await page.unroute("**/api/v1/health");
    await page.route("**/api/v1/health", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"down"}' });
    });
    await page.reload();
    await expect(page.getByText("Unavailable")).toBeVisible();

    // Unknown route renders clean 404 fallback
    await page.goto("/definitely-does-not-exist");
    await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("handles form validation and wallet modal cleanly on /create when disconnected", async ({ page }) => {
    await page.route("**/api/v1/auth/me", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });

    await page.goto("/create");
    await expect(page.getByRole("heading", { name: "Create Escrow Deal" })).toBeVisible();

    // Submitting invalid/empty form displays Zod validation feedback inline
    await page.getByRole("button", { name: "Preview On-Chain Transaction" }).click();
    await expect(page.locator("form p.text-red-300").first()).toBeVisible();

    // Fill valid deal fields then submit while disconnected -> opens Wallet & Session modal
    await page.fill("#deal-title", "Playwright Test Deal");
    await page.fill("#deal-description", "End to end verification of validation and wallet prompt.");
    await page.fill("#deal-amount", "0.5");
    await page.fill("#deal-arbiter", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    await page.fill("#deal-terms", "Deliver verifiable artifact before deadline.");

    await page.getByRole("button", { name: "Preview On-Chain Transaction" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Wallet & Session" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Injected Wallet" })).toBeVisible();
  });

  test("completes mocked EIP-1193 wallet connect + SIWE login and renders dashboard & deal views", async ({ page }) => {
    await page.addInitScript((wallet) => {
      const listeners: Record<string, Array<(arg: unknown) => void>> = {};
      (window as unknown as { ethereum: unknown }).ethereum = {
        isMetaMask: true,
        selectedAddress: wallet,
        chainId: "0x7a69", // 31337
        on: (event: string, cb: (arg: unknown) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        },
        removeListener: () => undefined,
        request: async ({ method }: { method: string; params?: unknown[] }) => {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [wallet];
            case "eth_chainId":
              return "0x7a69";
            case "net_version":
              return "31337";
            case "personal_sign":
              return "0x" + "1b".repeat(65);
            default:
              throw new Error(`Unexpected mocked RPC method: ${method}`);
          }
        },
      };
    }, TEST_WALLET);

    let signedIn = false;
    await page.route("**/api/v1/auth/me", async (route) => {
      if (!signedIn) {
        await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          address: TEST_WALLET,
          chainId: 31337,
          authenticatedAt: "2026-11-10T12:00:00Z",
        }),
      });
    });

    await page.route("**/api/v1/auth/nonce", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nonce: "1234567890abcdef",
          message: `localhost:4173 wants you to sign in with your Ethereum account:\n${TEST_WALLET}\n\nSign in to SafeDeal.\n\nURI: http://localhost:4173\nVersion: 1\nChain ID: 31337\nNonce: 1234567890abcdef\nIssued At: 2026-11-10T12:00:00Z`,
          expiresAt: "2026-11-10T12:05:00Z",
        }),
      });
    });

    await page.route("**/api/v1/auth/verify", async (route) => {
      signedIn = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          address: TEST_WALLET,
          chainId: 31337,
          authenticatedAt: "2026-11-10T12:00:00Z",
          csrfToken: "e2e-csrf-token",
        }),
      });
    });

    await page.route("**/api/v1/deals**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              tradeId: SAMPLE_TRADE_ID,
              title: "Playwright Escrow Deal",
              description: "Verified UI deal card rendering from authenticated API.",
              seller: TEST_WALLET,
              buyer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
              arbiter: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
              amountWei: "1000000000000000000",
              termsHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
              fundingDeadline: "2027-01-01T00:00:00Z",
              deliveryDeadline: "2027-01-08T00:00:00Z",
              inspectionWindowSeconds: 86400,
              status: "FUNDED",
              onChainBound: true,
              settled: false,
              deliveredAt: null,
              fundedAt: "2026-12-01T00:00:00Z",
              createdAt: "2026-12-01T00:00:00Z",
              disputeId: null,
            },
          ],
          page: 0,
          size: 50,
          totalItems: 1,
          totalPages: 1,
        }),
      });
    });

    await page.goto("/dashboard");
    await page.getByRole("main").getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect Injected Wallet" }).click();

    const dialogSignIn = page.getByRole("dialog").getByRole("button", { name: "Sign In", exact: true });
    await expect(dialogSignIn).toBeVisible();
    await dialogSignIn.click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Playwright Escrow Deal")).toBeVisible();
    await page.getByRole("tab", { name: "Disputed" }).click();
    await expect(page.getByText("No deals in this view")).toBeVisible();
  });

  test("displays Wrong Network banner and switches chain cleanly via EIP-1193 provider", async ({ page }) => {
    await page.addInitScript((wallet) => {
      let currentChainId = "0x1"; // Ethereum Mainnet (unsupported target vs 31337)
      const listeners: Record<string, Array<(arg: unknown) => void>> = {};
      (window as unknown as { ethereum: unknown }).ethereum = {
        isMetaMask: true,
        selectedAddress: wallet,
        get chainId() {
          return currentChainId;
        },
        on: (event: string, cb: (arg: unknown) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        },
        removeListener: () => undefined,
        request: async ({ method, params }: { method: string; params?: Array<{ chainId?: string }> }) => {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [wallet];
            case "eth_chainId":
              return currentChainId;
            case "net_version":
              return currentChainId === "0x7a69" ? "31337" : "1";
            case "wallet_switchEthereumChain": {
              const target = params?.[0]?.chainId ?? "0x7a69";
              currentChainId = target;
              for (const cb of listeners["chainChanged"] || []) {
                cb(target);
              }
              return null;
            }
            default:
              throw new Error(`Unexpected mocked RPC method: ${method}`);
          }
        },
      };
    }, TEST_WALLET);

    await page.route("**/api/v1/auth/me", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });

    await page.goto("/dashboard");
    await page.getByRole("main").getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect Injected Wallet" }).click();

    await expect(page.getByRole("dialog").getByText("Wrong Network Connected")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close wallet dialog" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Wrong Network", { exact: true })).toBeVisible();

    const switchButton = page.getByRole("main").getByRole("button", { name: "Switch Network" });
    await expect(switchButton).toBeVisible();
    await switchButton.click();

    await expect(page.getByRole("main").getByText("Wrong Network", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Wallet Authentication Required")).toBeVisible();
  });

  test("handles wallet signature rejection cleanly during SIWE login without breaking session UI", async ({
    page,
  }) => {
    await page.addInitScript((wallet) => {
      (window as unknown as { ethereum: unknown }).ethereum = {
        isMetaMask: true,
        selectedAddress: wallet,
        chainId: "0x7a69",
        on: () => undefined,
        removeListener: () => undefined,
        request: async ({ method }: { method: string }) => {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [wallet];
            case "eth_chainId":
              return "0x7a69";
            case "net_version":
              return "31337";
            case "personal_sign":
              throw Object.assign(new Error("User denied message signature."), { code: 4001 });
            default:
              throw new Error(`Unexpected RPC call: ${method}`);
          }
        },
      };
    }, TEST_WALLET);

    await page.route("**/api/v1/auth/me", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/v1/auth/nonce", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nonce: "rejecttestnonce123",
          message: `127.0.0.1:4173 wants you to sign in with your Ethereum account:\n${TEST_WALLET}\n\nSign in to SafeDeal.\n\nURI: http://127.0.0.1:4173\nVersion: 1\nChain ID: 31337\nNonce: rejecttestnonce123\nIssued At: 2026-11-10T12:00:00Z`,
          expiresAt: "2026-11-10T12:05:00Z",
        }),
      });
    });

    await page.goto("/dashboard");
    await page.getByRole("main").getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect Injected Wallet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign In", exact: true }).click();

    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/denied|rejected/i);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Sign In", exact: true })).toBeEnabled();
  });

  test("recovers from temporary 503 bind-tx failure across reload and surfaces duplicate tx rejection cleanly", async ({
    page,
  }) => {
    const confirmedTx = "0x9999999999999999999999999999999999999999999999999999999999999999";
    await page.addInitScript(
      ({ wallet, txHash }) => {
        const w = window as unknown as {
          __sendCount: number;
          ethereum: unknown;
        };
        w.__sendCount = 0;
        w.ethereum = {
          isMetaMask: true,
          selectedAddress: wallet,
          chainId: "0x7a69",
          on: () => undefined,
          removeListener: () => undefined,
          request: async ({ method }: { method: string; params?: unknown[] }) => {
            switch (method) {
              case "eth_requestAccounts":
              case "eth_accounts":
                return [wallet];
              case "eth_chainId":
                return "0x7a69";
              case "net_version":
                return "31337";
              case "personal_sign":
                return "0x" + "1b".repeat(65);
              case "eth_sendTransaction":
                w.__sendCount += 1;
                return txHash;
              default:
                throw new Error(`Unexpected wallet RPC: ${method}`);
            }
          },
        };
      },
      { wallet: TEST_WALLET, txHash: confirmedTx }
    );

    // Intercept RPC reads to local RPC node so receipt polling works without a live node in default offline suite
    await page.route("http://127.0.0.1:8545/**", async (route) => {
      const req = route.request().postDataJSON() as { id?: number; method?: string };
      let result: unknown = null;
      if (req.method === "eth_chainId") result = "0x7a69";
      else if (req.method === "eth_blockNumber") result = "0x10";
      else if (req.method === "eth_getTransactionReceipt") {
        result = {
          transactionHash: confirmedTx,
          blockNumber: "0xf",
          blockHash: "0x" + "aa".repeat(32),
          transactionIndex: "0x0",
          from: TEST_WALLET,
          to: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
          status: "0x1",
          gasUsed: "0x5208",
          cumulativeGasUsed: "0x5208",
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          type: "0x2",
        };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: req.id ?? 1, result }),
      });
    });

    await page.route("**/api/v1/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          address: TEST_WALLET,
          chainId: 31337,
          authenticatedAt: "2026-11-10T12:00:00Z",
        }),
      });
    });

    const tradeHashPayload = {
      tradeId: SAMPLE_TRADE_ID,
      termsHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      chainId: 31337,
      deal: {
        tradeId: SAMPLE_TRADE_ID,
        title: "Fault Injection Deal",
        description: "Testing 503 bind-tx failure + reload recovery",
        seller: TEST_WALLET,
        buyer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        arbiter: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        amountWei: "1000000000000000000",
        termsHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        fundingDeadline: "2027-01-01T00:00:00Z",
        deliveryDeadline: "2027-01-08T00:00:00Z",
        inspectionWindowSeconds: 86400,
        status: "DRAFT",
        onChainBound: false,
        settled: false,
        deliveredAt: null,
        fundedAt: null,
        createdAt: "2026-11-10T12:00:00Z",
        disputeId: null,
        terms: "Deliver package.",
        canonicalTermsJson: "{}",
        chainId: 31337,
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        createTxHash: null,
      },
    };

    // Seed sessionStorage once (guarded so clearDraftState on bind completion stays cleared)
    await page.addInitScript(
      ({ wallet, draft, txHash }) => {
        if (window.sessionStorage.getItem("e2e-503-seeded")) return;
        window.sessionStorage.setItem("e2e-503-seeded", "1");
        window.sessionStorage.setItem(
          `safedeal:create-draft:${wallet.toLowerCase()}`,
          JSON.stringify({
            sellerAddress: wallet,
            previewDraft: draft,
            clientTermsHash: draft.termsHash,
            submittedCreateTxHash: txHash,
            updatedAt: new Date().toISOString(),
          })
        );
      },
      { wallet: TEST_WALLET, draft: tradeHashPayload, txHash: confirmedTx }
    );

    let bindAttempts = 0;
    await page.route(`**/api/v1/deals/${SAMPLE_TRADE_ID}/bind-tx`, async (route) => {
      bindAttempts += 1;
      if (bindAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SERVICE_UNAVAILABLE", message: "Backend temporarily unavailable (503)" }),
        });
        return;
      }
      if (bindAttempts === 2) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "CONFLICT",
            message: "Transaction hash already bound to another trade.",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...tradeHashPayload.deal,
          status: "CREATED",
          onChainBound: true,
          createTxHash: confirmedTx,
        }),
      });
    });

    await page.route("**/api/v1/deals?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], page: 0, size: 50, totalItems: 0, totalPages: 0 }),
      });
    });

    // Connect reliably via Dashboard main action (works identically across 1440px, 768px, and 390px)
    await page.goto("/dashboard");
    await page.getByRole("main").getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect Injected Wallet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close wallet dialog" }).click();

    await page.goto("/create");

    await expect(page.getByText("Fault Injection Deal")).toBeVisible();
    await expect(page.getByText("On-Chain Transaction Submitted")).toBeVisible();

    // 1st bind attempt -> 503
    await page.getByRole("button", { name: "Retry Backend Binding" }).click();
    await expect(page.getByText("Backend temporarily unavailable (503)")).toBeVisible();

    // Reload page -> still restores Step 2 & Retry button cleanly
    await page.reload();
    await expect(page.getByRole("button", { name: "Retry Backend Binding" })).toBeVisible();

    // 2nd bind attempt -> 409 duplicate tx error cleanly surfaced
    await page.getByRole("button", { name: "Retry Backend Binding" }).click();
    await expect(page.getByText("Transaction hash already bound to another trade.")).toBeVisible();

    // 3rd bind attempt -> succeeds without ever calling eth_sendTransaction
    await page.getByRole("button", { name: "Retry Backend Binding" }).click();
    await expect(page.getByText("Deal Created & Bound")).toBeVisible();
    const sendCount = await page.evaluate(
      () => (window as unknown as { __sendCount: number }).__sendCount
    );
    expect(sendCount).toBe(0);
  });
});
