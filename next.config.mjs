/** @type {import('next').NextConfig} */
const nextConfig = {
  // Media processing (yt-dlp / whisper) runs via child processes in API routes.
  // Keep server external packages empty — we only shell out, no native deps.
  experimental: {},
};

export default nextConfig;
