import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { AdminRealtimeProvider } from "@/lib/admin-realtime-context";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "لوحة إدارة OSTA",
  description: "لوحة تحكم عمليات OSTA — العملاء، الفنيين، الطلبات، الأرباح، الشكاوى، الإحصائيات",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <AuthProvider>
          {/* docs/08 §63.ب4 — الشِل هنا عشان يتركّب **مرة واحدة** ويعيش عبر كل التنقّلات.
              الصفحات اللي لسه بتلفّ محتواها بـ<AppShell> بتعدّي pass-through (شوف app-shell.tsx). */}
          <AdminRealtimeProvider>
            <AppShell>{children}</AppShell>
          </AdminRealtimeProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
