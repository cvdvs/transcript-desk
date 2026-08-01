// Resolves absolute paths to the command-line tools the pipeline shells out to.
// Absolute paths matter: when the app is started from a launcher or LaunchAgent,
// PATH may not include Homebrew or the Python venv.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

function firstExisting(candidates, fallback) {
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

// Claude Code CLI lives inside whichever Node version nvm currently has —
// scan for it so a future Node upgrade doesn't silently break summaries.
function findClaude() {
  const nvmVersions = path.join(HOME, ".nvm", "versions", "node");
  try {
    const versions = fs.readdirSync(nvmVersions).sort().reverse();
    for (const v of versions) {
      const p = path.join(nvmVersions, v, "bin", "claude");
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* nvm not present */
  }
  return firstExisting(
    [path.join(HOME, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
    "claude"
  );
}

export const YTDLP = firstExisting(["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"], "yt-dlp");
export const FFMPEG = firstExisting(["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"], "ffmpeg");
export const FFPROBE = firstExisting(["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"], "ffprobe");
// pip installs land in different places per setup — check the common ones,
// then trust PATH (the install script bakes the user's shell PATH into the
// service, so anything reachable in their terminal is reachable here)
export const MLX_WHISPER = firstExisting(
  ["/opt/homebrew/bin/mlx_whisper", "/usr/local/bin/mlx_whisper"],
  "mlx_whisper"
);
export const CLAUDE = findClaude();

// PATH for child processes: whisper needs ffmpeg; the claude launcher needs node.
export function childEnv() {
  const extra = ["/opt/homebrew/bin", path.dirname(CLAUDE)];
  return {
    ...process.env,
    PATH: `${extra.join(":")}:${process.env.PATH || "/usr/bin:/bin"}`,
  };
}
