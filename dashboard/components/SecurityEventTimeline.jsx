'use client';

import { useState, useEffect } from 'react';
import { useDashboard } from '@/lib/useDashboard';

export default function SecurityEventTimeline({ events = [], loading = false, onLoad = () => {} }) {
  const { widgets, dateRange } = useDashboard();
  const [currentPage, setCurrentPage] = useState(1);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const itemsPerPage = 10;

  // Filter events by date range and type
  useEffect(() => {
    let filtered = events.filter((event) => {
      const eventDate = new Date(event.timestamp || event.date);
      const inRange = eventDate >= dateRange.start && eventDate <= dateRange.end;
      const typeMatch = filterType === 'all' || event.type === filterType;
      return inRange && typeMatch;
    });

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => {
      const dateA = new Date(a.timestamp || a.date);
      const dateB = new Date(b.timestamp || b.date);
      return dateB - dateA;
    });

    setFilteredEvents(filtered);
    setCurrentPage(1);
  }, [events, dateRange, filterType]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredEvents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEvents = filteredEvents.slice(startIndex, endIndex);

  // Format timestamp
  const formatTime = (timestamp) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  // Get event badge color
  const getEventBadgeClass = (type) => {
    const typeMap = {
      alert: 'alert',
      incident: 'incident',
      log: 'log',
      warning: 'alert',
      critical: 'incident',
      info: 'log',
    };
    return typeMap[type?.toLowerCase()] || 'log';
  };

  if (!widgets.securityTimeline) {
    return null;
  }

  return (
    <div className="timeline-wrapper">
      <div className="timeline-header">
        <h3>Security Event Timeline</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ margin: 0, display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Filter:</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ width: 'auto', minWidth: '100px' }}
            >
              <option value="all">All Types</option>
              <option value="alert">Alerts</option>
              <option value="incident">Incidents</option>
              <option value="log">Logs</option>
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>
          Loading events...
        </div>
      ) : filteredEvents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>
          No events found for the selected date range.
        </div>
      ) : (
        <>
          <div className="timeline">
            {currentEvents.map((event, idx) => (
              <div key={`${event.id || idx}`} className="event-item">
                <div className="event-time">{formatTime(event.timestamp || event.date)}</div>
                <div className="event-content">
                  <span className={`event-type ${getEventBadgeClass(event.type)}`}>
                    {event.type || 'Log'}
                  </span>
                  <div className="event-message">{event.message || event.title || 'No message'}</div>
                  <div className="event-details">
                    {event.source && <span>Source: {event.source}</span>}
                    {event.source && event.severity && ' • '}
                    {event.severity && <span>Severity: {event.severity}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
              >
                ← Previous
              </button>

              {/* Page numbers */}
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
                    onClick={() => setCurrentPage(pageNum)}
                    className={currentPage === pageNum ? 'active' : ''}
                  >
                    {pageNum}
                  </button>
                ) : null;
              })}

              <span className="page-info">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
              >
                Next →
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
              >
                Last
              </button>
            </div>
          )}

          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
            Showing {startIndex + 1} to {Math.min(endIndex, filteredEvents.length)} of {filteredEvents.length} events
          </div>
        </>
      )}
    </div>
  );
}
