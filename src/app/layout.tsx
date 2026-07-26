import "./globals.css";
import type { Metadata } from "next";
import { SessionProvider } from "@/features/auth/session.client";
import { AuthGate } from "@/features/auth/AuthGate";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Magic Agent — 结构化练习与知识探索",
    template: "%s · Magic Agent",
  },
  description: "让 AI 回答自动长成可追问、可分支、可复习的知识树。",
  openGraph: {
    title: "Magic Agent — AI 结构化思维",
    description: "点击关键词继续探索，让每次回答自动长成知识树。",
    images: [
      {
        url: "/magic-agent-social.png",
        width: 1200,
        height: 630,
        alt: "Magic Agent 结构化知识探索界面",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Magic Agent — AI 结构化思维",
    description: "点击关键词继续探索，让每次回答自动长成知识树。",
    images: ["/magic-agent-social.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="font-['Avenir_Next','SF_Pro_Text','IBM_Plex_Sans','Segoe_UI',sans-serif] text-zinc-900 antialiased">
        <SessionProvider>
          <AuthGate>{children}</AuthGate>
        </SessionProvider>
      </body>
    </html>
  );
}
