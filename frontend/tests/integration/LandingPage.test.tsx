import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { brandConfig } from "@/config/brand.config";
import { LandingPage } from "@/pages/LandingPage";

const openWalletModalMock = vi.fn();

vi.mock("@/features/authentication/hooks/useAuthSession", () => ({
  useAuthSession: () => ({
    address: undefined,
    isConnected: false,
    isWrongNetwork: false,
    openWalletModal: openWalletModalMock,
  }),
}));

describe("LandingPage (Foldcraft Hero Preservation)", () => {
  it("renders exact hero video, badge, 3-line headline, copy, and animations", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <LandingPage />
      </MemoryRouter>
    );

    const videos = Array.from(container.querySelectorAll("video"));
    expect(videos).toHaveLength(1);
    const primary = container.querySelector('video[data-hero-video="primary"]') as HTMLVideoElement | null;
    const blendCanvas = container.querySelector('canvas[data-hero-canvas="blend"]') as HTMLCanvasElement | null;
    expect(primary).not.toBeNull();
    expect(blendCanvas).not.toBeNull();
    expect(primary?.getAttribute("data-hero-src")).toBe(brandConfig.heroVideoUrl);
    expect(primary?.getAttribute("src")).toBe(brandConfig.heroVideoUrl);
    expect(primary?.hasAttribute("autoplay")).toBe(true);
    expect(primary?.className).toContain("object-cover");
    expect(primary?.className).toContain("object-[70%_center]");
    expect(primary?.muted).toBe(true);
    expect(primary?.playsInline).toBe(true);
    expect(blendCanvas?.getAttribute("aria-hidden")).toBe("true");
    expect(blendCanvas?.style.opacity).toBe("0");

    expect(screen.getByText("SafeDeal")).toBeInTheDocument();
    expect(screen.getByText("Secure P2P Transactions")).toBeInTheDocument();

    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.innerHTML).toContain("Trade with trust,<br>not with<br>blind faith.");
    expect(h1?.className).toContain("animate-[fadeSlideUp_0.8s_ease_0.4s_both]");

    const cta = screen.getByRole("link", { name: /create a deal/i });
    expect(cta).toHaveAttribute("href", "/create");
    expect(cta.className).toContain("animate-[fadeSlideUp_0.8s_ease_0.9s_both]");

    expect(screen.getAllByRole("link", { name: "Home" })[0]).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "My Deals" })[0]).toHaveAttribute("href", "/dashboard");
    expect(screen.getAllByRole("link", { name: "How It Works" })[0]).toHaveAttribute("href", "/how-it-works");
    expect(screen.getAllByRole("link", { name: "Support" })[0]).toHaveAttribute("href", "/support");
  });

  it("toggles mobile drawer menu open and closes it upon link click", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/how-it-works" element={<div>How It Works Destination</div>} />
        </Routes>
      </MemoryRouter>
    );

    const overlay = screen.getByTestId("mobile-menu");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay.className).toContain("h-0 opacity-0 pointer-events-none");

    const openBtn = screen.getByRole("button", { name: "Open menu" });
    await user.click(openBtn);

    expect(overlay).toHaveAttribute("aria-hidden", "false");
    expect(overlay.className).toContain("h-screen opacity-100");

    const mobileNav = screen.getByRole("navigation", { name: "Mobile", hidden: true });
    const mobileHowItWorksLink = mobileNav.querySelector('a[href="/how-it-works"]');
    expect(mobileHowItWorksLink).not.toBeNull();
    await user.click(mobileHowItWorksLink!);

    expect(screen.getByText("How It Works Destination")).toBeInTheDocument();
  });

  it("opens wallet modal when clicking desktop Connect Wallet", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    const walletButtons = screen.getAllByRole("button", { name: "Connect Wallet", hidden: true });
    await user.click(walletButtons[0]!);
    expect(openWalletModalMock).toHaveBeenCalled();
  });
});
