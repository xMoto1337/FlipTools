import { useResearchStore } from '../../stores/researchStore';
import { getAllPlatforms } from '../../api/platforms';
import { useFeatureGate } from '../../hooks/useSubscription';
import { PaywallGate } from '../Subscription/PaywallGate';
import { formatCurrency } from '../../utils/formatters';

interface ProfitCalculatorProps {
  avgPrice: number;
}

export function ProfitCalculator({ avgPrice }: ProfitCalculatorProps) {
  const { costInput, shippingCostInput, setCostInput, setShippingCostInput } = useResearchStore();
  const { allowed: multiPlatform } = useFeatureGate('profit-calculator-multi');
  const platforms = getAllPlatforms();

  return (
    <div className="card profit-calc">
      <div className="card-header">
        <div className="card-title">Profit Calculator</div>
      </div>

      <div className="profit-calc-input-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Your Cost ($)</label>
          <input
            type="number"
            className="form-input"
            value={costInput || ''}
            onChange={(e) => setCostInput(Number(e.target.value))}
            placeholder="0.00"
          />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Shipping ($)</label>
          <input
            type="number"
            className="form-input"
            value={shippingCostInput || ''}
            onChange={(e) => setShippingCostInput(Number(e.target.value))}
            placeholder="0.00"
          />
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Based on avg sold price of {formatCurrency(avgPrice)}
      </div>

      {platforms.map((platform, i) => {
        // First platform (eBay) always visible, rest are Pro-only
        if (i > 0 && !multiPlatform) {
          return null;
        }

        const fees = platform.calculateFees(avgPrice);
        const netProfit = fees.netProceeds - costInput - shippingCostInput;
        const roi = costInput > 0 ? (netProfit / costInput) * 100 : 0;

        const verdictClass = roi > 30 ? 'worth-it' : roi > 10 ? 'marginal' : 'not-worth';
        const verdictText = roi > 30 ? 'Worth It!' : roi > 10 ? 'Marginal' : 'Not Worth It';
        const verdictIcon = roi > 30 ? '✓' : roi > 10 ? '~' : '✗';

        return (
          <div key={platform.id} className="profit-calc-platform-row">
            <div className="profit-calc-platform-header">
              <span className={`platform-badge ${platform.id}`}>{platform.name}</span>
              {costInput > 0 && (
                <span className={`profit-calc-verdict ${verdictClass}`}>
                  {verdictIcon} {verdictText}
                </span>
              )}
            </div>
            <div className="profit-calc-breakdown">
              <div className="profit-calc-line">
                <span>Sale Price</span>
                <span>{formatCurrency(avgPrice)}</span>
              </div>
              <div className="profit-calc-line">
                <span>Platform Fees</span>
                <span style={{ color: 'var(--neon-red)' }}>-{formatCurrency(fees.totalFees)}</span>
              </div>
              {costInput > 0 && (
                <div className="profit-calc-line">
                  <span>Your Cost</span>
                  <span style={{ color: 'var(--neon-red)' }}>-{formatCurrency(costInput)}</span>
                </div>
              )}
              {shippingCostInput > 0 && (
                <div className="profit-calc-line">
                  <span>Shipping</span>
                  <span style={{ color: 'var(--neon-red)' }}>-{formatCurrency(shippingCostInput)}</span>
                </div>
              )}
              <div className="profit-calc-line profit-calc-total">
                <span>Net Profit</span>
                <span style={{ color: netProfit >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                  {formatCurrency(netProfit)}
                </span>
              </div>
              {costInput > 0 && (
                <div className="profit-calc-line">
                  <span>ROI</span>
                  <span style={{ color: roi >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                    {roi.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {!multiPlatform && platforms.length > 1 && (
        <PaywallGate feature="Multi-Platform Profit Analysis">
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            +{platforms.length - 1} more platform{platforms.length > 2 ? 's' : ''}
          </div>
        </PaywallGate>
      )}
    </div>
  );
}
