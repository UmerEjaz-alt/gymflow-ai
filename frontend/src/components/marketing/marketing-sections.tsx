"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Headphones,
  Pause,
  UserRound,
} from "lucide-react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";

const ease = [0.16, 1, 0.3, 1] as const;

function SectionKicker({
  children,
  dark = true,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <p
      className={`text-[9px] font-semibold tracking-[0.32em] uppercase ${dark ? "text-[#d58a59]" : "text-[#985332]"}`}
    >
      {children}
    </p>
  );
}

export function RealConversationSection() {
  const reducedMotion = Boolean(useReducedMotion());
  return (
    <section
      id="conversations"
      className="relative overflow-hidden bg-[#15100e] px-5 py-24 text-[#f4e9df] md:px-12 md:py-36 lg:px-16"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_70%_at_8%_50%,rgba(126,43,23,.28),transparent_72%)]" />
      <motion.div
        className="absolute top-0 bottom-0 left-[28%] w-px bg-gradient-to-b from-transparent via-[#a3593a]/35 to-transparent"
        animate={reducedMotion ? undefined : { opacity: [0.2, 0.75, 0.2] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative mx-auto grid max-w-[90rem] gap-14 md:grid-cols-[0.75fr_1.25fr] md:items-center md:gap-20">
        <div>
          <SectionKicker>Built for real conversations</SectionKicker>
          <h2 className="font-display mt-5 max-w-[11ch] text-[clamp(3.2rem,5.2vw,5.5rem)] leading-[0.85] font-black tracking-[-0.07em] uppercase">
            TEXT IT. SAY IT. KROWAY GETS IT.
          </h2>
          <p className="mt-7 max-w-md text-sm leading-relaxed text-[#aa998b] md:text-base">
            Questions arrive naturally—typed, spoken, incomplete. Kroway understands the
            intent and keeps the conversation moving.
          </p>
        </div>

        <div className="relative border-y border-[#93563b]/45 py-5 md:py-8">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
            <div>
              <p className="text-[8px] tracking-[0.22em] text-[#817269] uppercase">
                Incoming · Customer
              </p>
              <p className="mt-1 text-xs text-[#d4c8bd]">Voice note</p>
            </div>
            <span className="text-[8px] tracking-[0.2em] text-[#75665e] uppercase">
              Example interaction
            </span>
          </div>
          <div className="grid gap-7 py-7 md:grid-cols-[1fr_1.15fr] md:gap-10 md:py-9">
            <div className="border-r-0 border-white/[0.08] md:border-r md:pr-9">
              <div className="flex items-center gap-4">
                <span className="grid size-10 place-items-center border border-[#d18252]/45 text-[#e6a375]">
                  <Pause className="size-3.5" />
                </span>
                <div className="flex h-10 flex-1 items-center gap-[3px]" aria-hidden>
                  {[7, 13, 18, 10, 25, 16, 30, 12, 21, 27, 9, 17, 11, 7].map(
                    (height, index) => (
                      <motion.span
                        key={index}
                        className="w-px bg-[#c77a4d]"
                        style={{ height }}
                        animate={
                          reducedMotion ? undefined : { scaleY: [0.55, 1, 0.55] }
                        }
                        transition={{
                          duration: 1.4 + (index % 4) * 0.2,
                          repeat: Infinity,
                          delay: index * 0.04,
                        }}
                      />
                    ),
                  )}
                </div>
                <span className="text-[9px] text-[#88786d]">0:18</span>
              </div>
              <div className="mt-7 flex items-center gap-3 text-[8px] tracking-[0.2em] text-[#c89069] uppercase">
                <Headphones className="size-3" /> Understood as
              </div>
              <p className="mt-3 font-serif text-xl leading-tight text-[#e8ddd3] italic md:text-2xl">
                “Can I try the gym tomorrow evening before I join?”
              </p>
            </div>
            <div className="flex flex-col justify-between">
              <div className="grid grid-cols-2 gap-px bg-white/[0.08]">
                {[
                  ["Intent", "Trial visit"],
                  ["Day", "Tomorrow"],
                  ["Time", "Evening"],
                  ["Action", "Offer slots"],
                ].map(([label, value]) => (
                  <div key={label} className="bg-[#15100e] p-4">
                    <p className="text-[7px] tracking-[0.2em] text-[#766960] uppercase">
                      {label}
                    </p>
                    <p className="mt-2 text-[11px] text-[#e1d6cd]">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-7 border-l border-[#df8b58] pl-4">
                <p className="text-[7px] tracking-[0.22em] text-[#dd9566] uppercase">
                  Kroway
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#f1e5db]">
                  Of course. I can help you choose an available trial time tomorrow
                  evening.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const automationEvents = [
  ["Day 0", "Lead follow-up", "The conversation continues if the customer goes quiet."],
  ["Visit", "Booked", "Staff see the customer, time and context in one record."],
  ["Membership", "Active", "The relationship moves from lead to member."],
  ["Expiry approaching", "Reminder", "Kroway can reach out before access ends."],
] as const;

export function AutomationSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 80%", "end 30%"],
  });
  const rail = useTransform(scrollYProgress, [0.05, 0.9], [0, 1]);

  return (
    <section
      id="automations"
      ref={sectionRef}
      className="relative overflow-hidden bg-[#e6ded3] px-5 py-24 text-[#171310] md:px-12 md:py-36 lg:px-16"
    >
      <div className="mx-auto max-w-[90rem]">
        <div className="grid gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-end">
          <div>
            <SectionKicker dark={false}>After the reply</SectionKicker>
            <h2 className="font-display mt-5 max-w-[11ch] text-[clamp(3.2rem,5.1vw,5.4rem)] leading-[0.85] font-black tracking-[-0.07em] uppercase">
              Kroway remembers what staff forget.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-[#65584f] md:justify-self-end md:text-base">
            Follow-ups, expiry reminders, and member check-ins belong to the same
            customer journey—not four disconnected tools.
          </p>
        </div>

        <div className="relative mt-16 md:mt-24">
          <div className="absolute top-0 bottom-0 left-[7px] w-px bg-black/15 md:inset-x-0 md:top-[7px] md:bottom-auto md:h-px md:w-auto" />
          <motion.div
            className="absolute top-0 bottom-0 left-[7px] w-px origin-top bg-[#a85b39] md:inset-x-0 md:top-[7px] md:bottom-auto md:h-px md:w-auto md:origin-left"
            style={{
              scaleY: reducedMotion ? 1 : rail,
              scaleX: reducedMotion ? 1 : rail,
            }}
          />
          <div className="grid gap-0 md:grid-cols-4 md:gap-7">
            {automationEvents.map(([time, title, copy], index) => (
              <motion.article
                key={time}
                className="relative border-b border-black/10 py-7 pl-10 md:border-0 md:pt-10 md:pr-5 md:pb-0 md:pl-0"
                initial={reducedMotion ? false : { opacity: 0.28 }}
                whileInView={{ opacity: 1 }}
                viewport={{ amount: 0.55, once: true }}
                transition={{ duration: 0.5, delay: index * 0.08, ease }}
              >
                <span className="absolute top-[1.75rem] left-0 size-3 border border-[#a75c3b] bg-[#e6ded3] md:top-0" />
                <p className="text-[8px] font-semibold tracking-[0.24em] text-[#9b5a3a] uppercase">
                  {time}
                </p>
                <h3 className="font-display mt-3 text-2xl font-bold tracking-[-0.05em] uppercase md:text-3xl">
                  {title}
                </h3>
                <p className="mt-3 max-w-[17rem] text-xs leading-relaxed text-[#695c53]">
                  {copy}
                </p>
              </motion.article>
            ))}
          </div>
        </div>
        <div className="mt-14 grid gap-px border border-black/10 bg-black/10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            "Lead follow-up",
            "Membership expiry reminder",
            "Expired-member follow-up",
            "Member check-in",
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 bg-[#e6ded3] px-5 py-4 text-[9px] tracking-[0.1em] text-[#5f5047] uppercase"
            >
              <Check className="size-3 text-[#9e5836]" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ControlSection() {
  return (
    <section
      id="for-gyms"
      className="relative scroll-mt-24 overflow-hidden bg-[#0c0c0d] px-5 py-24 text-[#f4eade] md:px-12 md:py-36 lg:px-16"
    >
      <div className="absolute top-[-20%] right-[-12%] h-[70%] w-[55%] bg-[radial-gradient(ellipse,rgba(143,48,24,.24),transparent_68%)]" />
      <div className="relative mx-auto max-w-[90rem]">
        <div className="grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-end">
          <div className="min-w-0">
            <SectionKicker>Control & knowledge</SectionKicker>
            <h2 className="font-display mt-5 max-w-full text-[clamp(3.2rem,5.2vw,5.5rem)] leading-[0.85] font-black tracking-[-0.07em] uppercase md:max-w-[12ch]">
              Your gym&apos;s information. Your rules. Your control.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-[#a7978a] md:justify-self-end md:text-base">
            Kroway answers from the packages, facilities, trainers, hours, policies and
            branches your team manages.
          </p>
        </div>

        <div className="mt-14 grid border-y border-white/10 md:mt-20 md:grid-cols-[0.85fr_1.15fr]">
          <div className="border-b border-white/10 py-3 md:border-r md:border-b-0 md:py-6 md:pr-10">
            {[
              ["Membership packages", "Current"],
              ["Facilities", "Available"],
              ["Trainers", "Accepting clients"],
              ["Opening hours", "Branch specific"],
              ["Policies", "Approved"],
              ["Branches", "Connected"],
            ].map(([name, state], index) => (
              <div
                key={name}
                className="grid grid-cols-[1.4rem_1fr_auto] items-center gap-3 border-b border-white/[0.07] py-3.5 last:border-0"
              >
                <span className="font-display text-[8px] text-[#7b5140]">
                  0{index + 1}
                </span>
                <span className="text-[10px] text-[#d4ccc5]">{name}</span>
                <span className="text-[7px] tracking-[0.14em] text-[#8c7b6f] uppercase">
                  {state}
                </span>
              </div>
            ))}
          </div>
          <div className="relative flex min-h-[28rem] flex-col justify-between py-8 md:min-h-[34rem] md:py-10 md:pl-12">
            <div>
              <p className="text-[8px] tracking-[0.24em] text-[#7f7066] uppercase">
                Customer asks
              </p>
              <p className="mt-3 max-w-[24ch] font-serif text-2xl leading-tight text-[#dfd5cd] italic md:text-4xl">
                “Does the monthly package include the strength floor at the Downtown
                branch?”
              </p>
            </div>
            <div className="my-8 flex items-center gap-3 text-[7px] tracking-[0.22em] text-[#9f6245] uppercase">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#a05b3b]" />
              Uses approved branch knowledge
              <span className="h-px flex-1 bg-gradient-to-r from-[#a05b3b] to-transparent" />
            </div>
            <div className="border-l border-[#df8d59] pl-5">
              <p className="text-[8px] tracking-[0.24em] text-[#da9161] uppercase">
                Kroway
              </p>
              <p className="mt-3 max-w-[31rem] text-base leading-relaxed text-[#f1e6dd] md:text-xl">
                Yes. The monthly membership includes full access to the Downtown
                strength floor during opening hours.
              </p>
            </div>
            <div className="mt-9 flex items-center justify-between border-t border-white/10 pt-5">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center border border-white/10 text-[#b7a89c]">
                  <UserRound className="size-3.5" />
                </span>
                <div>
                  <p className="text-[8px] text-[#d3c8bf]">Human control available</p>
                  <p className="mt-1 text-[7px] text-[#6f6560]">
                    Take over whenever your team chooses
                  </p>
                </div>
              </div>
              <span className="text-[7px] tracking-[0.16em] text-[#b77957] uppercase">
                Take over →
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const reviews = [
  {
    theme: "After-hours inquiries",
    copy: "We used to come in the next morning to messages that had been sitting there since closing. By then, some people had already moved on. Now they get an answer while they’re still thinking about joining.",
    owner: "Ahmed",
    role: "Gym Owner",
    gymType: "Independent gym",
  },
  {
    theme: "Everyday questions",
    copy: "My team was answering the same questions all day — prices, timings, what facilities we have. Kroway handles that first conversation, so staff can focus on the people already in the studio.",
    owner: "Sarah",
    role: "Studio Gym Owner",
    gymType: "Boutique studio",
  },
  {
    theme: "Follow-up & bookings",
    copy: "The follow-up was always the part that slipped when the gym got busy. Kroway keeps the conversation going and books the visit, so the lead doesn’t just disappear after asking a question.",
    owner: "Hamza",
    role: "Gym Owner",
    gymType: "Independent gym",
  },
] as const;

function ReviewFrame({
  index,
  progress,
  activeIndex,
}: {
  index: number;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
  activeIndex: number;
}) {
  const center = index / 2;
  const opacity = useTransform(progress, (value) => {
    const distance = Math.abs(value - center);
    return distance <= 0.1 ? 1 : Math.max(0, 1 - (distance - 0.1) / 0.14);
  });
  const y = useTransform(progress, (value) =>
    Math.max(-54, Math.min(64, (center - value) * 220)),
  );
  const scale = useTransform(progress, (value) => {
    const distance = Math.abs(value - center);
    return Math.max(0.975, 1 - distance * 0.05);
  });
  const review = reviews[index];
  return (
    <motion.div
      aria-hidden={index !== activeIndex}
      className="pointer-events-none absolute inset-0 flex flex-col justify-center"
      style={{ opacity, scale, y }}
    >
      <blockquote className="grid w-full gap-7 md:grid-cols-[minmax(0,1fr)_15rem] md:items-end md:gap-12 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-16">
        <div>
          <p className="text-[8px] font-semibold tracking-[0.28em] text-[#b76a42] uppercase md:text-[9px]">
            Perspective 0{index + 1} · {review.theme}
          </p>
          <p className="font-display mt-5 max-w-[24ch] text-[clamp(1.85rem,3.3vw,3.65rem)] leading-[1.04] font-bold tracking-[-0.05em] text-[#f3e9de] md:mt-7">
            “{review.copy}”
          </p>
        </div>
        <footer className="border-t border-white/15 pt-5 md:border-t-0 md:border-l md:border-white/15 md:pt-0 md:pl-8">
          <div className="flex items-center gap-4 md:block">
            <span
              className="font-display grid size-11 shrink-0 place-items-center border border-[#a95f3c]/65 text-sm font-bold text-[#e3a078] md:size-12"
              aria-hidden
            >
              {review.owner.charAt(0)}
            </span>
            <cite className="not-italic md:mt-5 md:block">
              <span className="block text-[12px] font-semibold tracking-[0.06em] text-[#f0e2d6] uppercase">
                {review.owner}
              </span>
              <span className="mt-1 block text-[8px] tracking-[0.18em] text-[#a08b80] uppercase">
                {review.role}
              </span>
            </cite>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 md:grid-cols-1 md:gap-4">
            <div>
              <dt className="text-[7px] tracking-[0.2em] text-[#6f6059] uppercase">
                Gym profile
              </dt>
              <dd className="mt-1.5 text-[9px] text-[#c8b6aa]">{review.gymType}</dd>
            </div>
            <div>
              <dt className="text-[7px] tracking-[0.2em] text-[#6f6059] uppercase">
                Kroway handles
              </dt>
              <dd className="mt-1.5 text-[9px] text-[#c8b6aa]">{review.theme}</dd>
            </div>
          </dl>
        </footer>
      </blockquote>
    </motion.div>
  );
}

export function ReviewsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const [activeReview, setActiveReview] = useState(0);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const progressScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    setActiveReview(Math.min(reviews.length - 1, Math.max(0, Math.round(latest * 2))));
  });

  function moveToReview(index: number) {
    const section = sectionRef.current;
    if (!section) return;
    const sectionTop = window.scrollY + section.getBoundingClientRect().top;
    const scrollableDistance = section.offsetHeight - window.innerHeight;
    window.scrollTo({
      top: sectionTop + (index / (reviews.length - 1)) * scrollableDistance,
      behavior: "smooth",
    });
  }

  if (reducedMotion) {
    return (
      <section
        id="reviews"
        aria-labelledby="reviews-heading-static"
        className="scroll-mt-24 bg-[#17110f] px-5 py-24 text-[#f3e9de] md:px-12 md:py-32"
      >
        <div className="mx-auto max-w-[90rem]">
          <SectionKicker>Gym owner perspectives</SectionKicker>
          <h2
            id="reviews-heading-static"
            className="font-display mt-4 text-2xl font-bold tracking-[-0.04em]"
          >
            What changes when Kroway handles the conversation.
          </h2>
          <p className="mt-3 text-[9px] tracking-[0.08em] text-[#8f7b70]">
            Representative perspectives based on common gym workflows.
          </p>
          <div className="mt-14 space-y-16">
            {reviews.map((review, index) => (
              <blockquote key={review.owner} className="border-t border-white/15 pt-6">
                <p className="text-[8px] tracking-[0.25em] text-[#bd7048] uppercase">
                  Perspective 0{index + 1} · {review.theme}
                </p>
                <p className="font-display mt-5 max-w-[24ch] text-3xl leading-[1.05] font-bold tracking-[-0.05em]">
                  “{review.copy}”
                </p>
                <footer className="mt-6 text-[9px] tracking-[0.16em] text-[#a28d82] uppercase">
                  <cite className="text-[#f0e2d6] not-italic">{review.owner}</cite> —{" "}
                  {review.role} · {review.gymType}
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      id="reviews"
      ref={sectionRef}
      aria-labelledby="reviews-heading"
      className="relative h-[280svh] scroll-mt-24 bg-[#17110f] text-[#f3e9de]"
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden px-5 md:px-12 lg:px-16">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_62%_75%_at_14%_45%,rgba(129,50,27,.2),transparent_70%)]" />
        <div className="absolute inset-y-0 right-[12%] w-px bg-white/[0.08]" />
        <div className="absolute top-16 right-5 left-5 md:top-20 md:right-12 md:left-12 lg:right-16 lg:left-16">
          <div className="mx-auto flex max-w-[90rem] items-start justify-between gap-8">
            <div>
              <SectionKicker>Gym owner perspectives</SectionKicker>
              <h2
                id="reviews-heading"
                className="font-display mt-4 max-w-[26ch] text-lg font-bold tracking-[-0.035em] text-[#ddcfc4] md:text-2xl"
              >
                What changes when Kroway handles the conversation.
              </h2>
              <p className="mt-2 text-[8px] tracking-[0.08em] text-[#806e65] md:text-[9px]">
                Representative perspectives based on common gym workflows.
              </p>
            </div>
            <p className="font-display hidden text-[clamp(3rem,5vw,5.5rem)] leading-none font-black tracking-[-0.07em] text-white/[0.035] md:block">
              0{activeReview + 1}
            </p>
          </div>
        </div>
        <div className="absolute inset-x-5 top-[11.5rem] bottom-24 md:inset-x-12 md:top-[13.5rem] md:bottom-24 lg:inset-x-16">
          <div className="relative mx-auto h-full max-w-[90rem]">
            {reviews.map((review, index) => (
              <ReviewFrame
                key={review.owner}
                index={index}
                progress={scrollYProgress}
                activeIndex={activeReview}
              />
            ))}
          </div>
        </div>
        <div className="absolute right-5 bottom-7 left-5 md:right-12 md:bottom-9 md:left-12 lg:right-16 lg:left-16">
          <div className="mx-auto flex max-w-[90rem] items-end justify-between gap-8 border-t border-white/10 pt-5">
            <div
              className="flex items-center gap-2"
              aria-label="Choose an owner perspective"
            >
              {reviews.map((review, index) => (
                <button
                  key={review.owner}
                  type="button"
                  aria-current={activeReview === index ? "true" : undefined}
                  aria-label={`Show perspective ${index + 1} from ${review.owner}`}
                  onClick={() => moveToReview(index)}
                  className={`group flex h-9 items-center gap-2 px-1 text-[8px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d58a59] ${
                    activeReview === index
                      ? "text-[#f0dfd1]"
                      : "text-[#77665d] hover:text-[#bd9e8b]"
                  }`}
                >
                  <span
                    className={`h-px transition-[width,background-color] duration-500 ${activeReview === index ? "w-8 bg-[#cb784c]" : "w-4 bg-white/20 group-hover:w-6"}`}
                    aria-hidden
                  />
                  0{index + 1}
                  <span className="hidden md:inline">{review.owner}</span>
                </button>
              ))}
            </div>
            <span className="hidden text-[8px] tracking-[0.18em] text-[#6f6058] uppercase sm:block">
              Scroll to read
            </span>
          </div>
        </div>
        <motion.div
          className="absolute bottom-0 left-0 h-px w-full origin-left bg-[#bd6840]"
          style={{ scaleX: progressScale }}
        />
      </div>
    </section>
  );
}

export function SetupSection() {
  const steps = [
    ["01", "Connect", "Connect the gym's WhatsApp."],
    [
      "02",
      "Teach",
      "Add packages, facilities, trainers, policies and branch information.",
    ],
    ["03", "Go live", "Kroway begins handling customer conversations."],
  ];
  return (
    <section
      id="setup"
      className="scroll-mt-24 bg-[#f0e9df] px-5 py-24 text-[#171310] md:px-12 md:py-36 lg:px-16"
    >
      <div className="mx-auto max-w-[90rem]">
        <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-end">
          <div>
            <SectionKicker dark={false}>Setup</SectionKicker>
            <h2 className="font-display mt-5 text-[clamp(3.4rem,5vw,5.2rem)] leading-[0.85] font-black tracking-[-0.07em] uppercase">
              From hello to live.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-[#6b5d53] md:justify-self-end md:text-base">
            The system learns the operation your team already knows. Setup should feel
            like configuration—not a technology project.
          </p>
        </div>
        <div className="mt-14 grid border-t border-black/20 md:mt-20 md:grid-cols-3">
          {steps.map(([number, title, copy], index) => (
            <article
              key={number}
              className={`border-b border-black/15 py-8 md:min-h-[17rem] md:border-b-0 md:py-10 ${index ? "md:border-l md:pl-8 lg:pl-12" : "md:pr-8 lg:pr-12"}`}
            >
              <p className="font-display text-xs font-bold text-[#9c5837]">{number}</p>
              <h3 className="font-display mt-10 text-4xl font-bold tracking-[-0.05em] uppercase md:text-[2.5rem]">
                {title}
              </h3>
              <p className="mt-5 max-w-xs text-sm leading-relaxed text-[#64574e]">
                {copy}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  const reducedMotion = Boolean(useReducedMotion());
  return (
    <section
      id="demo"
      className="relative min-h-[100svh] scroll-mt-24 overflow-hidden bg-[#070708] px-5 py-24 text-[#f7ebe0] md:px-12 md:py-32 lg:px-16"
    >
      <motion.div
        className="absolute inset-[-5%]"
        animate={
          reducedMotion ? undefined : { scale: [1.04, 1.085, 1.04], x: [0, -15, 0] }
        }
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
      >
        <Image
          src="/hero-gym-1.jpg"
          alt="A gym floor after hours"
          fill
          sizes="100vw"
          className="object-cover object-[70%_center]"
          style={{ filter: "grayscale(1) brightness(.16) contrast(1.34)" }}
        />
      </motion.div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_30%_66%_at_70%_38%,rgba(255,255,255,.075),transparent_72%),linear-gradient(90deg,rgba(0,0,0,.98),rgba(5,5,6,.84)_52%,rgba(3,3,4,.7))]" />
      <motion.div
        className="absolute top-[12%] bottom-[12%] left-[66%] w-px bg-gradient-to-b from-transparent via-white/18 to-transparent"
        animate={reducedMotion ? undefined : { opacity: [0.18, 0.48, 0.18] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative mx-auto flex min-h-[68svh] max-w-[90rem] flex-col justify-between">
        <p className="text-[9px] font-semibold tracking-[0.32em] text-white/42 uppercase">
          Still on after closing
        </p>
        <div>
          <h2
            aria-label="Join us and your gym never stops replying."
            className="font-display max-w-[13ch] text-[clamp(3rem,5.8vw,6.6rem)] leading-[0.86] font-black tracking-[-0.055em] uppercase"
          >
            <span
              aria-hidden="true"
              className="mb-[0.5em] block text-[0.24em] leading-none font-semibold tracking-[0.2em] text-white/48"
            >
              Join us and
            </span>
            <span aria-hidden="true" className="block text-[#f4f3ef]">
              <span className="block">Your gym</span>
              <span className="ml-[clamp(1rem,4vw,4rem)] block text-[0.84em] whitespace-nowrap text-white/72 sm:text-[1em]">
                never stops
              </span>
              <span className="ml-[clamp(2rem,8vw,8rem)] block">replying.</span>
            </span>
          </h2>
          <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <a
              href="#book-demo"
              data-demo-trigger
              className="group inline-flex items-center gap-5 border border-white/28 bg-white/[0.035] px-6 py-4 text-[10px] font-semibold tracking-[0.22em] uppercase transition-colors hover:border-white hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Book a demo{" "}
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <Link
              href="/login"
              className="inline-flex items-center gap-3 text-[9px] tracking-[0.18em] text-white/48 uppercase hover:text-white"
            >
              Existing customer login <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-white/10 pt-5 text-[8px] tracking-[0.16em] text-white/38 uppercase sm:flex-row sm:items-center sm:justify-between">
          <span>Kroway · Conversations into action</span>
          <span>WhatsApp receptionist and sales assistant for gyms</span>
        </div>
      </div>
    </section>
  );
}
