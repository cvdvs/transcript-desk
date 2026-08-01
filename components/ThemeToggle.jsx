"use client";

// Dark mode follows macOS automatically; this button overrides it either way.
// The override persists in localStorage (applied pre-paint by a layout script).

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(null); // null until mounted (avoids hydration mismatch)

  useEffect(() => {
    const attr = document.documentElement.dataset.theme;
    const dark = attr ? attr === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    setIsDark(dark);
  }, []);

  function toggle() {
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("td-theme", next);
    } catch {
      /* private mode */
    }
    setIsDark(!isDark);
  }

  if (isDark === null) return <span className="micro" style={{ width: 34 }} />;
  return (
    <button className="chip" onClick={toggle} title="Toggle appearance">
      {isDark ? "light" : "dark"}
    </button>
  );
}
