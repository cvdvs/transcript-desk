import "./globals.css";
import Link from "next/link";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

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
            <ThemeToggle />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
