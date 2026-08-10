// The processing pipeline: URL or file in → timestamped transcript + summary out.
//
//   URL:  yt-dlp metadata → try platform captions (instant)
//         → else download audio + local Whisper (mlx-whisper on Apple Silicon)
//   File: ffprobe metadata → local Whisper
//   Then: summary via the Claude Code CLI (uses the existing subscription).
//
// Status flow: queued → fetching → downloading → transcribing → summarizing → ready | error

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YTDLP, FFMPEG, FFPROBE, MLX_WHISPER, CLAUDE, childEnv } from "./bins";
import {
  DATA_DIR,
  MEDIA_DIR,
  getNote,
  patchNote,
  saveNote,
  newId,
  listNotes,
  markActive,
  markDone,
  cleanupMedia,
} from "./store";
import { syncNoteFile } from "./mdsync";
import { parseSubtitles, parseTimestamp } from "./subtitles";
import {
  tweetIdFrom,
  fetchTweet,
  tweetSummaryParts,
  downloadFile,
  ocrImage,
  fetchArticle,
  resolveShortLink,
} from "./capture";
import {
  summaryPrompt,
  researchPrompt,
  translatePrompt,
  chaptersPrompt,
  transcriptToText,
  noteText,
} from "./prompts";

const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";
const SUMMARY_MODEL = "haiku"; // fast + light on plan limits
const RESEARCH_MODEL = "sonnet"; // deeper pass, run on demand
const PLAYLIST_MAX = 25; // most videos queued from one playlist link
const CHAPTER_MIN_WORDS = 2500; // only chapter long content

// Whisper transcriptions run one at a time — parallel runs would fight for
// memory. Light stages (metadata, captions) stay concurrent.
//
// Serialization is two-layer: an in-process promise chain, plus a lock
// directory on disk so the dev server and the production service (which
// share this machine) never run Whisper simultaneously either.
const WHISPER_LOCK = path.join(DATA_DIR, ".whisper.lock");
const LOCK_STALE_MS = 90 * 60 * 1000; // > the 60-min whisper timeout

