'use client';

import { useState, useMemo } from 'react';

export default function PaginatedEventList({ events = [], loading = false, title = 'Events', itemsPerPage = 15 }) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(events.length / itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const pageEvents = events.slice(startIdx, endIdx);

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  if (loading) {
    return (
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
        Loading events...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
        No events found
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--panel-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{title}</h3>
        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      <div style={{ maxHeight: '500px', overflowY: 'auto', padding: '12px' }}>
        <div className="scrollable-events">
          {pageEvents.map((event, idx) => (
            <div key={event.id || `${startIdx}-${idx}`} className="event-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', background: getEventTypeColor(event.type), color: '#07101f' }}>
                    {event.type || 'event'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {event.severity && `${event.severity.toUpperCase()}`}
                  </span>
                </div>
                <div style={{ fontSize: '13px', marginBottom: '4px', color: 'var(--text)' }}>
                  {event.message || event.title || 'No message'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {event.source && <span>Source: {event.source}</span>}
                  {event.source_ip && <span>IP: {event.source_ip}</span>}
                  {event.timestamp && <span>{new Date(event.timestamp).toLocaleString()}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination-compact">
          <button onClick={() => handlePageChange(1)} disabled={currentPage === 1}>
            ⟨⟨
          </button>
          <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
            ⟨
          </button>

          {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
            const pageNum =
              totalPages <= 5
                ? i + 1
                : Math.max(1, currentPage - 2) + i <= totalPages
                  ? Math.max(1, currentPage - 2) + i
                  : null;
            return pageNum ? (
              <button
                key={pageNum}
                onClick={() => handlePageChange(pageNum)}
                className={currentPage === pageNum ? 'active' : ''}
              >
                {pageNum}
              </button>
            ) : null;
          })}

          <span className="pagination-info">
            {currentPage} / {totalPages}
          </span>

          <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>
            ⟩
          </button>
          <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages}>
            ⟩⟩
          </button>
        </div>
      )}

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--muted)', backgroundColor: 'var(--panel-2)' }}>
        Showing {Math.min(startIdx + 1, events.length)} to {Math.min(endIdx, events.length)} of {events.length} events
      </div>
    </div>
  );
}

function getEventTypeColor(type) {
  const colors = {
    alert: 'var(--warn)',
    incident: 'var(--crit)',
    log: 'var(--accent)',
    warning: 'var(--warn)',
    critical: 'var(--crit)',
    info: 'var(--accent)',
    error: 'var(--crit)',
    success: 'var(--ok)',
  };
  return colors[type?.toLowerCase()] || 'var(--muted)';
}
