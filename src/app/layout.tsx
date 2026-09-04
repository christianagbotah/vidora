import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./preloader.css";
import { Toaster } from "@/components/ui/toaster";
import { Preloader, ViewTransitionOverlay } from "@/components/Preloader";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vidora Studio — Professional AI Video Creator",
  description: "Create stunning AI-generated videos from text prompts, voice, or uploaded videos. Professional cinematic scenes at your fingertips.",
  keywords: [
    "AI video",
    "video generation",
    "cinematic scenes",
    "AI creator",
    "text to video",
    "AI filmmaking",
    "video production",
    "script to video",
  ],
  authors: [{ name: "Vidora" }],
  creator: "Vidora",
  publisher: "Vidora",
  metadataBase: new URL("https://vidora.lightworldtech.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://vidora.lightworldtech.com",
    title: "Vidora Studio — Professional AI Video Creator",
    description: "Create stunning AI-generated videos from text prompts, voice, or uploaded videos. Professional cinematic scenes at your fingertips.",
    siteName: "Vidora Studio",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "Vidora Studio — Professional AI Video Creator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vidora Studio — Professional AI Video Creator",
    description: "Create stunning AI-generated videos from text prompts, voice, or uploaded videos.",
    images: ["/images/og-image.png"],
    creator: "@vidora",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-video-preview": -1, "max-image-preview": "large", "max-snippet": -1 },
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Vidora",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/logo.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#7c3aed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ErrorBoundary>
          <Preloader />
          <ViewTransitionOverlay />
          {children}
          <Toaster />
        </ErrorBoundary>
      </body>
    </html>
  );
}