async function acquireWhisperLock() {
  for (;;) {
    try {
      fs.mkdirSync(WHISPER_LOCK, { recursive: false });
      return;
    } catch {
      try {
        if (Date.now() - fs.statSync(WHISPER_LOCK).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(WHISPER_LOCK, { recursive: true, force: true }); // dead holder
          continue;
        }
      } catch {
        continue; // lock vanished between checks — retry immediately
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function releaseWhisperLock() {
  try {
    fs.rmSync(WHISPER_LOCK, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

function withTranscribeQueue(fn) {
  const chain = (globalThis.__tdQueue ??= { p: Promise.resolve() });
  const task = async () => {
    await acquireWhisperLock();
    try {
      return await fn();
    } finally {
      releaseWhisperLock();
    }
  };
  const next = chain.p.then(task, task); // keep the chain alive after failures
  chain.p = next.catch(() => {});
  return next;
}

function run(bin, args, { timeoutMs = 120000, stdin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: childEnv(), cwd: os.tmpdir() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // Without this listener an EPIPE (child exits before draining a large
    // prompt) becomes an uncaught exception that kills the whole server.
    child.stdin.on("error", () => {});
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err), timedOut, timeoutMs });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, timeoutMs });
    });
    if (stdin != null) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function fail(stage, res) {
  if (res.timedOut) {
    const mins = Math.round(res.timeoutMs / 60000);
    throw new Error(`${stage} took longer than ${mins} minutes and was stopped — this video may simply be too long.`);
  }
  const detail = (res.stderr || res.stdout || "")
    .split(/[\n\r]/)
    .map((l) => l.trim())
    .filter((l) => l && !/\d+%\||it\/s|frames\/s|\[download\]/.test(l)) // drop progress-bar noise
    .slice(-3)
    .join(" ");
  throw new Error(`${stage} failed: ${detail || `exit code ${res.code}`}`);
}

// Keep our own copy of a note's thumbnail. TikTok and Instagram serve
// signed URLs that expire within days — a card must not depend on them.
export async function localizeThumbnail(id, url) {
  if (!url || !/^https?:/i.test(url)) return false;
  const raw = path.join(MEDIA_DIR, `${id}.thumbsrc`);
  const posterPath = path.join(MEDIA_DIR, `${id}.poster.jpg`);
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    await downloadFile(url, raw);
    await run(FFMPEG, ["-i", raw, "-vf", "scale=640:-2", "-q:v", "3", "-y", posterPath], {
      timeoutMs: 60000,
    });
  } catch {
    /* best-effort */
  }
  try {
    fs.rmSync(raw);
  } catch {
    /* already gone */
  }
  if (fs.existsSync(posterPath)) {
    patchNote(id, { thumbnail: `/api/notes/${id}/poster` });
    return true;
  }
  return false;
}

// One-time repair for notes whose remote thumbnail has already expired:
// download it if it still works, else ask yt-dlp for a fresh link.
export function repairThumbnails() {
  if (globalThis.__tdThumbFix && Date.now() - globalThis.__tdThumbFix < 10 * 60 * 1000) return;
  globalThis.__tdThumbFix = Date.now();
  (async () => {
    for (const entry of listNotes()) {
      const note = getNote(entry.id);
      if (!note || note.status !== "ready") continue;
      if (!note.thumbnail || note.thumbnail.startsWith("/api/")) continue;
      if (note.thumbRepairFailed) continue;

      let ok = await localizeThumbnail(note.id, note.thumbnail);
      if (!ok && note.source?.type === "url" && note.source.url && !tweetIdFrom(note.source.url)) {
        try {
          const meta = await fetchMetadata(note.source.url);
          if (meta?.thumbnail) ok = await localizeThumbnail(note.id, meta.thumbnail);
        } catch {
          /* video gone from the platform */
        }
      }
      if (!ok) patchNote(note.id, { thumbRepairFailed: true }); // don't retry forever
    }
  })().catch(() => {});
}

// Refresh the note's mirror file in ~/Documents/Transcripts. Best-effort —
// the mirror must never fail a note.
export function syncMd(id) {
  try {
    const n = getNote(id);
    if (!n) return;
    const rel = syncNoteFile(n);
    if (rel && rel !== n.mdPath) patchNote(id, { mdPath: rel });
  } catch {
    /* mirror is best-effort */
  }
}

// Thrown when the user deleted the note while the pipeline was mid-flight.
const DELETED = "__note_deleted__";

function assertAlive(id) {
  if (getNote(id)) return;
  cleanupMedia(id); // remove files a finished stage just recreated
  throw new Error(DELETED);
}

// ---------- URL flow ----------

async function fetchMetadata(url) {
  // --flat-playlist keeps playlist/channel URLs cheap so we can reject them
  // fast instead of extracting metadata for hundreds of entries.
  const res = await run(YTDLP, ["-J", "--no-playlist", "--flat-playlist", url], { timeoutMs: 90000 });
  if (res.code !== 0) fail("Fetching video info", res);
  const meta = JSON.parse(res.stdout);
  if (meta._type === "playlist" || Array.isArray(meta.entries)) {
    const entries = (meta.entries || [])
      .filter(Boolean)
      .map((e) => ({
        url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
        title: e.title || null,
      }))
      .filter((e) => e.url);
    return { isPlaylist: true, title: meta.title || url, entries };
  }
  return {
    title: meta.title || url,
    uploader: meta.uploader || meta.channel || null,
    duration: meta.duration || null,
    thumbnail: meta.thumbnail || null,
    platform: (meta.extractor_key || "web").toLowerCase(),
    canonicalUrl: meta.webpage_url || url,
  };
}

async function tryCaptions(id, url) {
  const outBase = path.join(MEDIA_DIR, `${id}.subs`);
  await run(
    YTDLP,
    [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en.*,ro.*,en,ro",
      "--convert-subs",
      "srt",
      "--no-playlist",
      "-o",
      outBase,
      url,
    ],
    { timeoutMs: 120000 }
  );
  // yt-dlp may deliver .srt or .vtt depending on the platform; take both.
  // Prefer plain "en"/"ro" tracks over auto-translated variants like "en-de".
  const all = fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => f.startsWith(`${id}.subs`) && /\.(srt|vtt)$/.test(f));
  const rank = (f) => {
    if (/\.subs\.(en|ro)\.(srt|vtt)$/.test(f)) return 0;
    if (/\.subs\.(en|ro)-orig\.(srt|vtt)$/.test(f)) return 1;
    if (/\.subs\.(en-en|ro-ro)\.(srt|vtt)$/.test(f)) return 2;
    return 3;
  };
  const files = all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const f of files) {
    const raw = fs.readFileSync(path.join(MEDIA_DIR, f), "utf8");
    const segments = parseSubtitles(raw);
    if (segments.length >= 3) return segments;
  }
  return null;
}

