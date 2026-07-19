import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      letterSpacing: {
        tighter: "-0.02em",
        tight: "-0.01em",
      },
      colors: {
        apple: {
          gray: "#f5f5f7",
          blue: "#0071e3",
          text: "#1d1d1f",
        }
      },
      boxShadow: {
        'apple-nav': '0 1px 0 0 rgba(0,0,0,0.05)',
        'apple-spotlight': '0 2px 12px rgba(0,0,0,0.04), 0 20px 40px rgba(0,0,0,0.08)',
        'apple-card': '0 8px 30px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
};
export default config;
