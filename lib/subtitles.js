// Parses SRT/VTT subtitle files into { start, end, text } segments and cleans
// up YouTube auto-caption artifacts (rolling duplicated lines).

function tsToSeconds(ts) {
  // "00:01:02,345" or "00:01:02.345" or "01:02.345"
  const m = ts.trim().match(/^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    (parseInt(h || "0", 10) * 3600 +
      parseInt(min, 10) * 60 +
      parseInt(s, 10)) +
    parseInt(ms.padEnd(3, "0").slice(0, 3), 10) / 1000
  );
}

function stripTags(text) {
  return text
    .replace(/<[^>]+>/g, "") // <i>, <c>, timing tags
    .replace(/\{\\an\d\}/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

export function parseSubtitles(raw) {
  const lines = raw.replace(/\r/g, "").split("\n");
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const timeMatch = line.match(
      /([\d:.,]+)\s*-->\s*([\d:.,]+)/
    );
    if (timeMatch) {
      const start = tsToSeconds(timeMatch[1]);
      const end = tsToSeconds(timeMatch[2]);
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i]);
        i++;
      }
      if (start != null && end != null) {
        const text = stripTags(textLines.join("\n"));
        if (text) cues.push({ start, end, textLines: text.split("\n").map((l) => l.trim()).filter(Boolean) });
      }
    }
    i++;
  }

  // De-duplicate rolling captions: YouTube auto-subs repeat the previous cue's
  // line(s) at the top of each new cue. Drop any line already shown.
  const segments = [];
  let prevLines = [];
  for (const cue of cues) {
    const fresh = cue.textLines.filter((l) => !prevLines.includes(l));
    prevLines = cue.textLines;
    const text = fresh.join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = segments[segments.length - 1];
    if (last && last.text === text) {
      last.end = cue.end; // same text stretched over consecutive cues
      continue;
    }
    segments.push({ start: cue.start, end: cue.end, text });
  }
  return segments;
}

// Merge fine-grained segments into readable ~40-second paragraph blocks.
export function toBlocks(segments, maxSpan = 40) {
  const blocks = [];
  let current = null;
  for (const seg of segments) {
    if (!current || seg.start - current.start >= maxSpan) {
      current = { start: seg.start, end: seg.end, text: seg.text };
      blocks.push(current);
    } else {
      current.end = seg.end;
      current.text += " " + seg.text;
    }
  }
  return blocks;
}

// "mm:ss" or "h:mm:ss" → seconds (returns null on garbage)
export function parseTimestamp(ts) {
  const m = String(ts || "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1] || "0", 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
