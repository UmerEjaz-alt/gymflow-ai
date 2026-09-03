"use client";

import { useRef } from "react";
import {
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Inbox,
  Settings,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

const nav = [
  ["Inbox", Inbox],
  ["Leads", UserRoundCheck],
  ["Members", UsersRound],
  ["Bookings", CalendarDays],
  ["Automations", Bot],
  ["Settings", Settings],
] as const;

function ProductChrome({ active }: { active: string }) {
  return (
    <aside className="hidden w-44 shrink-0 border-r border-white/[0.08] bg-[#0d0e10] px-3 py-5 md:block lg:w-52">
      <p className="font-display px-3 text-sm font-black tracking-[-0.04em] text-[#f6eee7] uppercase">
        Kroway
      </p>
      <div className="mt-8 space-y-1">
        {nav.map(([label, Icon]) => (
          <div
            key={label}
            className={`flex h-9 items-center gap-3 px-3 text-[10px] ${active === label ? "bg-[#df8a55]/10 text-[#f0ad7d]" : "text-[#74777d]"}`}
          >
            <Icon className="size-3.5" strokeWidth={1.6} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="mt-auto px-3 pt-24 text-[8px] leading-relaxed tracking-[0.12em] text-[#55575c] uppercase">
        Gym operations,
        <br />
        simplified.
      </p>
    </aside>
  );
}

function ProductHeader({ title }: { title: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.08] px-4 md:px-6">
      <div>
        <p className="text-[8px] tracking-[0.2em] text-[#6f7177] uppercase">
          Kroway system
        </p>
        <p className="mt-0.5 text-xs font-semibold text-[#e8e6e3]">{title}</p>
      </div>
      <div className="flex items-center gap-2 border border-white/10 px-3 py-2 text-[9px] text-[#a8a9ad]">
        <span className="sr-only">Example branch:</span>
        Downtown <ChevronDown aria-hidden="true" className="size-3" />
      </div>
    </header>
  );
}

function InboxScreen() {
  return (
    <div className="flex h-full w-1/3 shrink-0 bg-[#111214]">
      <ProductChrome active="Inbox" />
      <div className="min-w-0 flex-1">
        <ProductHeader title="Conversation workspace" />
        <div className="grid h-[calc(100%-3.5rem)] grid-cols-1 md:grid-cols-[14rem_1fr_13rem] lg:grid-cols-[16rem_1fr_15rem]">
          <div className="hidden border-r border-white/[0.08] p-3 md:block">
            <p className="px-2 text-[8px] tracking-[0.2em] text-[#6c6e73] uppercase">
              Active conversations
            </p>
            {[
              ["Jordan A.", "Can I visit tomorrow…", "Now"],
              ["Sam K.", "Do you have trainers?", "4m"],
              ["Maya R.", "What time do you close?", "12m"],
            ].map(([name, text, time], index) => (
              <div
                key={name}
                className={`mt-3 border-l px-3 py-3 ${index === 0 ? "border-[#dc8451] bg-white/[0.035]" : "border-transparent"}`}
              >
                <div className="flex justify-between gap-2">
                  <p className="text-[10px] font-medium text-[#dedbd7]">{name}</p>
                  <span className="text-[7px] text-[#67696e]">{time}</span>
                </div>
                <p className="mt-1 truncate text-[8px] text-[#74767b]">{text}</p>
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col p-4 md:p-6">
            <div className="border-b border-white/[0.08] pb-4">
              <p className="text-sm font-semibold text-[#ebe7e2]">Jordan A.</p>
              <p className="mt-1 text-[8px] text-[#72747a]">
                Example customer · After-hours inquiry
              </p>
            </div>
            <div className="flex-1 space-y-5 py-6">
              <div className="max-w-[27rem] border-l border-[#6b665f] pl-4">
                <p className="text-[7px] tracking-[0.22em] text-[#77736e] uppercase">
                  Customer
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[#c9c3bd]">
                  Can I visit tomorrow around 6?
                </p>
              </div>
              <div className="ml-auto max-w-[29rem] border-r border-[#d67c49] pr-4 text-right">
                <p className="text-[7px] tracking-[0.22em] text-[#d48a5c] uppercase">
                  Kroway
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[#f0e6dd]">
                  Absolutely. I can book that for you.
                </p>
              </div>
              <div className="ml-auto grid w-full max-w-[29rem] grid-cols-2 border-y border-[#784b35]/45 py-4">
                <div>
                  <p className="text-[7px] tracking-[0.2em] text-[#77736e] uppercase">
                    Visit
                  </p>
                  <p className="mt-1 text-[11px] text-[#ded5cd]">Tomorrow</p>
                </div>
                <div className="border-l border-white/10 pl-4">
                  <p className="text-[7px] tracking-[0.2em] text-[#77736e] uppercase">
                    Time
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-[#e59a65]">18:00</p>
                </div>
              </div>
            </div>
            <div className="h-10 border border-white/[0.09] px-4 py-3 text-[9px] text-[#62646a]">
              Message Jordan…
            </div>
          </div>
          <div className="hidden border-l border-white/[0.08] p-5 md:block">
            <p className="text-[8px] tracking-[0.2em] text-[#77797e] uppercase">
              Customer record
            </p>
            <div className="mt-5 space-y-5">
              <div>
                <p className="text-[7px] text-[#65676c] uppercase">Stage</p>
                <p className="mt-1 text-[10px] text-[#e09a69]">Visit booked</p>
              </div>
              <div>
                <p className="text-[7px] text-[#65676c] uppercase">Interest</p>
                <p className="mt-1 text-[10px] text-[#d0ccc8]">Monthly membership</p>
              </div>
              <div>
                <p className="text-[7px] text-[#65676c] uppercase">Source</p>
                <p className="mt-1 text-[10px] text-[#d0ccc8]">WhatsApp</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingsScreen() {
  const rows = [
    ["18:00", "Jordan A.", "Gym visit", "Confirmed"],
    ["18:30", "Sam K.", "Consultation", "Confirmed"],
    ["19:15", "Maya R.", "Trial session", "Pending"],
  ];
  return (
    <div className="flex h-full w-1/3 shrink-0 bg-[#111214]">
      <ProductChrome active="Bookings" />
      <div className="min-w-0 flex-1">
        <ProductHeader title="Bookings" />
        <div className="p-4 md:p-7 lg:p-9">
          <div className="flex items-end justify-between border-b border-white/[0.09] pb-5">
            <div>
              <p className="text-[8px] tracking-[0.2em] text-[#74767b] uppercase">
                Tomorrow
              </p>
              <h3 className="font-display mt-1 text-2xl font-bold tracking-[-0.05em] text-[#ece7e2] uppercase md:text-3xl">
                Visit schedule
              </h3>
            </div>
            <div className="flex border border-white/10 text-[8px]">
              <span className="bg-[#df8b58]/12 px-3 py-2 text-[#df9b70]">Today</span>
              <span className="px-3 py-2 text-[#707278]">Week</span>
            </div>
          </div>
          <div className="mt-5">
            <div className="hidden grid-cols-[7rem_1fr_1fr_8rem] gap-4 border-b border-white/[0.08] px-3 pb-3 text-[7px] tracking-[0.18em] text-[#63656a] uppercase md:grid">
              <span>Time</span>
              <span>Customer</span>
              <span>Booking type</span>
              <span>Status</span>
            </div>
            {rows.map(([time, name, type, status], index) => (
              <div
                key={name}
                className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-b border-white/[0.08] px-2 py-5 md:grid-cols-[7rem_1fr_1fr_8rem] md:gap-4 md:px-3"
              >
                <p className="font-display text-lg font-bold tracking-[-0.04em] text-[#e8a06f]">
                  {time}
                </p>
                <div>
                  <p className="text-[11px] font-medium text-[#ddd8d2]">{name}</p>
                  <p className="mt-1 text-[7px] text-[#696b70] md:hidden">{type}</p>
                </div>
                <p className="hidden text-[9px] text-[#949398] md:block">{type}</p>
                <span
                  className={`w-fit border px-2 py-1 text-[7px] uppercase ${index < 2 ? "border-[#826047] text-[#cda07e]" : "border-white/10 text-[#77797e]"}`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MembersScreen() {
  return (
    <div className="flex h-full w-1/3 shrink-0 bg-[#111214]">
      <ProductChrome active="Members" />
      <div className="min-w-0 flex-1">
        <ProductHeader title="Members" />
        <div className="grid h-[calc(100%-3.5rem)] grid-cols-1 md:grid-cols-[1fr_18rem]">
          <div className="p-4 md:p-7 lg:p-9">
            <p className="text-[8px] tracking-[0.2em] text-[#74767b] uppercase">
              Customer lifecycle
            </p>
            <h3 className="font-display mt-2 max-w-[13ch] text-3xl leading-[0.92] font-bold tracking-[-0.05em] text-[#ece7e2] uppercase md:text-4xl">
              From booked visit to member record.
            </h3>
            <div className="mt-8 border-y border-white/[0.09]">
              {[
                ["Jordan A.", "Monthly membership", "Active"],
                ["Maya R.", "Quarterly membership", "Expiring soon"],
                ["Sam K.", "Annual membership", "Active"],
              ].map(([name, plan, status]) => (
                <div
                  key={name}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/[0.08] py-4 last:border-0 md:grid-cols-[1fr_1fr_auto]"
                >
                  <p className="text-[11px] font-medium text-[#ddd8d2]">{name}</p>
                  <p className="hidden text-[9px] text-[#7d7f84] md:block">{plan}</p>
                  <span className="text-[8px] text-[#d4966d]">{status}</span>
                </div>
              ))}
            </div>
          </div>
          <aside className="hidden border-l border-white/[0.08] p-6 md:block">
            <p className="text-[8px] tracking-[0.2em] text-[#73757a] uppercase">
              Lifecycle connected
            </p>
            <div className="mt-7 space-y-5">
              {[
                "Conversation retained",
                "Visit attached",
                "Membership history",
                "Follow-up available",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 border-b border-white/[0.07] pb-4 text-[9px] text-[#aba8a4]"
                >
                  <span className="grid size-4 place-items-center border border-[#a25f3d]/55 text-[#e19764]">
                    <Check className="size-2.5" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function ProductStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const x = useTransform(
    scrollYProgress,
    [0, 0.2, 0.38, 0.52, 0.7, 1],
    ["0%", "0%", "-33.333%", "-33.333%", "-66.666%", "-66.666%"],
  );
  const captionOpacity = useTransform(
    scrollYProgress,
    [0, 0.02, 0.86, 1],
    [1, 1, 1, 0],
  );

  if (reducedMotion) {
    return (
      <section
        id="product-system"
        className="scroll-mt-24 bg-[#e8e0d6] px-5 py-24 text-[#171311] md:px-12 md:py-32"
      >
        <div className="mx-auto max-w-7xl">
          <p className="text-[9px] font-semibold tracking-[0.32em] text-[#9c5837] uppercase">
            Real Kroway product
          </p>
          <h2 className="font-display mt-5 max-w-[13ch] text-[clamp(3rem,5.5vw,5.6rem)] leading-[0.86] font-black tracking-[-0.065em] uppercase">
            A working system behind every reply.
          </h2>
          <div className="mt-12 h-[34rem] overflow-hidden border border-black/15">
            <InboxScreen />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      id="product-system"
      className="relative h-[300svh] scroll-mt-24 bg-[#e8e0d6] text-[#171311]"
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <motion.div
          className="absolute inset-x-5 top-20 z-10 md:inset-x-12 md:top-24 lg:inset-x-16"
          style={{ opacity: captionOpacity }}
        >
          <div className="mx-auto flex max-w-[96rem] items-end justify-between gap-8">
            <div>
              <p className="text-[8px] font-semibold tracking-[0.32em] text-[#985333] uppercase">
                Real Kroway product
              </p>
              <h2 className="font-display mt-3 max-w-[18ch] text-[clamp(1.8rem,2.8vw,3rem)] leading-[0.92] font-black tracking-[-0.05em] uppercase">
                WHERE CONVERSATIONS BECOME CUSTOMERS.
              </h2>
            </div>
            <p className="hidden max-w-xs text-sm leading-relaxed text-[#5e5149] md:block">
              Inbox, lead context, bookings and members stay connected as the customer
              moves forward.
            </p>
          </div>
        </motion.div>

        <div className="absolute inset-x-5 top-[44svh] bottom-8 overflow-hidden border border-black/20 shadow-[0_35px_90px_rgba(36,20,12,.24)] md:inset-x-12 md:top-[44svh] md:bottom-10 lg:inset-x-16">
          <motion.div className="flex h-full w-[300%]" style={{ x }}>
            <InboxScreen />
            <BookingsScreen />
            <MembersScreen />
          </motion.div>
        </div>

        <div className="absolute right-5 bottom-3 left-5 flex justify-between text-[7px] tracking-[0.18em] text-[#756157] uppercase md:right-12 md:left-12 lg:right-16 lg:left-16">
          <span>Conversation</span>
          <span>Booking</span>
          <span>Member</span>
        </div>
      </div>
    </section>
  );
}
