import { useEffect, useRef } from 'react';
import { config } from '../../config';

export function AdBanner() {
  const adRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !config.adsense.clientId) return;
    loaded.current = true;

    try {
      // Load AdSense script if not already present
      if (!document.querySelector('script[src*="adsbygoogle"]')) {
        const script = document.createElement('script');
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.adsense.clientId}`;
        script.async = true;
        script.crossOrigin = 'anonymous';
        document.head.appendChild(script);
      }

      // Push ad
      ((window as unknown as Record<string, unknown[]>).adsbygoogle = (window as unknown as Record<string, unknown[]>).adsbygoogle || []).push({});
    } catch {
      // Ad blocker likely active
    }
  }, []);

  if (!config.adsense.clientId) {
    return (
      <div className="ad-banner" style={{ marginBottom: 16 }}>
        <span className="ad-label">Advertisement</span>
      </div>
    );
  }

  return (
    <div className="ad-banner" style={{ marginBottom: 16 }} ref={adRef}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={config.adsense.clientId}
        data-ad-slot={config.adsense.slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
