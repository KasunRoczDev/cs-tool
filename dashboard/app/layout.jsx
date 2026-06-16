import './globals.css';
import Providers from './Providers';

export const metadata = {
  title: 'Monitoring Platform',
  description: 'Cybersecurity & server metrics monitoring',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
