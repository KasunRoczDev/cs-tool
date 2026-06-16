'use client';

import { useDashboard } from '@/lib/useDashboard';

export default function DashboardCustomizer() {
  const { theme, toggleTheme, widgets, toggleWidget, dateRange, updateDateRange } = useDashboard();

  const handleStartDateChange = (e) => {
    updateDateRange(new Date(e.target.value), dateRange.end);
  };

  const handleEndDateChange = (e) => {
    updateDateRange(dateRange.start, new Date(e.target.value));
  };

  const formatDateForInput = (date) => {
    return date.toISOString().split('T')[0];
  };

  return (
    <div className="dashboard-customizer">
      <div className="customizer-row">
        {/* Theme Toggle */}
        <div className="customizer-group">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? '🌙' : '☀️'} {theme === 'light' ? 'Dark' : 'Light'} Mode
          </button>
        </div>

        {/* Date Range Selector */}
        <div className="customizer-group date-range-selector">
          <label htmlFor="start-date">From:</label>
          <input
            id="start-date"
            type="date"
            value={formatDateForInput(dateRange.start)}
            onChange={handleStartDateChange}
          />
          <label htmlFor="end-date">To:</label>
          <input
            id="end-date"
            type="date"
            value={formatDateForInput(dateRange.end)}
            onChange={handleEndDateChange}
          />
        </div>
      </div>

      {/* Widget Visibility Controls */}
      <div style={{ marginTop: '16px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
          Dashboard Widgets
        </h4>
        <div className="widget-list">
          {[
            { id: 'eventCount', label: 'Event Count' },
            { id: 'alertCount', label: 'Alert Count' },
            { id: 'incidentCount', label: 'Incident Count' },
            { id: 'securityTimeline', label: 'Security Timeline' },
            { id: 'recentAlerts', label: 'Recent Alerts' },
          ].map((widget) => (
            <label key={widget.id} className="widget-toggle">
              <input
                type="checkbox"
                checked={widgets[widget.id]}
                onChange={() => toggleWidget(widget.id)}
              />
              <span>{widget.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
