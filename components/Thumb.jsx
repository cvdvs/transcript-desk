"use client";

// Card thumbnail: the real video snapshot in original color. The number-art
// ASCII look remains as the fallback for notes with no snapshot (audio files)
// and as the error path when a remote thumbnail can't be fetched.

import { useState } from "react";
import AsciiThumb from "./AsciiThumb";

export default function Thumb({ src, seed = "", large = false }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return <AsciiThumb seed={seed} className={large ? "large" : ""} />;
  }

  // local posters are served by our own /api routes; remote ones go
  // through the /api/thumb proxy so they always load
  const url = src.startsWith("/") ? src : `/api/thumb?url=${encodeURIComponent(src)}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={large ? "video-thumb" : "thumb"}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