async function downloadAudio(id, url) {
  const target = path.join(MEDIA_DIR, `${id}.%(ext)s`);
  const res = await run(
    YTDLP,
    ["-f", "bestaudio/best", "-x", "--audio-format", "m4a", "--no-playlist", "-o", target, url],
    { timeoutMs: 900000 }
  );
  const audioPath = path.join(MEDIA_DIR, `${id}.m4a`);
  if (!fs.existsSync(audioPath)) fail("Downloading audio", res);
  return audioPath;
}

// ---------- shared ----------

async function whisperTranscribe(id, mediaPath) {
  const res = await run(
    MLX_WHISPER,
    ["--model", WHISPER_MODEL, "--output-dir", MEDIA_DIR, "--output-format", "json", "--verbose", "False", mediaPath],
    { timeoutMs: 3600000 }
  );
  // mlx_whisper derives the output name from the input filename in
  // version-dependent ways — find whatever ${id}*.json it wrote.
  const candidates = fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => f.startsWith(id) && f.endsWith(".json") && !f.includes(".subs"));
  const jsonPath = candidates.length ? path.join(MEDIA_DIR, candidates[0]) : path.join(MEDIA_DIR, `${id}.json`);
  if (!fs.existsSync(jsonPath)) fail("Transcribing", res);
  const out = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const segments = (out.segments || [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text || "").trim() }))
    .filter((s) => s.text);
  if (!segments.length) throw new Error("Transcribing produced an empty transcript");
  return { segments, language: out.language || null };
}

export async function claudeCall(prompt, model, timeoutMs = 240000) {
  const res = await run(CLAUDE, ["-p", "--model", model], { timeoutMs, stdin: prompt });
  const out = (res.stdout || "").trim();
  if (res.code === 0 && out) return { ok: true, text: out };
  const combined = `${res.stdout}\n${res.stderr}`;
  if (/not logged in|\/login/i.test(combined)) {
    return {
      ok: false,
      reason:
        "AI summaries need a one-time login on this Mac: open Terminal, type `claude`, then `/login`, and follow the browser prompt. Transcripts work fine without it.",
    };
  }
  return { ok: false, reason: "The AI summary step didn't respond — the transcript is saved and you can retry later." };
}

function hasContent(note) {
  return Boolean(note?.body || note?.transcript?.segments?.length);
}

export async function summarize(id) {
  const note = getNote(id);
  if (!hasContent(note)) return;
  const { text, truncated, hasTimestamps } = noteText(note);
  const result = await claudeCall(summaryPrompt(note, text, hasTimestamps), SUMMARY_MODEL);
  if (result.ok) {
    patchNote(id, {
      summaryNote: null,
      summary: {
        text: truncated
          ? result.text + "\n\n*(Summary based on the first part of a very long transcript.)*"
          : result.text,
        model: SUMMARY_MODEL,
        createdAt: new Date().toISOString(),
      },
    });
  } else {
    patchNote(id, { summaryNote: result.reason });
  }
}

// AI chapter titles for long content — best-effort, skipped silently on failure.
export async function generateChapters(id) {
  const note = getNote(id);
  if (!note?.transcript?.segments?.length) return;
  const words = note.transcript.segments.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  if (words < CHAPTER_MIN_WORDS) return;
  const { text } = transcriptToText(note.transcript.segments);
  const result = await claudeCall(chaptersPrompt(note, text), SUMMARY_MODEL);
  if (!result.ok) return;
  try {
    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;
    const raw = JSON.parse(jsonMatch[0]);
    const chapters = raw
      .map((c) => ({ start: parseTimestamp(c.t), title: String(c.title || "").trim() }))
      .filter((c) => c.start != null && c.title)
      .sort((a, b) => a.start - b.start)
      .slice(0, 20);
    if (chapters.length >= 2) patchNote(id, { chapters });
  } catch {
    /* malformed JSON — transcript stays block-based */
  }
}

