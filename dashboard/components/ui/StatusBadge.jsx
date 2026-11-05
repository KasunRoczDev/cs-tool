const tones = {
  active: 'positive', healthy: 'positive', online: 'positive', success: 'positive',
  succeeded: 'positive', completed: 'positive', resolved: 'positive', approved: 'positive',
  warning: 'warning', degraded: 'warning', pending: 'warning', queued: 'warning',
  waiting: 'warning', paused: 'warning',
  critical: 'critical', error: 'critical', failed: 'critical', offline: 'critical',
  rejected: 'critical', blocked: 'critical', unhealthy: 'critical',
  running: 'info', deploying: 'info', in_progress: 'info', loading: 'info',
};

/** Unknown statuses retain their wording and use a neutral treatment. */
export default function StatusBadge({ status, children }) {
  const name = typeof status === 'string' ? status.trim() : '';
  const key = name.toLowerCase().replace(/[\s-]+/g, '_');
  const tone = Object.prototype.hasOwnProperty.call(tones, key) ? tones[key] : 'neutral';
  const text = name ? name.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) : 'Unknown';

  return (
    <span className={`ui-badge ui-status-badge ui-tone--${tone}`}>
      <span className="ui-status-dot" aria-hidden="true" />
      <span>{children ?? text}</span>
    </span>
  );
}
