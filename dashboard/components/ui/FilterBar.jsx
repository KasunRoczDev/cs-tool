/** A labeled group, not a form: callers own submit/reset and filter state. */
export default function FilterBar({ label = 'Filters', children, actions }) {
  return (
    <div className="ui-filter-bar" role="group" aria-label={label}>
      <div className="ui-filter-fields">{children}</div>
      {actions != null && <div className="ui-filter-actions">{actions}</div>}
    </div>
  );
}
