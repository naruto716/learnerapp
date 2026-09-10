import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import AppToaster from "@/components/AppToaster";

// Keep the root layout minimal so the shell and global toast surface stay mounted for every route.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout() {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <AppShell />
        <AppToaster />
      </body>
    </html>
  );
}
