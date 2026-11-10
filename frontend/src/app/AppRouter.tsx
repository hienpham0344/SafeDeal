import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { LandingPage } from "@/pages/LandingPage";
import { HowItWorksPage } from "@/pages/HowItWorksPage";
import { SupportPage } from "@/pages/SupportPage";
import { CreateDealPage } from "@/pages/CreateDealPage";
import { DealDetailsPage } from "@/pages/DealDetailsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DisputePage } from "@/pages/DisputePage";
import { ArbiterPage } from "@/pages/ArbiterPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path={ROUTES.home} element={<LandingPage />} />
        <Route path={ROUTES.howItWorks} element={<HowItWorksPage />} />
        <Route path={ROUTES.support} element={<SupportPage />} />
        <Route path={ROUTES.create} element={<CreateDealPage />} />
        <Route path={ROUTES.dealDetails} element={<DealDetailsPage />} />
        <Route path={ROUTES.dashboard} element={<DashboardPage />} />
        <Route path={ROUTES.disputeDetails} element={<DisputePage />} />
        <Route path={ROUTES.arbiter} element={<ArbiterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
