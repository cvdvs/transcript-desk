"use client";

// The library's filter dropdown: status, folder, source, extras, and sort in
// one panel behind a filter button. Closes on outside click or Escape.

import { useEffect, useRef } from "react";

export function FunnelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.5 2.5h13l-5 6v5l-3 1.5v-6.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function Option({ active, onClick, children, count }) {
  return (
    <button className={`fp-option ${active ? "active" : ""}`} onClick={onClick}>
      <span className="fp-check">{active ? "●" : ""}</span>
      <span className="fp-label">{children}</span>
      {count != null && <span className="fp-count">{count}</span>}
    </button>
  );
}

export default function FilterPanel({ open, onClose, f, set, counts, folders, platforms }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest(".filter-btn")) onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="filter-panel" ref={ref}>
      <div className="fp-col">
        <div className="fp-head">status</div>
        <Option active={f.done === null} onClick={() => set({ done: null })} count={counts.all}>any</Option>
        <Option active={f.done === false} onClick={() => set({ done: f.done === false ? null : false })} count={counts.todo}>
          to do
        </Option>
        <Option active={f.done === true} onClick={() => set({ done: f.done === true ? null : true })} count={counts.done}>
          done
        </Option>

        <div className="fp-head">has</div>
        <Option active={f.shots} onClick={() => set({ shots: !f.shots })} count={counts.shots}>screenshots</Option>
        <Option active={f.mine} onClick={() => set({ mine: !f.mine })} count={counts.mine}>my notes</Option>
        <Option active={f.research} onClick={() => set({ research: !f.research })} count={counts.research}>
          research pack
        </Option>
      </div>

      <div className="fp-col">
        <div className="fp-head">folder</div>
        <Option active={f.folder === null} onClick={() => set({ folder: null })} count={counts.all}>all folders</Option>
        {folders.map(([name, n]) => (
          <Option key={name} active={f.folder === name} onClick={() => set({ folder: f.folder === name ? null : name })} count={n}>
            {name}
          </Option>
        ))}
        {counts.unsorted > 0 && (
          <Option active={f.folder === ""} onClick={() => set({ folder: f.folder === "" ? null : "" })} count={counts.unsorted}>
            unsorted
          </Option>
        )}
      </div>

      <div className="fp-col">
        <div className="fp-head">source</div>
        <Option active={f.platform === null} onClick={() => set({ platform: null })}>any source</Option>
        {platforms.map(([name, n]) => (
          <Option key={name} active={f.platform === name} onClick={() => set({ platform: f.platform === name ? null : name })} count={n}>
            {name}
          </Option>
        ))}

        <div className="fp-head">sort</div>
        {[
          ["new", "newest first"],
          ["old", "oldest first"],
          ["title", "title a–z"],
        ].map(([k, label]) => (
          <Option key={k} active={f.sort === k} onClick={() => set({ sort: k })}>
            {label}
          </Option>
        ))}
      </div>
    </div>
  );
}
