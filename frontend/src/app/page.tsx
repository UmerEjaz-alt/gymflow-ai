import type { Metadata } from "next";

import {
  AutomationSection,
  ControlSection,
  DemoRequestDialog,
  FaqSection,
  FinalCta,
  JourneySection,
  MarketingHero,
  MarketingFooter,
  MarketingNavbar,
  ProductStory,
  RealConversationSection,
  ReviewsSection,
  SetupSection,
} from "@/components/marketing";

const publicDescription =
  "Kroway handles gym customer conversations on WhatsApp, answers questions, captures leads, books visits and follows up.";

export const metadata: Metadata = {
  title: { absolute: "Kroway | AI WhatsApp Front Desk for Gyms" },
  description: publicDescription,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Kroway",
    locale: "en_US",
    title: "Kroway | AI WhatsApp Front Desk for Gyms",
    description:
      "The AI-powered WhatsApp front desk that turns gym conversations into leads and bookings.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kroway | AI WhatsApp Front Desk for Gyms",
    description:
      "The AI-powered WhatsApp front desk that turns gym conversations into leads and bookings.",
  },
};

/**
 * Public Kroway marketing experience. Product routes remain isolated in the
 * authenticated route group; this page only presents marketing-safe facsimiles.
 */
export default function HomePage() {
  return (
    <>
      <a
        href="#main-content"
        className="fixed top-4 left-4 z-[100] -translate-y-24 bg-[#f3eee6] px-4 py-3 text-sm font-semibold text-[#17110e] transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9895b]"
      >
        Skip to content
      </a>
      <MarketingNavbar />
      <main
        id="main-content"
        className="overflow-clip bg-[#0B0C0E] text-[#F7F6F2] selection:bg-[#d98250] selection:text-[#130c08]"
      >
        <MarketingHero />
        <JourneySection />
        <ProductStory />
        <RealConversationSection />
        <AutomationSection />
        <ControlSection />
        <ReviewsSection />
        <SetupSection />
        <FaqSection />
        <FinalCta />
      </main>
      <MarketingFooter />
      <DemoRequestDialog />
    </>
  );
}
