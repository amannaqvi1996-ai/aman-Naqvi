import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth";
import { AppShell } from "@/components/shell";
import { ToastProvider } from "@/components/ui";
import { PwaRegister } from "@/components/pwa";

export const metadata: Metadata = {
  title: "AMAN OS",
  description: "Personal operating system — AOR, HYROX, nutrition, fitness, diary",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AMAN OS", statusBarStyle: "black-translucent" },
  icons: { icon: "/favicon.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className="h-full">
      <body className="min-h-full">
        <AuthProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
