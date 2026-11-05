import Icon from '../Icon';

const defaults = {
  loading: { title: 'Loading', icon: 'monitoring' },
  empty: { title: 'No results', icon: 'search' },
  error: { title: 'Unable to load data', icon: 'alerts' },
};

/** `action` is a caller-owned control, including its disabled/submitting behavior. */
export default function FeedbackState({ kind = 'empty', title, description, action, compact = false }) {
  const mode = Object.prototype.hasOwnProperty.call(defaults, kind) ? kind : 'empty';
  const state = defaults[mode];

  return (
    <div className={`ui-feedback ui-feedback--${mode}${compact ? ' ui-feedback--compact' : ''}`}
      aria-busy={mode === 'loading'}>
      <div className="ui-feedback-message" role={mode === 'error' ? 'alert' : 'status'} aria-atomic="true">
        <span className="ui-feedback-icon"><Icon name={state.icon} size={20} /></span>
        <div className="ui-feedback-copy">
          <p className="ui-feedback-title">{title ?? state.title}</p>
          {description != null && <p className="ui-feedback-description">{description}</p>}
        </div>
      </div>
      {action != null && <div className="ui-feedback-action">{action}</div>}
    </div>
  );
}
