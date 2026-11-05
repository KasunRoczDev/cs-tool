import Breadcrumbs from './Breadcrumbs';

export default function PageHeader({ workspace, title, description, breadcrumbs, actions, wide = false }) {
  return (
    <header className={`page-header${wide ? ' page-header--wide' : ''}`}>
      {(workspace || breadcrumbs?.length > 0) && (
        <div className="page-header-context">
          {workspace && <span className="page-header-workspace">{workspace}</span>}
          <Breadcrumbs items={breadcrumbs} />
        </div>
      )}
      <div className="page-header-row">
        <div className="page-header-copy">
          <h1>{title}</h1>
          {description && <p className="page-header-description">{description}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}
