import { useSettingsStore } from '../../stores/settingsStore';

interface HeaderProps {
  title: string;
}

export default function Header({ title }: HeaderProps) {
  const { toggleSidebar, setSidebarMobileOpen, sidebarMobileOpen } = useSettingsStore();

  const handleMenuClick = () => {
    if (window.innerWidth <= 768) {
      setSidebarMobileOpen(!sidebarMobileOpen);
    } else {
      toggleSidebar();
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-btn" onClick={handleMenuClick} title="Toggle sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="header-logo-mobile">
          <img src="/logo.png" alt="" className="header-logo-img" />
          FlipTools
        </span>
        <h1 className="header-title">{title}</h1>
      </div>
      <div className="header-right">
        <button className="header-btn" title="Notifications">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </button>
      </div>
    </header>
  );
}
