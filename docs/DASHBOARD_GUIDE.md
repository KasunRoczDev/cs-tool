# Security Dashboard Guide

## Overview

The new Security Dashboard provides a comprehensive view of security events, alerts, and incidents with full customization capabilities. The dashboard is built with Next.js 14 and React 18, featuring real-time updates via Socket.io and interactive visualizations using Recharts.

## Features

### 1. **Main Dashboard** (`/dashboard`)
The central hub displaying security metrics and events with the following components:

#### Metrics Grid
- **Event Count**: Total security events detected
- **Active Alerts**: Current active security alerts
- **Incident Count**: Number of active incidents

Each metric card is individually toggleable via the customizer.

#### Security Event Timeline
- Paginated view of security events (10 items per page)
- Events sorted by timestamp (newest first)
- Color-coded event types:
  - **Alert** (Yellow badge)
  - **Incident** (Red badge)
  - **Log** (Blue badge)
- Filtering by event type (All, Alerts, Incidents, Logs)
- Date range filtering

#### Recent Alerts Widget
- Grid display of the 6 most recent alerts
- Shows timestamp, message, source, and severity
- Color-coded by severity level

### 2. **Dashboard Customizer**
Located at the top of the dashboard, providing:

#### Theme Toggle
- Switch between Light and Dark modes
- Selection persists across sessions
- Smooth color transitions
- Button displays current theme and icon indicator (☀️ for light, 🌙 for dark)

#### Date Range Selector
- From/To date pickers for filtering events
- Supports filtering all time-based components
- Changes persist in localStorage

#### Widget Visibility Controls
- Toggle visibility of individual dashboard widgets:
  - Event Count
  - Alert Count
  - Incident Count
  - Security Timeline
  - Recent Alerts
- All preferences saved to localStorage

### 3. **Pagination System**
The Security Event Timeline includes advanced pagination:

- **First/Last**: Jump to start/end of results
- **Previous/Next**: Navigate one page at a time
- **Page Numbers**: Direct page selection (displays up to 5 page buttons)
- **Page Info**: Shows "Current Page / Total Pages"
- **Results Counter**: "Showing X to Y of Z events"

## Directory Structure

```
dashboard/
├── app/
│   ├── dashboard/
│   │   └── page.jsx          # Main dashboard page
│   ├── globals.css           # Updated with theme variables
│   ├── layout.jsx
│   └── login/
├── components/
│   ├── DashboardCustomizer.jsx      # Customization controls
│   ├── MetricsGrid.jsx              # Metrics cards
│   ├── SecurityEventTimeline.jsx    # Paginated timeline
│   ├── MetricChart.jsx              # Existing chart component
│   ├── RegisterServer.jsx           # Existing component
│   └── Shell.jsx                    # Existing component
├── context/
│   └── DashboardContext.jsx         # React context for state management
├── lib/
├── public/
├── package.json
├── next.config.js
└── jsconfig.json
```

## Theme System

### CSS Variables
The dashboard uses CSS custom properties for theming. Two themes are available:

#### Dark Theme (Default)
- Background: `#0e1117`
- Panel: `#161a22`
- Text: `#e6eaf0`
- Accent: `#4f9dff`

#### Light Theme
- Background: `#ffffff`
- Panel: `#f5f5f5`
- Text: `#1a1a1a`
- Accent: `#0066cc`

### Applying Theme
Themes are applied via `data-theme` attribute on the document root:
```html
<html data-theme="light">
```

## State Management

### DashboardContext
Manages global dashboard state:
- `theme`: Current theme (light/dark)
- `toggleTheme()`: Switch theme
- `widgets`: Object tracking widget visibility
- `toggleWidget(name)`: Toggle widget visibility
- `dateRange`: Object with start/end dates
- `updateDateRange(start, end)`: Update date filter

### LocalStorage Keys
- `dashboard-theme`: Current theme preference
- `dashboard-widgets`: Widget visibility state
- `dashboard-daterange`: Date range filter

## Data Format

### Event Object Structure
```javascript
{
  id: string,
  timestamp: ISO date string,
  type: 'alert' | 'incident' | 'log',
  source: string,
  severity: 'Low' | 'Medium' | 'High' | 'Critical',
  message: string,
  title: string
}
```

## Integration with Backend

The dashboard accepts events as props. To connect with your backend:

### Option 1: Socket.io Real-time Updates
```javascript
import io from 'socket.io-client';

useEffect(() => {
  const socket = io('http://your-backend-url');
  socket.on('security-event', (event) => {
    setEvents(prev => [event, ...prev]);
  });
  
  return () => socket.disconnect();
}, []);
```

### Option 2: REST API Polling
```javascript
useEffect(() => {
  const fetchEvents = async () => {
    const response = await fetch('/api/security-events', {
      params: {
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString()
      }
    });
    const data = await response.json();
    setEvents(data);
  };

  const interval = setInterval(fetchEvents, 5000); // Poll every 5s
  return () => clearInterval(interval);
}, [dateRange]);
```

## Customization Examples

### Adding a New Widget
1. Add widget name to `DashboardContext.jsx` initial state
2. Add toggle option in `DashboardCustomizer.jsx`
3. Add conditional rendering in dashboard page
4. Add corresponding CSS styles

### Changing Color Scheme
Update CSS variables in `globals.css`:
```css
[data-theme="custom"] {
  --bg: #your-color;
  --panel: #your-color;
  /* ... other variables */
}
```

### Adjusting Items Per Page
In `SecurityEventTimeline.jsx`, change:
```javascript
const itemsPerPage = 10; // Change this value
```

## Performance Considerations

- Events are filtered and sorted on the client side
- Pagination reduces DOM nodes for large datasets
- Theme switching uses CSS variables (no re-renders)
- Widget visibility uses context to avoid prop drilling
- LocalStorage caching for preferences

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Requires JavaScript enabled
- LocalStorage must be available

## Future Enhancements

- WebSocket connections for real-time updates
- Advanced filtering and search
- Event export functionality
- Custom metric calculations
- Alert rules and automation
- Data persistence to backend
- Role-based widget visibility
