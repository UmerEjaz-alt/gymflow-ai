"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { HeroNarrative, type HeroStoryState, useHeroStory } from "./hero-interaction";

const ease = [0.16, 1, 0.3, 1] as const;

function CinematicVideo({ story }: { story: HeroStoryState }) {
  const {
    setVideoRef,
    reducedMotion,
    onVideoTimeUpdate,
    onVideoEnded,
    onVideoLoaded,
    onVideoCanPlay,
    onVideoError,
  } = story;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <video
        ref={setVideoRef}
        aria-hidden="true"
        autoPlay={!reducedMotion}
        muted
        playsInline
        preload="auto"
        controls={false}
        disablePictureInPicture
        onTimeUpdate={onVideoTimeUpdate}
        onEnded={onVideoEnded}
        onLoadedMetadata={onVideoLoaded}
        onCanPlay={onVideoCanPlay}
        onError={onVideoError}
        className="absolute top-[7svh] left-1/2 h-[72svh] w-auto max-w-none -translate-x-1/2 object-cover object-center md:inset-x-0 md:top-20 md:h-[calc(100%-5rem)] md:w-full md:origin-top md:translate-x-0 md:scale-[1.05] md:object-contain md:object-top"
      >
        <source src="/kroway-closing-gym-mobile.mp4" type="video/mp4" />
      </video>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/76 via-black/24 to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black via-black/36 to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 hidden w-[18%] bg-gradient-to-r from-black/50 to-transparent md:block"
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 hidden w-[18%] bg-gradient-to-l from-black/50 to-transparent md:block"
      />
    </div>
  );
}

function CampaignStatement({ story }: { story: HeroStoryState }) {
  return (
    <AnimatePresence>
      {story.showStatement ? (
        <motion.div
          className="pointer-events-none absolute top-[24svh] left-1/2 z-20 w-[91vw] -translate-x-1/2 text-center md:top-[48%] md:w-[70vw] md:max-w-[62rem] md:-translate-y-[58%]"
          initial={story.reducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: story.reducedMotion ? 0 : 0.78, ease }}
        >
          <h1 className="font-display uppercase">
            <span className="block overflow-hidden pb-[0.08em]">
              <motion.span
                className="block text-[clamp(2.65rem,11.2vw,3.4rem)] leading-[0.9] font-black tracking-[-0.06em] text-[#f5f3ef] md:text-[clamp(4.25rem,5.65vw,5.75rem)]"
                initial={story.reducedMotion ? false : { y: "104%" }}
                animate={{ y: 0 }}
                transition={{ duration: story.reducedMotion ? 0 : 0.72, ease }}
              >
                Your gym closes.
              </motion.span>
            </span>
            <span className="mt-3 block overflow-hidden pb-[0.08em] md:mt-5">
              <motion.span
                className="block text-[clamp(1.95rem,8.4vw,2.55rem)] leading-[0.94] font-bold tracking-[-0.04em] text-white/78 md:text-[clamp(2.75rem,3.65vw,3.7rem)]"
                initial={story.reducedMotion ? false : { y: "104%" }}
                animate={{ y: 0 }}
                transition={{
                  duration: story.reducedMotion ? 0 : 0.72,
                  delay: 0.08,
                  ease,
                }}
              >
                Your front desk
                <br className="md:hidden" />
                <span className="md:ml-[0.18em]">doesn&apos;t have to.</span>
              </motion.span>
            </span>
          </h1>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function HeroActions({ story }: { story: HeroStoryState }) {
  return (
    <motion.div
      className="absolute right-6 bottom-7 left-6 z-40 flex items-end justify-between md:right-14 md:bottom-8 md:left-14"
      animate={{ opacity: story.showBooked ? 1 : 0, y: story.showBooked ? 0 : 8 }}
      transition={{ duration: story.reducedMotion ? 0 : 0.55, ease }}
    >
      <p className="hidden max-w-[19rem] border-t border-white/14 pt-3 text-[10px] leading-relaxed text-white/48 md:block">
        The room empties. The conversation doesn&apos;t.
      </p>
      <div className="ml-auto flex items-center gap-6 border-t border-white/16 pt-3 text-[9px] font-semibold tracking-[0.17em] uppercase md:gap-8 md:text-[10px]">
        <a
          href="#how-it-works"
          className="group hidden items-center gap-2 text-white/66 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:inline-flex"
        >
          See Kroway in action
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </a>
        <a
          href="#book-demo"
          data-demo-trigger
          className="group inline-flex items-center gap-2 text-[#f5f3ef] transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Book a demo
          <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </motion.div>
  );
}

export function MarketingHero() {
  const story = useHeroStory();

  return (
    <section
      id="hero"
      data-hero-phase={story.phase}
      className="relative min-h-[100svh] overflow-hidden bg-black text-[#f5f3ef]"
    >
      <CinematicVideo story={story} />
      <CampaignStatement story={story} />
      <HeroNarrative story={story} />
      <HeroActions story={story} />
    </section>
  );
}
