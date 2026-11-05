import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AppProviders } from "./providers";
import { navigation } from "@/config/navigation";

export const metadata: Metadata = {
  title: "SafeDeal",
  description: "AI-assisted escrow on Avalanche",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <AppProviders>
          <header className="border-b border-slate-200 bg-white">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
              <Link href="/" className="font-semibold tracking-tight text-slate-900">
                SafeDeal
              </Link>
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className="text-slate-600 hover:text-slate-900">
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
