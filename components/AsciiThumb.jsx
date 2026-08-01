"use client";

// Renders a video thumbnail as number-art ASCII (the app's signature look).
// With a src: fetches the image through /api/thumb, samples luminance on a
// character grid, maps it to digits. Without one (or on error): draws a
// deterministic organic digit-blob seeded by the note's title/id.

import { useEffect, useState } from "react";

// light → dark, digits only (plus space), tuned by visual density
const RAMP = [" ", " ", "1", "7", "4", "3", "2", "0", "9", "6", "8"];

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < (str || "").length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// deterministic pseudo-noise in [0,1)
function noise(c, r, seed) {
  const s = Math.sin(c * 127.1 + r * 311.7 + seed * 0.0001) * 43758.5453;
  return s - Math.floor(s);
}

function blobArt(seedStr, cols, rows) {
  const seed = hashSeed(seedStr);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const nx = (c / cols - 0.5) * 2;
      const ny = (r / rows - 0.5) * 2;
      const d = Math.sqrt(nx * nx * 1.05 + ny * ny * 1.45);
      const n = noise(c, r, seed);
      const v = Math.max(0, 1 - d) * 0.85 + n * 0.5 - 0.18;
      const idx = Math.max(0, Math.min(RAMP.length - 1, Math.floor(v * RAMP.length)));
      line += RAMP[idx];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function imageArt(img, cols, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);

  const lum = new Float32Array(cols * rows);
  let min = 1;
  let max = 0;
  for (let i = 0; i < cols * rows; i++) {
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    lum[i] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const range = Math.max(0.12, max - min); // contrast-stretch washed thumbnails

  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const v = 1 - (lum[r * cols + c] - min) / range; // dark pixels → dense digits
      const curved = Math.pow(v, 1.9); // push mid-tones to whitespace — sparse, editorial
      const idx = Math.max(0, Math.min(RAMP.length - 1, Math.floor(curved * RAMP.length)));
      line += RAMP[idx];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export default function AsciiThumb({ src, seed = "", cols = 76, aspect = 9 / 16, className = "" }) {
  const rows = Math.max(8, Math.round(cols * aspect * 0.52)); // chars are ~2× taller than wide
  const [art, setArt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setArt(blobArt(seed, cols, rows));
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        setArt(imageArt(img, cols, rows));
      } catch {
        setArt(blobArt(seed, cols, rows));
      }
    };
    img.onerror = () => {
      if (!cancelled) setArt(blobArt(seed, cols, rows));
    };
    img.src = `/api/thumb?url=${encodeURIComponent(src)}`;
    return () => {
      cancelled = true;
    };
  }, [src, seed, cols, rows]);

  return (
    <div className={`thumb-ascii ${className}`} aria-hidden="true">
      {art || blobArt(seed || "loading", cols, rows)}
    </div>
  );
}
