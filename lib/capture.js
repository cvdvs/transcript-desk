// Text captures: tweets (X's own embed backend, no auth), articles
// (Defuddle readability extraction), and OCR for images (the native Vision
// tool in native/ocr). These feed the same pipeline as videos — the note
// just carries a markdown `body` instead of timestamped segments.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const OCR_BIN = path.join(process.cwd(), "native", "ocr");
const MAX_DOWNLOAD = 20 * 1024 * 1024;
const MAX_HTML = 5 * 1024 * 1024;

export function tweetIdFrom(url) {
  // [/.] guard: matches "https://x.com/…" and "www.twitter.com/…" but not
  // hostnames merely ending in x, like netflix.com
  const m = String(url).match(/(?:^|[/.])(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/);
  return m ? m[1] : null;
}

// the token formula every tweet-embed library uses (react-tweet et al.)
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export async function fetchTweet(url) {
  const id = tweetIdFrom(url);
  if (!id) return null;
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}`,
    { headers: { "user-agent": "Mozilla/5.0 (Macintosh)" }, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) {
    throw new Error(`Couldn't read that tweet (${res.status}) — it may be private, deleted, or X changed its embed API.`);
  }
  const d = await res.json();
  const hasVideo = (d.mediaDetails || []).some((m) => m.type === "video" || m.type === "animated_gif");
  return { id, hasVideo, data: d };
}

export function tweetSummaryParts(d) {
  const user = d.user || {};
  const text = (d.text || "").trim();
  const photos = (d.photos || []).map((p) => p.url).filter(Boolean);
  const quoted = d.quoted_tweet
    ? {
        handle: d.quoted_tweet.user?.screen_name || "unknown",
        text: (d.quoted_tweet.text || "").trim(),
      }
    : null;
  const lead = text.replace(/\s+/g, " ").replace(/https:\/\/t\.co\/\S+$/, "").trim();
  const title = `@${user.screen_name}: ${lead.slice(0, 70) || "post"}${lead.length > 70 ? "…" : ""}`;
  return { user, text, photos, quoted, title };
}

// t.co is a redirect shell — resolve it to the real destination
export async function resolveShortLink(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (Macintosh)" },
      signal: AbortSignal.timeout(10000),
    });
    const loc = res.headers.get("location");
    return loc || url;
  } catch {
    return url;
  }
}

export async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error("file too large");
  fs.writeFileSync(dest, buf);
  return dest;
}

// Apple Vision OCR via the compiled native tool. Best-effort: returns null
// when the tool is missing or finds nothing.
export function ocrImage(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(OCR_BIN)) return resolve(null);
    const child = spawn(OCR_BIN, [filePath]);
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      resolve(code === 0 && text ? text : null);
    });
  });
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// second chance for script-rendered pages: let headless Chrome run the JS,
// then extract from the rendered DOM
function renderWithChrome(url) {
  return new Promise((resolve) => {
    if (!fs.existsSync(CHROME)) return resolve(null);
    const child = spawn(CHROME, [
      "--headless",
      "--disable-gpu",
      "--virtual-time-budget=12000",
      "--timeout=20000",
      "--dump-dom",
      url,
    ]);
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > MAX_HTML) child.kill("SIGKILL");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.length > 500 ? out.slice(0, MAX_HTML) : null);
    });
  });
}

async function extract(html, url) {
  const { Defuddle } = await import("defuddle/node");
  const result = await Defuddle(html, url, { markdown: true });
  const content = (result?.content || "").trim();
  if (!content || content.split(/\s+/).length < 40) return null;
  return result;
}

export async function fetchArticle(url) {
  if (/(?:^|[/.])(?:x|twitter)\.com\/i\/article\//.test(url)) {
    throw new Error(
      "That's an X Article — they're login-walled and can't be captured. Screenshot it and drop the image in instead; the text gets read out of the image."
    );
  }
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`The page couldn't be fetched (${res.status}).`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) throw new Error("That link isn't an article page.");
  let html = await res.text();
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);

  let result = await extract(html, url);
  if (!result) {
    const rendered = await renderWithChrome(url);
    if (rendered) result = await extract(rendered, url);
  }
  if (!result) {
    throw new Error("Couldn't extract readable text from that page (paywalled or script-rendered?).");
  }
  const content = result.content.trim();
  let host = "web";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }
  return {
    title: result?.title || url,
    author: result?.author || null,
    image: result?.image || null,
    site: result?.site || host,
    markdown: content,
  };
}
