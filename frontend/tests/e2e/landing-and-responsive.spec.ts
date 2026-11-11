import { expect, test } from "@playwright/test";

const EXPECTED_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_204221_5339e40b-e73d-4ab0-9c65-79c18c66fd50.mp4";

const ROUTES_TO_AUDIT = ["/", "/how-it-works", "/support", "/create", "/dashboard", "/arbiter"];

function assertValidPngScreenshot(bytes: Uint8Array, label: string) {
  expect(bytes.byteLength, `Expected non-empty screenshot for ${label}`).toBeGreaterThan(5000);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

test.describe("Foldcraft Landing Preservation & Responsive Layout", () => {
  test("preserves exact Foldcraft hero visuals, computed styles, animations, navbar alignment, and screenshots", async ({
    page,
    request,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const faviconRes = await request.get("/icons/favicon.svg");
    expect(faviconRes.status()).toBe(200);
    expect(await faviconRes.text()).toContain("<svg");

    await page.goto("/");

    await expect(page.getByRole("link", { name: "SafeDeal" })).toBeVisible();
    await expect(page.getByText("Secure P2P Transactions")).toBeVisible();

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("Trade with trust,");
    await expect(heading).toContainText("not with");
    await expect(heading).toContainText("blind faith.");

    const cta = page.getByRole("link", { name: "Create a Deal" });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/create");

    // Verify Geist font family + single-decoder seamless hero video & canvas overlay geometry + hero fadeSlideUp delays
    const videos = page.locator("video");
    await expect(videos).toHaveCount(1);
    const primaryVideo = page.locator('video[data-hero-video="primary"]');
    const blendCanvas = page.locator('canvas[data-hero-canvas="blend"]');
    await expect(primaryVideo).toHaveAttribute("data-hero-src", EXPECTED_VIDEO_URL);
    await expect(blendCanvas).toHaveCount(1);
    const visualAudit = await page.evaluate(() => {
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const vidPrimary = document.querySelector('video[data-hero-video="primary"]') as HTMLVideoElement;
      const canvasBlend = document.querySelector('canvas[data-hero-canvas="blend"]') as HTMLCanvasElement;
      const primaryStyle = getComputedStyle(vidPrimary);
      const canvasStyle = getComputedStyle(canvasBlend);
      const badge = document.querySelector("main > div:first-child > p") as HTMLElement;
      const h1 = document.querySelector("main h1") as HTMLElement;
      const desc = document.querySelector("main > div:nth-child(2) > p") as HTMLElement;
      const ctaLink = document.querySelector("main > div:nth-child(2) > a") as HTMLElement;

      return {
        bodyFont,
        primaryVideo: {
          autoplay: vidPrimary.autoplay,
          muted: vidPrimary.muted,
          playsInline: vidPrimary.playsInline,
          className: vidPrimary.className,
          objectFit: primaryStyle.objectFit,
          objectPosition: primaryStyle.objectPosition,
          opacity: Number(primaryStyle.opacity),
        },
        blendCanvas: {
          ariaHidden: canvasBlend.getAttribute("aria-hidden"),
          pointerEvents: canvasStyle.pointerEvents,
          opacity: Number(canvasStyle.opacity),
        },
        animations: [badge, h1, desc, ctaLink].map((el) => {
          const s = getComputedStyle(el);
          return {
            name: s.animationName,
            delay: s.animationDelay,
            duration: s.animationDuration,
          };
        }),
      };
    });

    expect(visualAudit.bodyFont.toLowerCase()).toContain("geist");
    expect(visualAudit.primaryVideo.autoplay).toBe(true);
    expect(visualAudit.primaryVideo.muted).toBe(true);
    expect(visualAudit.primaryVideo.playsInline).toBe(true);
    expect(visualAudit.primaryVideo.className).toContain("object-cover");
    expect(visualAudit.primaryVideo.objectFit).toBe("cover");
    expect(visualAudit.primaryVideo.objectPosition).toBe("70% 50%");
    expect(visualAudit.primaryVideo.opacity).toBeGreaterThanOrEqual(0.95);

    expect(visualAudit.blendCanvas.ariaHidden).toBe("true");
    expect(visualAudit.blendCanvas.pointerEvents).toBe("none");
    expect(visualAudit.blendCanvas.opacity).toBeLessThanOrEqual(0.05);

    expect(visualAudit.animations.map((a) => a.name)).toEqual([
      "fadeSlideUp",
      "fadeSlideUp",
      "fadeSlideUp",
      "fadeSlideUp",
    ]);
    expect(visualAudit.animations.map((a) => a.delay)).toEqual(["0.2s", "0.4s", "0.7s", "0.9s"]);
    expect(visualAudit.animations.map((a) => a.duration)).toEqual(["0.8s", "0.8s", "0.8s", "0.8s"]);

    // Verify navbar brand, links, and CTA button alignment without wrap/overlap on md+ viewports
    if (testInfo.project.name !== "mobile") {
      const headerItems = await Promise.all([
        page.locator("header a", { hasText: "SafeDeal" }).boundingBox(),
        page.locator("header nav[aria-label='Primary'] a", { hasText: "Home" }).boundingBox(),
        page.locator("header nav[aria-label='Primary'] a", { hasText: "How It Works" }).boundingBox(),
        page.locator("header nav[aria-label='Primary'] a", { hasText: "My Deals" }).boundingBox(),
        page.locator("header nav[aria-label='Primary'] a", { hasText: "Support" }).boundingBox(),
        page.locator("header button", { hasText: "Connect Wallet" }).boundingBox(),
      ]);
      expect(headerItems.every((box) => box !== null)).toBe(true);
      const validBoxes = headerItems.filter((box): box is NonNullable<typeof box> => box !== null);
      const centerYs = validBoxes.map((b) => b.y + b.height / 2);
      const maxCenterDiff = Math.max(...centerYs) - Math.min(...centerYs);
      expect(maxCenterDiff).toBeLessThanOrEqual(6);
      for (let i = 0; i < validBoxes.length; i += 1) {
        expect(validBoxes[i]!.height).toBeLessThanOrEqual(46);
        if (i + 1 < validBoxes.length) {
          expect(validBoxes[i]!.x + validBoxes[i]!.width).toBeLessThanOrEqual(validBoxes[i + 1]!.x + 1);
        }
      }
    }

    // Verify primary CTA stays strictly inside the single-screen Foldcraft hero viewport & settled opacity
    await expect.poll(async () => Number(await cta.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(
      0.95
    );
    const ctaBox = await cta.boundingBox();
    const viewport = page.viewportSize();
    expect(ctaBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (ctaBox && viewport) {
      expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(viewport.height);
      expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(viewport.width);
    }

    const landingScreenshotPath = `test-results/visual-audit/landing-${testInfo.project.name}.png`;
    const landingBytes = await page.screenshot({ path: landingScreenshotPath, fullPage: false });
    assertValidPngScreenshot(landingBytes, landingScreenshotPath);

    await cta.click();
    await expect(page).toHaveURL(/\/create$/);
    expect(pageErrors).toEqual([]);
  });

  test("exhibits zero horizontal overflow across all core routes at the active viewport", async ({ page }) => {
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

    for (const routePath of ROUTES_TO_AUDIT) {
      await page.goto(routePath);
      await page.waitForLoadState("domcontentloaded");
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        overflow.scrollWidth,
        `Horizontal overflow detected on ${routePath}: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`
      ).toBeLessThanOrEqual(overflow.innerWidth);
    }
  });

  test("mobile navigation drawer toggles open and closes smoothly via Close button and navigation", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile drawer test targets 390px viewport only");

    await page.goto("/");
    const drawer = page.getByTestId("mobile-menu");
    await expect(drawer).toHaveAttribute("aria-hidden", "true");

    const toggleButton = page.getByRole("button", { name: "Open menu" });
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    await expect(drawer).toHaveAttribute("aria-hidden", "false");
    const closeButton = page.getByRole("button", { name: "Close menu" });
    await expect(closeButton).toBeVisible();

    const mobileMenuShotPath = "test-results/visual-audit/landing-mobile-menu-open.png";
    await page.waitForTimeout(550);
    const mobileMenuBytes = await page.screenshot({ path: mobileMenuShotPath, fullPage: false });
    assertValidPngScreenshot(mobileMenuBytes, mobileMenuShotPath);

    await closeButton.click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "false");
    await drawer.getByRole("link", { name: "How It Works" }).click();

    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.getByRole("heading", { name: "How SafeDeal Works" })).toBeVisible();
    await expect(page.locator("nav[aria-label='Mobile']")).toHaveCount(0);
  });
});
