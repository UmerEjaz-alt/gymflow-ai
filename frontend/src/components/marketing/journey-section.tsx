"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

const stages = [
  {
    label: "Inquiry",
    shortLabel: "Inquiry",
    meta: "Membership question",
    value: "How much is membership?",
  },
  {
    label: "AI conversation",
    shortLabel: "AI chat",
    meta: "Intent understood",
    value: "Full access · $89/month",
  },
  {
    label: "Lead",
    shortLabel: "Lead",
    meta: "Example customer",
    value: "Jordan · Membership interest",
  },
  {
    label: "Visit booked",
    shortLabel: "Visit",
    meta: "Tomorrow",
    value: "18:00 · Downtown branch",
  },
  {
    label: "Member",
    shortLabel: "Member",
    meta: "Sales journey",
    value: "Ready for staff follow-through",
  },
] as const;

function StaticJourney() {
  return (
    <div className="mt-14 border-t border-[#7c4934]/45">
      {stages.map((stage, index) => (
        <div
          key={stage.label}
          className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-white/10 py-5"
        >
          <span className="font-display text-sm text-[#d98956]">0{index + 1}</span>
          <div>
            <p className="font-display text-xl font-bold tracking-[-0.04em] text-[#f6eadf] uppercase">
              {stage.label}
            </p>
            <p className="mt-1 text-xs text-[#9f8f82]">{stage.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function JourneyStage({
  index,
  progress,
}: {
  index: number;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
}) {
  const count = stages.length;
  const center = index / (count - 1);
  const opacity = useTransform(progress, (value) => {
    const distance = Math.abs(value - center);
    return distance <= 0.07 ? 1 : Math.max(0, 1 - (distance - 0.07) / 0.09);
  });
  const y = useTransform(progress, (value) =>
    Math.max(-70, Math.min(80, (center - value) * 330)),
  );
  const scale = useTransform(
    progress,
    (value) => 1 - Math.min(Math.abs(value - center) * 0.2, 0.04),
  );
  const stage = stages[index];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center"
      style={{ opacity, y, scale }}
      aria-hidden="true"
    >
      <p className="text-[8px] font-semibold tracking-[0.3em] text-[#c98359] uppercase">
        {stage.meta}
      </p>
      <p className="font-display mt-3 max-w-[13ch] text-[clamp(3.2rem,5.4vw,5.6rem)] leading-[0.84] font-black tracking-[-0.065em] text-[#f6eadf] uppercase">
        {stage.label}
      </p>
      <div className="mt-7 max-w-xl border-y border-[#8b5138]/45 py-5">
        <p className="text-[clamp(1.05rem,1.8vw,1.65rem)] leading-tight tracking-[-0.025em] text-[#d8c8ba]">
          {stage.value}
        </p>
      </div>
    </motion.div>
  );
}

export function JourneySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const recordX = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const halo = useTransform(scrollYProgress, [0, 0.5, 1], [0.1, 0.32, 0.14]);

  if (reducedMotion) {
    return (
      <section
        id="how-it-works"
        className="scroll-mt-24 bg-[#0b0a0a] px-5 py-24 text-[#f6eadf] md:px-12 md:py-32"
      >
        <div className="mx-auto max-w-7xl">
          <p className="text-[9px] font-semibold tracking-[0.32em] text-[#d58b5a] uppercase">
            Message → member
          </p>
          <h2 className="font-display mt-5 max-w-[12ch] text-[clamp(3.3rem,6vw,6rem)] leading-[0.85] font-black tracking-[-0.07em] uppercase">
            The reply is only the start.
          </h2>
          <StaticJourney />
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative h-[360svh] scroll-mt-24 bg-[#0b0a0a] text-[#f6eadf]"
    >
      <ol className="sr-only">
        {stages.map((stage) => (
          <li key={stage.label}>
            {stage.label}: {stage.value}
          </li>
        ))}
      </ol>
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(ellipse_50%_55%_at_72%_45%,rgba(132,46,23,.32),transparent_72%)]"
          style={{ opacity: halo }}
        />
        <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:100%_12.5%] opacity-[0.08]" />

        <div className="relative mx-auto grid h-full max-w-[96rem] grid-rows-[auto_1fr_auto] px-5 pt-24 pb-8 md:grid-cols-[0.78fr_1.22fr] md:grid-rows-[1fr_auto] md:gap-16 md:px-12 md:pt-28 md:pb-12 lg:px-16">
          <div className="md:self-center">
            <p className="text-[9px] font-semibold tracking-[0.32em] text-[#d58b5a] uppercase">
              Message → member
            </p>
            <h2 className="font-display mt-5 max-w-[10ch] text-[clamp(3.25rem,5.2vw,5.4rem)] leading-[0.84] font-black tracking-[-0.07em] uppercase">
              The reply is only the start.
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-[#a9998b] md:text-base">
              Kroway carries intent forward—from the first question to the next action
              your team can see.
            </p>
          </div>

          <div className="relative min-h-[19rem] md:min-h-0 md:self-stretch">
            {stages.map((_, index) => (
              <JourneyStage key={index} index={index} progress={scrollYProgress} />
            ))}
          </div>

          <div className="col-span-full mt-auto">
            <div className="relative h-px bg-white/10">
              <motion.div
                className="absolute inset-y-0 left-0 origin-left bg-[#cd7549]"
                style={{ scaleX: lineScale }}
              />
              <motion.span
                className="absolute top-1/2 size-2 -translate-y-1/2 bg-[#efaa70] shadow-[0_0_18px_rgba(239,133,73,.5)]"
                style={{ left: recordX, x: "-50%" }}
              />
            </div>
            <div className="mt-4 grid grid-cols-5 gap-1">
              {stages.map((stage, index) => (
                <div key={stage.label} className="min-w-0">
                  <p className="text-[7px] tracking-[0.12em] text-[#806e62] uppercase md:text-[8px] md:tracking-[0.2em]">
                    0{index + 1}
                  </p>
                  <p className="mt-1 text-[7px] font-semibold tracking-[0.06em] text-[#c7b4a5] uppercase md:text-[9px] md:tracking-[0.14em]">
                    <span className="md:hidden">{stage.shortLabel}</span>
                    <span className="hidden md:inline">{stage.label}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
