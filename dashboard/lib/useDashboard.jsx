'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const DashboardContext = createContext();

export function DashboardProvider({ children }) {
  const [theme, setTheme] = useState('light');
  const [widgets, setWidgets] = useState({
    eventCount: true,
    alertCount: true,
    incidentCount: true,
    securityTimeline: true,
    recentAlerts: true,
  });
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    end: new Date(),
  });

  // Load preferences from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('dashboard-theme');
    const savedWidgets = localStorage.getItem('dashboard-widgets');
    const savedDateRange = localStorage.getItem('dashboard-daterange');

    if (savedTheme) setTheme(savedTheme);
    if (savedWidgets) setWidgets(JSON.parse(savedWidgets));
    if (savedDateRange) {
      const range = JSON.parse(savedDateRange);
      setDateRange({
        start: new Date(range.start),
        end: new Date(range.end),
      });
    }

    // Apply theme to document
    document.documentElement.setAttribute('data-theme', savedTheme || 'light');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('dashboard-theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const toggleWidget = (widgetName) => {
    const updated = { ...widgets, [widgetName]: !widgets[widgetName] };
    setWidgets(updated);
    localStorage.setItem('dashboard-widgets', JSON.stringify(updated));
  };

  const updateDateRange = (start, end) => {
    setDateRange({ start, end });
    localStorage.setItem(
      'dashboard-daterange',
      JSON.stringify({ start: start.toISOString(), end: end.toISOString() })
    );
  };

  return (
    <DashboardContext.Provider
      value={{ theme, toggleTheme, widgets, toggleWidget, dateRange, updateDateRange }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return context;
}
