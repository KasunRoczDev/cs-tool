import FeedbackState from './FeedbackState';

/**
 * columns: { key, header, render?(row, index), align? ('left'|'center'|'right'), rowHeader? }[].
 * rows: objects; rowKey: stable property name (default 'id') or (row, index) => key.
 * empty: React node; density: 'comfortable'|'compact'; responsive: 'scroll'|'wrap'; label: accessible name for the scroll region.
 * Scroll preserves column widths; wrap keeps a fixed-layout semantic table in its container.
 */
export default function DataTable({ columns = [], rows = [], rowKey = 'id', empty, density = 'comfortable', responsive = 'scroll', label = 'Data table' }) {
  const mode = responsive === 'wrap' ? 'wrap' : 'scroll';
  const spacing = density === 'compact' ? 'compact' : 'comfortable';
  const alignment = (column) => ['left', 'center', 'right'].includes(column.align) ? column.align : 'left';

  return (
    <div className={`ui-data-table ui-data-table--${mode} ui-data-table--${spacing}`}
      role={mode === 'scroll' ? 'region' : undefined}
      aria-label={mode === 'scroll' ? label : undefined}
      tabIndex={mode === 'scroll' ? 0 : undefined}>
      <table>
        <thead>
          <tr>{columns.map((column) => (
            <th key={column.key} scope="col" className={`ui-table-align--${alignment(column)}`}>
              {column.header ?? column.key}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={Math.max(columns.length, 1)} className="ui-table-empty">
              {empty ?? <FeedbackState kind="empty" compact />}
            </td></tr>
          ) : rows.map((row, index) => (
            <tr key={(typeof rowKey === 'function' ? rowKey(row, index) : row[rowKey]) ?? index}>
              {columns.map((column) => {
                const Cell = column.rowHeader ? 'th' : 'td';
                return (
                  <Cell key={column.key} scope={column.rowHeader ? 'row' : undefined}
                    className={`ui-table-align--${alignment(column)}`}>
                    {column.render ? column.render(row, index) : row[column.key] ?? 'Unavailable'}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
