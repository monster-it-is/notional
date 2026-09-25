import { Route, Routes } from "react-router";

import { AuthLayout } from "../layouts/AuthLayout.tsx";
import { AuthenticatedLayout } from "../layouts/AuthenticatedLayout.tsx";
import { ProtectedRoute } from "../layouts/ProtectedRoute.tsx";
import { PublicLayout } from "../layouts/PublicLayout.tsx";
import { AccountPage } from "../pages/AccountPage.tsx";
import { HistoryPage } from "../pages/HistoryPage.tsx";
import { LandingPage } from "../pages/LandingPage.tsx";
import { NotFoundPage } from "../pages/NotFoundPage.tsx";
import { SignInPage } from "../pages/SignInPage.tsx";
import { SignUpPage } from "../pages/SignUpPage.tsx";
import { TradePage } from "../pages/TradePage.tsx";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
      </Route>
      <Route element={<AuthLayout />}>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AuthenticatedLayout />}>
          <Route path="/trade" element={<TradePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
