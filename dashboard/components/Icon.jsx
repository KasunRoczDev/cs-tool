const paths = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  monitoring: 'M3 12h4l3-8 4 16 3-8h4',
  products: 'm12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5',
  apps: 'M3 4h7v7H3z M14 4h7v7h-7z M3 16h7v5H3z M14 16h7v5h-7z',
  topology: 'M9 3h6v6H9z M2 16h6v6H2z M16 16h6v6h-6z M12 9v4 M5 16v-3h14v3',
  performance: 'M4 20V4 M4 20h17 M8 15l4-5 4 2 5-7',
  security: 'M12 3 3 7v5c0 5 5 8 9 10 4-2 9-5 9-10V7l-9-4Z m-4 9 3 3 5-6',
  alerts: 'm12 3 10 18H2L12 3Z M12 9v5 M12 17v.5',
  notifications: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  billing: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3Z M8 8h8 M8 12h8 M8 16h4',
  releases: 'M14 3h7v7 M21 3l-9 9 M10 4H4v16h16v-6',
  repositories: 'M4 3h13v14H4a2 2 0 0 0 0 4h16V7 M4 3v14 M8 7h5 M8 11h5',
  deployments: 'M12 3v12 M7 8l5-5 5 5 M4 15v6h16v-6',
  environments: 'M3 4h18v6H3z M3 14h18v6H3z M7 7h.01 M7 17h.01 M11 7h6 M11 17h6',
  setup: 'M4 3h16v18H4z M8 7h8 M8 12h8 M8 17h5',
  users: 'M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M2 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a5 5 0 0 1 3 4v2',
  access: 'M7 11V7a5 5 0 0 1 10 0v4 M4 11h16v11H4z M12 15v3',
  profile: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M4 21v-2a8 8 0 0 1 16 0v2',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  'admin-tools': 'M14 4a6 6 0 0 0-7 7L2 16l6 6 5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4Z',
  brand: 'M12 2 3 6v6c0 5 5 8 9 10 4-2 9-5 9-10V6l-9-4Z M7 7h10v7H7z M12 14v3 M9 17h6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'm6 6 12 12 M18 6 6 18',
  search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z M16 16l5 5',
  chevron: 'm9 5 7 7-7 7',
  logout: 'M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  moon: 'M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z',
};

export default function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name] || paths.monitoring} />
    </svg>
  );
}
