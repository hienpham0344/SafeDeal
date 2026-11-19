/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        geist: ["Geist", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        sd: {
          canvas: "var(--sd-canvas)",
          surface: "var(--sd-surface)",
          elevated: "var(--sd-surface-elevated)",
          inset: "var(--sd-surface-inset)",
          line: "var(--sd-line)",
          lineStrong: "var(--sd-line-strong)",
          ink: "var(--sd-ink)",
          inkMuted: "var(--sd-ink-muted)",
          inkSubtle: "var(--sd-ink-subtle)",
          accent: "var(--sd-accent)",
        },
      },
      opacity: {
        98: "0.98",
      },
    },
  },
  plugins: [],
};
