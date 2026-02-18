import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import AppLayout from './components/Layout/AppLayout';

// Pages
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import ListingsPage from './pages/ListingsPage';
import CrossListPage from './pages/CrossListPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ResearchPage from './pages/ResearchPage';
import InventoryPage from './pages/InventoryPage';
import SettingsPage from './pages/SettingsPage';
import PricingPage from './pages/PricingPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import AdminPage from './pages/AdminPage';
import EbayCallbackPage from './pages/EbayCallbackPage';
import EtsyCallbackPage from './pages/EtsyCallbackPage';

export default function App() {
  // Initialize auth listener
  useAuth();

  return (
    <Routes>
      {/* Auth page */}
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/callback" element={<AuthCallbackHandler />} />

      {/* All routes accessible without login */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/cross-list" element={<CrossListPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/payment-success" element={<PaymentSuccessPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/ebay/callback" element={<EbayCallbackPage />} />
        <Route path="/auth/etsy/callback" element={<EtsyCallbackPage />} />
      </Route>

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Handle OAuth callbacks (Supabase redirects back here)
function AuthCallbackHandler() {
  return (
    <div className="auth-page">
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Completing sign in...</p>
      </div>
    </div>
  );
}
