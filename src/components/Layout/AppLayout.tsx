import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { AdBanner } from '../Ads/AdBanner';
import { SignInModal } from '../Auth/SignInModal';
import { useAds } from '../../hooks/useAds';
import { useSettingsStore } from '../../stores/settingsStore';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/listings': 'Listings',
  '/cross-list': 'Cross List',
  '/analytics': 'Analytics',
  '/research': 'Research',
  '/inventory': 'Inventory',
  '/settings': 'Settings',
  '/pricing': 'Pricing',
};

export default function AppLayout() {
  const location = useLocation();
  const { showAds } = useAds();
  const { sidebarMobileOpen, setSidebarMobileOpen } = useSettingsStore();
  const title = pageTitles[location.pathname] || 'FlipTools';

  // Close mobile sidebar on navigation
  useEffect(() => {
    setSidebarMobileOpen(false);
  }, [location.pathname, setSidebarMobileOpen]);

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {sidebarMobileOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarMobileOpen(false)} />
      )}
      <Sidebar />
      <div className="app-main">
        <Header title={title} />
        <div className="app-content">
          {showAds && <AdBanner />}
          <Outlet />
        </div>
      </div>
      <SignInModal />
    </div>
  );
}
