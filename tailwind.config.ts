import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070707", 900: "#0b0b0c", 800: "#121214", 700: "#1a1a1d", 600: "#26262b" },
        gold: { 50: "#fbf6e6", 100: "#f3e5b0", 300: "#e6c66a", 400: "#d4a93a", 500: "#b88a1e", 600: "#8a6614" },
        border: "rgba(255,255,255,0.08)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "sans-serif"],
        display: ["ui-serif", "Georgia", "serif"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 30px rgba(0,0,0,0.5)",
        gold: "0 0 0 1px rgba(212,169,58,0.35), 0 8px 30px rgba(212,169,58,0.15)",
      },
      backgroundImage: {
        "grain": "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: { shimmer: "shimmer 2.5s linear infinite" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
