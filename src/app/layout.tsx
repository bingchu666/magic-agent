import "./globals.css";
import { SessionProvider } from "@/features/auth/session.client";
import { AuthGate } from "@/features/auth/AuthGate";

export const metadata = {
  title: "Magic Agent",
  description: "Magic vertical SaaS for coaching and file intelligence.",
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