export async function generateTranslation(id) {
  const note = getNote(id);
  if (!hasContent(note)) return null;
  if (note.translationStatus === "running") return note; // in flight — the UI polls
  patchNote(id, { translationStatus: "running" });
  try {
    const { text, truncated, hasTimestamps } = noteText(note);
    const result = await claudeCall(translatePrompt(note, text, hasTimestamps), SUMMARY_MODEL, 420000);
    if (!result.ok) throw new Error(result.reason);
    const updated = patchNote(id, {
      translationStatus: null,
      translation: {
        text: truncated
          ? result.text + "\n\n*(Translation of the first part of a very long transcript.)*"
          : result.text,
        model: SUMMARY_MODEL,
        createdAt: new Date().toISOString(),
      },
    });
    syncMd(id);
    return updated;
  } catch (err) {
    patchNote(id, { translationStatus: null });
    throw err;
  }
}

export async function generateResearchPack(id) {
  const note = getNote(id);
  if (!hasContent(note)) return null;
  if (note.researchStatus === "running") return note; // already in flight — the UI polls for the result
  patchNote(id, { researchStatus: "running" });
  try {
    const { text, hasTimestamps } = noteText(note);
    const result = await claudeCall(researchPrompt(note, text, hasTimestamps), RESEARCH_MODEL, 420000);
    if (!result.ok) throw new Error(result.reason);
    const updated = patchNote(id, {
      researchStatus: null,
      research: { text: result.text, model: RESEARCH_MODEL, createdAt: new Date().toISOString() },
    });
    syncMd(id);
    return updated;
  } catch (err) {
    patchNote(id, { researchStatus: null });
    throw err;
  }
}

// ---------- entry points (fire-and-forget from API routes) ----------

// The full single-video pipeline. Throws on error (incl. DELETED).
async function runUrlPipeline(id, url, meta) {
  assertAlive(id);
  patchNote(id, {
    title: meta.title,
    duration: meta.duration,
    thumbnail: meta.thumbnail,
    source: { type: "url", url: meta.canonicalUrl, platform: meta.platform, uploader: meta.uploader },
  });
  await localizeThumbnail(id, meta.thumbnail); // signed CDN links expire

  let segments = await tryCaptions(id, url);
  let method = "captions";
  let language = null;
  assertAlive(id);

  if (!segments) {
    patchNote(id, { status: "downloading" });
    const audioPath = await downloadAudio(id, url);
    assertAlive(id);
    patchNote(id, { status: "waiting" });
    const result = await withTranscribeQueue(async () => {
      assertAlive(id);
      patchNote(id, { status: "transcribing" });
      return whisperTranscribe(id, audioPath);
    });
    assertAlive(id);
    segments = result.segments;
    language = result.language;
    method = "whisper";
  }

  patchNote(id, { status: "summarizing", language, transcript: { method, segments } });
  await summarize(id);
  await generateChapters(id);
  patchNote(id, { status: "ready" });
  syncMd(id);
}

// Turn a playlist/channel note into one queued note per entry, processed
// one after another so the Mac never runs a pile of downloads at once.
async function expandPlaylist(parentId, meta) {
  const entries = meta.entries.slice(0, PLAYLIST_MAX);
  const truncated = meta.entries.length > entries.length;
  const children = entries.map((e) => {
    const childId = newId();
    saveNote({
      id: childId,
      createdAt: new Date().toISOString(),
      status: "waiting",
      title: e.title || e.url,
      source: { type: "url", url: e.url },
    });
    markActive(childId); // protected from sweeps while waiting their turn
    return { id: childId, url: e.url };
  });

  patchNote(parentId, {
    status: "ready",
    title: meta.title,
    source: { type: "url", platform: "playlist" },
    playlistNote: truncated
      ? `Queued the first ${entries.length} of ${meta.entries.length} videos as separate notes — they process one at a time.`
      : `Queued ${entries.length} videos as separate notes — they process one at a time. This note is just the receipt; delete it whenever.`,
  });

  for (const child of children) {
    try {
      if (!getNote(child.id)) continue; // deleted while waiting its turn
      patchNote(child.id, { status: "fetching" });
      const childMeta = await fetchMetadata(child.url);
      if (childMeta.isPlaylist) throw new Error("Nested playlist — skipped.");
      await runUrlPipeline(child.id, child.url, childMeta);
    } catch (err) {
      if (String(err.message) !== DELETED) {
        patchNote(child.id, { status: "error", error: String(err.message || err) });
      }
    } finally {
      markDone(child.id);
    }
  }
}

