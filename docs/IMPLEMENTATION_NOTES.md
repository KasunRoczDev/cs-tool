# Dashboard Implementation Notes

## What Was Created

### Components
1. **DashboardCustomizer.jsx**
   - Theme toggle button (Light/Dark mode)
   - Date range selector (From/To dates)
   - Widget visibility checkboxes
   - All preferences saved to localStorage

2. **MetricsGrid.jsx**
   - Three metric cards (Events, Alerts, Incidents)
   - Shows count values with color coding
   - Respects widget visibility settings
   - Responsive grid layout

3. **SecurityEventTimeline.jsx**
   - Paginated timeline of security events
   - Supports filtering by event type
   - Date range filtering integration
   - Pagination controls (First, Previous, Page numbers, Next, Last)
   - Shows result counts and current page info
   - Color-coded event badges (Alert, Incident, Log)
   - Displays timestamp, message, source, and severity

### Context & State
1. **DashboardContext.jsx**
   - Manages theme preference
   - Manages widget visibility state
   - Manages date range filter
   - Persists preferences to localStorage
   - Provides hooks: `useDashboard()`

### Styles
- Updated **globals.css** with:
  - CSS variables for light/dark themes
  - Theme transition animations
  - New component styling classes
  - Responsive design patterns

### Pages
1. **app/dashboard/page.jsx**
   - Main dashboard entry point
   - Wraps components with DashboardProvider
   - Generates sample events (150 events)
   - Integrates all customization features
   - Shows example Recent Alerts widget

## How to Access the Dashboard

1. **Development**
   ```bash
   cd dashboard
   npm run dev
   ```
   Dashboard available at: `http://localhost:5173/dashboard`

2. **Production**
   ```bash
   npm run build
   npm start
   ```

## Data Integration

### Current State
The dashboard uses sample data generated on component mount. To connect real data:

### Step 1: Update Dashboard Page
Modify `/app/dashboard/page.jsx` to fetch real events:

```javascript
useEffect(() => {
  setLoading(true);
  
  // Fetch from your backend
  fetch(`/api/security-events?start=${dateRange.start}&end=${dateRange.end}`)
    .then(res => res.json())
    .then(data => {
      setEvents(data);
      setLoading(false);
    })
    .catch(err => {
      console.error(err);
      setLoading(false);
    });
}, [dateRange]);
```

### Step 2: Real-time Updates (Optional)
Add Socket.io connection:

```javascript
useEffect(() => {
  const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL);
  
  socket.on('security-event', (event) => {
    setEvents(prev => [event, ...prev]);
  });
  
  return () => socket.disconnect();
}, []);
```

### Step 3: Backend API Endpoint
Ensure your backend provides:
- `GET /api/security-events` - Fetch events
- `WebSocket /socket.io` - Real-time events (optional)

Expected response format:
```json
[
  {
    "id": "event-123",
    "timestamp": "2026-06-16T10:30:00Z",
    "type": "alert",
    "source": "Firewall",
    "severity": "High",
    "message": "Unauthorized access attempt detected",
    "title": "Unauthorized Access"
  }
]
```

## Customization Quick Reference

### Add New Widget
1. Add to context initial state (DashboardContext.jsx)
2. Add checkbox in DashboardCustomizer (components)
3. Wrap component with conditional: `{widgets.myWidget && <MyWidget />}`

### Change Theme Colors
Edit in `globals.css`:
```css
[data-theme="light"] {
  --bg: #your-color;
  --panel: #your-color;
  --text: #your-color;
  /* ... etc */
}
```

### Adjust Pagination Items
Edit in `SecurityEventTimeline.jsx`:
```javascript
const itemsPerPage = 10; // Change this
```

### Add New Event Types
Edit event type filtering in `SecurityEventTimeline.jsx` and `DashboardCustomizer.jsx`

## Environment Variables

Add to `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

## Dependencies

All required dependencies are already in `package.json`:
- `next: ^14.2.13`
- `react: ^18.3.1`
- `react-dom: ^18.3.1`
- `recharts: ^2.12.7` (for charts)
- `socket.io-client: ^4.8.0` (for real-time)

## Testing the Dashboard

### Manual Testing
1. Navigate to `/dashboard`
2. Test theme toggle - reload page to verify persistence
3. Test widget toggles - check visibility changes and persistence
4. Test date range - verify events filter by date
5. Test pagination - navigate through pages
6. Test event filtering - filter by type

### Sample Data Override
Edit `generateSampleEvents()` in `/app/dashboard/page.jsx` to test with different data:

```javascript
function generateSampleEvents(count = 50) {
  // Modify this to return your test data
  return [
    {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      type: 'alert',
      source: 'Test Source',
      severity: 'High',
      message: 'Test event',
      title: 'Test Event'
    }
  ];
}
```

## Troubleshooting

### Theme Not Persisting
- Check if localStorage is enabled
- Check browser console for errors
- Verify `dashboard-theme` key in localStorage

### Widgets Not Showing/Hiding
- Check widget name matches in all three places
- Verify DashboardProvider wraps the component
- Check useContext error messages

### Pagination Not Working
- Verify events array has data
- Check `itemsPerPage` value
- Ensure `totalPages` calculation is correct

### Date Range Not Filtering
- Verify event objects have `timestamp` property
- Check date format is ISO string
- Verify date range state updates

## Next Steps

1. Connect to backend API endpoints
2. Add real-time WebSocket updates
3. Implement user authentication/authorization
4. Add more visualization charts
5. Create alert notification system
6. Add event export functionality
7. Implement advanced filtering/search
