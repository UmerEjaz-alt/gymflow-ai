import type { Metadata } from "next";
import { Archivo, Instrument_Sans } from "next/font/google";

import { ThemeProvider } from "@/components/providers/theme-provider";

import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://kroway.app"),
  title: {
    default: "Kroway",
    template: "%s | Kroway",
  },
  description:
    "Kroway handles gym customer conversations on WhatsApp, answers questions, captures leads, books visits and follows up.",
  applicationName: "Kroway",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      suppressHydrationWarning
      lang="en"
      className={`${archivo.variable} ${instrumentSans.variable}`}
    >
      <body className="bg-background text-foreground min-h-screen font-sans antialiased selection:bg-white selection:text-black">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
