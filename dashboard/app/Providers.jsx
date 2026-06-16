'use client';

import { DashboardProvider } from '@/lib/useDashboard';

export default function Providers({ children }) {
  return <DashboardProvider>{children}</DashboardProvider>;
}
