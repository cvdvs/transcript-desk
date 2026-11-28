import "./globals.css";
import Link from "next/link";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import ClaudeBanner from "../components/ClaudeBanner";

export const metadata = {
  title: "Transcript Desk",
  description: "Videos in. Transcripts, summaries, research out. Runs on your Mac.",
  appleWebApp: {
    capable: true,
    title: "Transcript Desk",
    statusBarStyle: "default",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* apply the saved theme override before anything paints */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("td-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
        <div className="container">
          <header className="topbar">
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <Logo size={21} />
              <span className="logo-name">Transcript Desk</span>
            </Link>
            <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Link href="/reading" className="micro" style={{ color: "var(--ink)" }}>
                reading
              </Link>
              <Link href="/settings" className="micro settings-link" style={{ color: "var(--ink)" }} aria-label="settings">
                <svg className="gear" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12.00 4.40 L13.95 2.19 L15.83 2.76 L16.22 5.68 L17.37 6.63 L20.31 6.44 L21.24 8.17 L19.45 10.52 L19.60 12.00 L21.81 13.95 L21.24 15.83 L18.32 16.22 L17.37 17.37 L17.56 20.31 L15.83 21.24 L13.48 19.45 L12.00 19.60 L10.05 21.81 L8.17 21.24 L7.78 18.32 L6.63 17.37 L3.69 17.56 L2.76 15.83 L4.55 13.48 L4.40 12.00 L2.19 10.05 L2.76 8.17 L5.68 7.78 L6.63 6.63 L6.44 3.69 L8.17 2.76 L10.52 4.55 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <span className="settings-label">settings</span>
              </Link>
              <ThemeToggle />
            </span>
          </header>
          <ClaudeBanner />
          {children}
        </div>
      </body>
    </html>
  );
}
