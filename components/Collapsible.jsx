"use client";

// Caps long content at a set height with a fade and a show more / show less
// toggle. Short content renders untouched (no button).

import { useEffect, useRef, useState } from "react";

export default function Collapsible({ maxHeight = 360, children }) {
  const ref = useRef(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setTall(el.scrollHeight > maxHeight + 40);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);

  const clipped = tall && !open;
  return (
    <div>
      <div
        ref={ref}
        className={clipped ? "collapsible clipped" : "collapsible"}
        style={clipped ? { maxHeight } : undefined}
      >
        {children}
      </div>
      {tall && (
        <button className="collapse-toggle" onClick={() => setOpen(!open)}>
          {open ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}
