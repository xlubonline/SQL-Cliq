import type {Metadata} from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SQL Cliq',
  description: 'A command-line interface for SQL operations.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased font-mono h-full bg-background text-foreground flex flex-col`}>
        <div className="flex-grow flex flex-col">
          {children}
        </div>
        <Toaster />
        <footer className="py-3 text-center text-xs text-muted-foreground">
          Made by <a href="https://alosiousbenny.vercel.app/" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">Aloisious Benny</a>
        </footer>
      </body>
    </html>
  );
}
