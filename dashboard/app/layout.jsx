import './globals.css';

export const metadata = {
  title: 'Monitoring Platform',
  description: 'Cybersecurity & server metrics monitoring',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
