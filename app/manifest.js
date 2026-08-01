export default function manifest() {
  return {
    name: "Transcript Desk",
    short_name: "Transcript Desk",
    description: "Videos in. Transcripts, summaries, research out.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/apple-icon.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
