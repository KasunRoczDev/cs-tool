/** Pass id to label the owning section with aria-labelledby when needed. */
export default function SectionHeader({ title, description, actions, id }) {
  return (
    <header className="section-header">
      <div className="section-header-copy">
        <h2 id={id}>{title}</h2>
        {description && <p className="section-header-description">{description}</p>}
      </div>
      {actions && <div className="section-header-actions">{actions}</div>}
    </header>
  );
}