// Tweet without video: text + images → OCR → markdown body.
async function runTweetPipeline(id, url, tweetData, depth = 0, opts = {}) {
  const { user, text: rawText, photos, quoted, title } = tweetSummaryParts(tweetData);
  patchNote(id, { status: "reading" });

  // expand t.co shells to their real destinations
  let text = rawText;
  const shortLinks = rawText.match(/https:\/\/t\.co\/\w+/g) || [];
  const resolved = [];
  for (const s of shortLinks) {
    const real = await resolveShortLink(s);
    resolved.push(real);
    text = text.replace(s, real);
  }

  // a link-only tweet with no images means "capture the linked thing" —
  // routed properly, so a shared YouTube link gets the video pipeline
  const withoutLinks = text.replace(/https?:\/\/\S+/g, "").trim();
  const target = resolved.find((r) => /^https?:\/\//.test(r) && !tweetIdFrom(r));
  if (!withoutLinks && !photos.length && target && !opts.videoNote) {
    await routeUrl(id, target, depth + 1);
    return;
  }

  patchNote(id, {
    kind: "tweet",
    title,
    thumbnail: photos[0] || null,
    source: { type: "url", url, platform: "x", uploader: `@${user.screen_name || "unknown"}` },
  });

  let body = text;
  if (opts.videoNote) {
    body = `*(This tweet holds a video the downloader couldn't fetch — captured the text instead.)*\n\n${body}`;
  }
  for (let i = 0; i < photos.length; i++) {
    assertAlive(id);
    try {
      const dest = path.join(MEDIA_DIR, `${id}.tw${i}.jpg`);
      await downloadFile(photos[i], dest);
      if (i === 0) {
        // keep a local poster so the card outlives the remote image
        const posterPath = path.join(MEDIA_DIR, `${id}.poster.jpg`);
        await run(FFMPEG, ["-i", dest, "-vf", "scale=640:-2", "-q:v", "3", "-y", posterPath], {
          timeoutMs: 60000,
        });
        if (fs.existsSync(posterPath)) patchNote(id, { thumbnail: `/api/notes/${id}/poster` });
      }
      const ocr = await ocrImage(dest);
      if (ocr) body += `\n\n---\n\n**Image ${i + 1} — text:**\n\n${ocr}`;
    } catch {
      /* image capture is best-effort */
    }
  }
  if (quoted?.text) body += `\n\n> Quoting @${quoted.handle}: ${quoted.text}`;
  if (!body.trim()) throw new Error("That post has no readable text.");

  assertAlive(id);
  patchNote(id, { status: "summarizing", body });
  await summarize(id);
  patchNote(id, { status: "ready" });
  syncMd(id);
}

// Any non-video page: readability extraction → markdown body.
async function runArticlePipeline(id, url) {
  patchNote(id, { status: "reading" });
  const a = await fetchArticle(url);
  assertAlive(id);
  patchNote(id, {
    kind: "article",
    title: a.title,
    thumbnail: a.image || null,
    source: { type: "url", url, platform: a.site, uploader: a.author },
  });
  if (a.image) await localizeThumbnail(id, a.image);
  patchNote(id, { status: "summarizing", body: a.markdown });
  await summarize(id);
  patchNote(id, { status: "ready" });
  syncMd(id);
}

// The router: tweets → tweet capture (video tweets try yt-dlp but fall back
// to text capture, never losing the tweet already in hand); unknown URLs →
// article capture only when yt-dlp says it doesn't know them; real yt-dlp
// failures (timeouts, network, breakage) surface as themselves.
async function routeUrl(id, url, depth = 0) {
  if (depth > 2) throw new Error("Too many link hops — capture the final page directly.");

  if (tweetIdFrom(url)) {
    const tw = await fetchTweet(url);
    assertAlive(id);
    if (!tw.hasVideo) {
      await runTweetPipeline(id, url, tw.data, depth);
      return;
    }
    try {
      const meta = await fetchMetadata(url);
      assertAlive(id);
      await runUrlPipeline(id, url, meta);
    } catch (err) {
      if (String(err.message) === DELETED) throw err;
      assertAlive(id);
      await runTweetPipeline(id, url, tw.data, depth, { videoNote: true });
    }
    return;
  }

  let meta;
  try {
    meta = await fetchMetadata(url);
  } catch (err) {
    if (String(err.message) === DELETED) throw err;
    // only the "yt-dlp doesn't know this URL" class falls back to article
    // capture — timeouts and network errors stay what they are
    if (!/Unsupported URL|is not a valid URL|Unable to extract/i.test(String(err.message))) throw err;
    assertAlive(id);
    await runArticlePipeline(id, url);
    return;
  }
  assertAlive(id);
  if (meta.isPlaylist) {
    if (!meta.entries.length) throw new Error("That playlist appears to be empty or private.");
    await expandPlaylist(id, meta);
    return;
  }
  await runUrlPipeline(id, url, meta);
}

export function processUrlNote(id, url) {
  markActive(id);
  (async () => {
    patchNote(id, { status: "fetching" });
    await routeUrl(id, url);
  })()
    .catch((err) => {
      if (String(err.message) !== DELETED) {
        patchNote(id, { status: "error", error: String(err.message || err) });
      }
    })
    .finally(() => markDone(id));
}

// Image upload: OCR → markdown body.
export function processImageNote(id, filePath, originalFilename) {
  markActive(id);
  (async () => {
    patchNote(id, { status: "reading" });
    patchNote(id, {
      kind: "image",
      title: originalFilename.replace(/\.[^.]+$/, ""),
      source: { type: "file", platform: "image", originalFilename },
    });

    // the image itself is the thumbnail
    const posterPath = path.join(MEDIA_DIR, `${id}.poster.jpg`);
    await run(FFMPEG, ["-i", filePath, "-vf", "scale=640:-2", "-q:v", "3", "-y", posterPath], {
      timeoutMs: 60000,
    });
    if (fs.existsSync(posterPath)) patchNote(id, { thumbnail: `/api/notes/${id}/poster` });

    const ocr = await ocrImage(filePath);
    assertAlive(id);
    if (!ocr) {
      throw new Error(
        "No readable text found in that image (or the OCR tool isn't built — run Scripts/install-service.sh)."
      );
    }
    patchNote(id, { status: "summarizing", body: ocr });
    await summarize(id);
    patchNote(id, { status: "ready" });
    syncMd(id);
  })()
    .catch((err) => {
      if (String(err.message) !== DELETED) {
        patchNote(id, { status: "error", error: String(err.message || err) });
      }
    })
    .finally(() => markDone(id));
}

export function processFileNote(id, filePath, originalFilename) {
  markActive(id);
  (async () => {
    patchNote(id, { status: "fetching" });
    const probe = await run(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeoutMs: 60000 }
    );
    const duration = parseFloat(probe.stdout.trim()) || null;
    patchNote(id, {
      title: originalFilename.replace(/\.[^.]+$/, ""),
      duration,
      source: { type: "file", platform: "local file", originalFilename },
    });

    // real color snapshot for video uploads; audio gets a waveform tile so
    // every card in the library carries an image
    const posterPath = path.join(MEDIA_DIR, `${id}.poster.jpg`);
    await run(
      FFMPEG,
      ["-ss", "0.5", "-i", filePath, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", "-y", posterPath],
      { timeoutMs: 60000 }
    );
    if (!fs.existsSync(posterPath)) {
      await run(
        FFMPEG,
        [
          "-i", filePath,
          "-filter_complex",
          "color=c=#141416:s=640x360[bg];[0:a]showwavespic=s=640x360:colors=#9a9a9a[w];[bg][w]overlay=format=auto",
          "-frames:v", "1", "-q:v", "3", "-y", posterPath,
        ],
        { timeoutMs: 60000 }
      );
    }
    if (fs.existsSync(posterPath)) {
      patchNote(id, { thumbnail: `/api/notes/${id}/poster` });
    }

    patchNote(id, { status: "waiting" });
    const { segments, language } = await withTranscribeQueue(async () => {
      assertAlive(id);
      patchNote(id, { status: "transcribing" });
      // mlx-whisper decodes video containers via ffmpeg — no pre-extraction needed
      return whisperTranscribe(id, filePath);
    });
    assertAlive(id);

    patchNote(id, { status: "summarizing", language, transcript: { method: "whisper", segments } });
    await summarize(id);
    await generateChapters(id);
    patchNote(id, { status: "ready" });
    syncMd(id);
  })()
    .catch((err) => {
      if (String(err.message) !== DELETED) {
        patchNote(id, { status: "error", error: String(err.message || err) });
      }
    })
    .finally(() => markDone(id));
}
