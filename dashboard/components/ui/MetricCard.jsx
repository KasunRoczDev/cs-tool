import Surface from './Surface';

/** `detail` and `trend` are readable React nodes, not inferred changes or direction. */
export default function MetricCard({ label, value, detail, tone = 'neutral', trend }) {
  const variant = ['positive', 'warning', 'critical'].includes(tone) ? tone : 'neutral';

  return (
    <Surface className={`ui-metric ui-tone--${variant}`}>
      <dl className="ui-metric-data">
        <dt>{label}</dt>
        <dd>{value ?? 'Unavailable'}</dd>
      </dl>
      {detail != null && <div className="ui-metric-detail">{detail}</div>}
      {trend != null && <div className="ui-metric-trend">{trend}</div>}
    </Surface>
  );
}
