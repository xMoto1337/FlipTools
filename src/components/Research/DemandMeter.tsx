interface DemandMeterProps {
  score: number;
  label: string;
}

export function DemandMeter({ score, label }: DemandMeterProps) {
  const clampedScore = Math.max(0, Math.min(100, score));

  return (
    <div className="demand-meter">
      <div className="demand-meter-bar">
        <div
          className="demand-meter-marker"
          style={{ left: `${clampedScore}%` }}
        />
      </div>
      <div className="demand-meter-info">
        <span className="demand-meter-label">{label}</span>
        <span className="demand-meter-score">{clampedScore}</span>
      </div>
    </div>
  );
}
