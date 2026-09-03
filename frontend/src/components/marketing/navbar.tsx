"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

export function MarketingNavbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 w-full border-b px-6 pt-6 pb-5 transition-[background-color,border-color,backdrop-filter] duration-300 sm:px-10 lg:px-16 lg:pt-7 ${scrolled ? "border-white/8 bg-[#080809]/94 backdrop-blur-xl" : "border-transparent bg-gradient-to-b from-[#090909]/92 via-[#090909]/52 to-transparent"}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        {/* Brand Wordmark */}
        <Link
          href="/"
          className="group flex items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          aria-label="Kroway Homepage"
        >
          <span className="font-display text-xl font-black tracking-[-0.03em] text-[#F7F6F2] uppercase transition-colors group-hover:text-white sm:text-2xl">
            KROWAY
          </span>
        </Link>

        {/* Center Editorial Navigation Links */}
        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-8 text-[13px] font-medium tracking-wide text-[#8E929E] uppercase md:flex lg:gap-10"
        >
          <a
            href="#product-system"
            className="py-1 transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          >
            Product
          </a>
          <a
            href="#how-it-works"
            className="py-1 transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          >
            How It Works
          </a>
          <a
            href="#faq"
            className="py-1 transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          >
            FAQ
          </a>
        </nav>

        {/* Right Action CTAs */}
        <div className="hidden items-center gap-6 sm:flex">
          <Link
            href="/login"
            className="text-xs font-medium tracking-wider text-[#A0A5B2] uppercase transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          >
            Log in
          </Link>
          <a
            href="#book-demo"
            data-demo-trigger
            className="group inline-flex items-center gap-1.5 border border-white/20 px-4 py-2 text-[10px] font-semibold tracking-[0.13em] text-[#F7F6F2] uppercase transition-[color,background-color,border-color] duration-200 hover:border-white hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          >
            <span>Book a Demo</span>
            <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="flex items-center gap-4 sm:hidden">
          <Link
            href="/login"
            className="text-xs font-medium tracking-wider text-[#A0A5B2] uppercase focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#efa66f]"
          >
            Log in
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="grid size-11 place-items-center border border-white/15 bg-black/20 text-[#F7F6F2] transition-colors hover:border-white/35 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efa66f]"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="marketing-mobile-menu"
          >
            {mobileMenuOpen ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            id="marketing-mobile-menu"
            initial={reducedMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="absolute top-full right-0 left-0 border-b border-white/10 bg-[#0B0C0E]/98 px-6 py-6 shadow-2xl backdrop-blur-2xl sm:hidden"
          >
            <nav
              aria-label="Mobile navigation"
              className="flex flex-col text-sm font-medium tracking-wide text-[#8E929E] uppercase"
            >
              <a
                href="#product-system"
                onClick={() => setMobileMenuOpen(false)}
                className="py-3 transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efa66f]"
              >
                Product
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="py-3 transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efa66f]"
              >
                How It Works
              </a>
              <a
                href="#faq"
                onClick={() => setMobileMenuOpen(false)}
                className="py-3 transition-colors hover:text-[#F7F6F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efa66f]"
              >
                FAQ
              </a>
            </nav>
            <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-4">
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full border border-white/10 py-3 text-center text-xs font-medium tracking-wider text-[#F7F6F2] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efa66f]"
              >
                Log in to Dashboard
              </Link>
              <a
                href="#book-demo"
                data-demo-trigger
                onClick={() => setMobileMenuOpen(false)}
                className="w-full bg-[#F7F6F2] py-3 text-center text-xs font-bold tracking-wider text-[#0B0C0E] uppercase hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efa66f]"
              >
                Book a Demo
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
