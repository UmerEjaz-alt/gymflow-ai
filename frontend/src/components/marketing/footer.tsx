import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const links = [
  ["Product", "#product-system"],
  ["How it works", "#how-it-works"],
  ["For gyms", "#for-gyms"],
  ["FAQ", "#faq"],
] as const;

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-black px-5 py-14 text-[#f4f3ef] md:px-12 md:py-16 lg:px-16">
      <div className="mx-auto max-w-[90rem]">
        <div className="grid gap-12 border-b border-white/10 pb-14 md:grid-cols-[1.1fr_0.8fr_0.8fr] md:gap-16">
          <div>
            <Link
              href="/"
              aria-label="Kroway homepage"
              className="font-display text-2xl font-black tracking-[-0.04em] uppercase focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Kroway
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/46">
              AI-powered front desk for modern gyms.
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <p className="text-[8px] font-semibold tracking-[0.24em] text-white/30 uppercase">
              Explore
            </p>
            <ul className="mt-5 space-y-3">
              {links.map(([label, href]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="text-sm text-white/58 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-[8px] font-semibold tracking-[0.24em] text-white/30 uppercase">
              Start
            </p>
            <div className="mt-5 flex flex-col items-start gap-4">
              <a
                href="#book-demo"
                data-demo-trigger
                className="group inline-flex items-center gap-3 text-sm font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Book a demo
                <ArrowUpRight
                  aria-hidden
                  className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </a>
              <Link
                href="/login"
                className="text-sm text-white/58 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Log in
              </Link>
              <a
                href="mailto:hello@kroway.app"
                className="text-sm text-white/58 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                hello@kroway.app
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-6 text-[8px] tracking-[0.16em] text-white/30 uppercase sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Kroway</span>
          <span>Conversations into action</span>
        </div>
      </div>
    </footer>
  );
}
