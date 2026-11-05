import Breadcrumbs from './Breadcrumbs';

export default function PageHeader({ title, description, breadcrumbs, actions, wide = false }) {
  return (
    <header className={`page-header${wide ? ' page-header--wide' : ''}`}>
      {breadcrumbs?.length > 0 && (
        <div className="page-header-context">
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
