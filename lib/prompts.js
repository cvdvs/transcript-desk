// Prompt templates for the AI layer. Shared by server (summaries, research
// packs) and client (the "Copy as Claude research prompt" button).

import { formatTimestamp } from "./subtitles";

export function transcriptToText(segments, maxWords = 14000) {
  const lines = [];
  let words = 0;
  let truncated = false;
  for (const seg of segments) {
    const w = seg.text.split(/\s+/).length;
    if (words + w > maxWords) {
      truncated = true;
      break;
    }
    lines.push(`[${formatTimestamp(seg.start)}] ${seg.text}`);
    words += w;
  }
  return { text: lines.join("\n"), truncated };
}

function sourceHeader(note) {
  return [
    `Title: ${note.title || "Untitled"}`,
    note.source?.platform ? `Platform: ${note.source.platform}` : null,
    note.source?.url ? `URL: ${note.source.url}` : null,
    note.source?.uploader ? `Creator: ${note.source.uploader}` : null,
    note.duration ? `Duration: ${formatTimestamp(note.duration)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function summaryPrompt(note, transcriptText) {
  return `You are summarizing a video/audio transcript. Timestamps are in [mm:ss] or [h:mm:ss] format.

${sourceHeader(note)}

Write the summary in the same language as the transcript. Output plain Markdown with exactly these sections, no preamble and no closing remarks:

## Overview
2–3 sentences on what this is and the main point.

## Key takeaways
5–8 bullets. Start each bullet with its [timestamp].

## Notable quotes
Up to 3 verbatim quotes worth keeping, each with its [timestamp]. If none stand out, write "—".

Transcript:
${transcriptText}`;
}

export function researchPrompt(note, transcriptText) {
  return `You are a careful research assistant analyzing a transcript. Timestamps are in [mm:ss] or [h:mm:ss] format. Preserve uncertainty — do not overstate what the transcript supports.

${sourceHeader(note)}

Output plain Markdown with exactly these sections:

## Executive summary
3–5 sentences.

## Key claims
| Timestamp | Claim | Exact quote | Type | Needs verification |
|---|---|---|---|---|
Types: factual / technical / financial / historical / legal / prediction / allegation / opinion / anecdote.

## Fact / opinion / speculation split
| Timestamp | Statement | Category | Reason |
|---|---|---|---|

## Things to verify
| Claim | Suggested search query | Likely source type | Priority |
|---|---|---|---|

## Suggested search queries
Bullet list.

Transcript:
${transcriptText}`;
}

export function translatePrompt(note, transcriptText) {
  return `You are translating a timestamped transcript. Lines look like "[mm:ss] text".

${sourceHeader(note)}

If the transcript is mostly Romanian, translate it into English. Otherwise, translate it into Romanian. Keep every "[timestamp]" exactly where it is, one line per original line. Translate naturally — meaning over word-for-word. Output ONLY the translated transcript lines, no preamble.

Transcript:
${transcriptText}`;
}

export function chaptersPrompt(note, transcriptText) {
  return `Divide this timestamped transcript into 4–12 chapters.

${sourceHeader(note)}

Rules:
- Return ONLY a JSON array, nothing else: [{"t":"03:15","title":"Chapter title"}]
- Each "t" must be a timestamp that appears in the transcript, in mm:ss or h:mm:ss form
- Titles: at most 6 words, in the transcript's language, no numbering
- First chapter starts at the transcript's first timestamp

Transcript:
${transcriptText}`;
}

// The template from the project brief — for pasting into Claude/GPT by hand.
export function clipboardResearchPrompt(note, transcriptText) {
  return `I am researching the following transcript.

Source:
${sourceHeader(note)}

Task:
1. Extract all factual claims.
2. Separate claims from opinions, speculation, anecdotes, and marketing claims.
3. Identify claims that need external verification.
4. Suggest search queries for each important claim.
5. Return a table with timestamp, claim, exact quote, verification status, and suggested sources.
6. Preserve uncertainty. Do not overstate the transcript.

Transcript:
${transcriptText}`;
}
