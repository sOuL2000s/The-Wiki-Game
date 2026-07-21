import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "WikiRace | The Wikipedia Speedrun Game",
    template: "%s | WikiRace"
  },
  description: "Challenge your friends in the ultimate Wikipedia racing game. Navigate from one article to another in the fewest clicks possible. Test your speed and knowledge!",
  keywords: ["WikiRace", "Wiki Game", "Wikipedia Game", "Speedrun", "Online Multiplayer", "Trivia Game", "Educational Game"],
  authors: [{ name: "WikiRace Team" }],
  creator: "WikiRace Team",
  publisher: "WikiRace",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://the-wiki-game.netlify.app"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://the-wiki-game.netlify.app",
    title: "WikiRace | The Wikipedia Speedrun Game",
    description: "The competitive way to browse Wikipedia. How fast can you navigate between topics?",
    siteName: "WikiRace",
    images: [
      {
        url: "/logo.svg",
        width: 512,
        height: 512,
        alt: "WikiRace Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WikiRace | The Wikipedia Speedrun Game",
    description: "The competitive way to browse Wikipedia. How fast can you navigate between topics?",
    images: ["/logo.svg"],
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/logo.svg"],
    apple: [
      { url: "/logo.svg" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning // Fix hydration mismatch from browser extensions
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
