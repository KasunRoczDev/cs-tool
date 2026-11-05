/** Neutral panel. Use `as` for the appropriate HTML element; headings belong to callers. */
export default function Surface({ as: Element = 'div', className = '', children }) {
  return <Element className={`ui-surface${className ? ` ${className}` : ''}`}>{children}</Element>;
}
