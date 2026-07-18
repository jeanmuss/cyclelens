import { useState } from "react";

export function CacheStatus({ label, tooltip }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;
  return (
    <div
      className="cache-status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="cache-badge"
        aria-expanded={open}
        aria-describedby="cache-status-tooltip"
        onClick={() => setPinned((value) => !value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {label}
      </button>
      <span
        id="cache-status-tooltip"
        role="tooltip"
        className={`cache-tooltip ${open ? "is-open" : ""}`}
      >
        {tooltip}
      </span>
    </div>
  );
}
