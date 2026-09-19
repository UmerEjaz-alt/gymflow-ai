"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
  type MotionStyle,
} from "framer-motion";
import {
  ArrowDown,
  Bot,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Inbox,
  MessageSquare,
  MoreHorizontal,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import styles from "./product-story.module.css";

const chapters = [
  {
    label: "Inbox",
    icon: Inbox,
    title: "A conversation. A clear next step.",
    description: "See the message, the customer, and what happens next — together.",
    proof: "Customer context",
    outcome: "Visit booked",
    note: "An after-hours question becomes a confirmed gym visit.",
  },
  {
    label: "Bookings",
    icon: CalendarDays,
    title: "The visit is already on the schedule.",
    description: "Your team knows who is coming, when, and why they reached out.",
    proof: "Connected bookings",
    outcome: "Ready for the visit",
    note: "The booking keeps the conversation attached, so staff have the context.",
  },
  {
    label: "Members",
    icon: UsersRound,
    title: "The relationship stays connected.",
    description: "Memberships, conversation history, and follow-ups in one place.",
    proof: "Member history",
    outcome: "A connected member",
    note: "One customer record carries the relationship beyond the first visit.",
  },
];
const people = [
  {
    name: "Jordan A.",
    initials: "JA",
    message: "Can I visit tomorrow around 6?",
    time: "Now",
    color: "copper",
  },
  {
    name: "Sam K.",
    initials: "SK",
    message: "Do you have personal trainers?",
    time: "4m",
    color: "blue",
  },
  {
    name: "Maya R.",
    initials: "MR",
    message: "What time do you close?",
    time: "12m",
    color: "green",
  },
  {
    name: "Alex M.",
    initials: "AM",
    message: "Thanks, see you then!",
    time: "28m",
    color: "purple",
  },
];

function Avatar({
  initials,
  color = "copper",
  large = false,
}: {
  initials: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <span
      className={`${styles.avatar} ${styles[color]} ${large ? styles.avatarLarge : ""}`}
    >
      {initials}
    </span>
  );
}

function InboxPreview() {
  return (
    <div className={styles.inbox}>
      <aside className={styles.conversations} aria-label="Example conversations">
        <div className={styles.listHeading}>
          <strong>Messages</strong>
          <span className={styles.count}>4</span>
        </div>
        <div className={styles.search}>
          <Search size={13} /> Search conversations
        </div>
        <div className={styles.filters}>
          <span>All messages</span>
          <span>Unread</span>
        </div>
        {people.map((person, index) => (
          <div
            key={person.name}
            className={`${styles.person} ${index === 0 ? styles.selectedPerson : ""}`}
          >
            <Avatar initials={person.initials} color={person.color} />
            <div>
              <div className={styles.personName}>
                <strong>{person.name}</strong>
                <small>{person.time}</small>
              </div>
              <p>{person.message}</p>
              <span className={styles.channel}>WhatsApp</span>
            </div>
          </div>
        ))}
        <div className={styles.listFooter}>
          <ShieldCheck size={14} /> Your team stays in control
        </div>
      </aside>
      <div className={styles.chat}>
        <div className={styles.chatHeader}>
          <Avatar initials="JA" />
          <div>
            <strong>Jordan A.</strong>
            <span>WhatsApp conversation</span>
          </div>
          <span className={styles.aiBadge}>
            <Sparkles size={12} /> AI handling
          </span>
        </div>
        <div className={styles.messages}>
          <span className={styles.dateDivider}>Today · 8:42 PM</span>
          <div className={styles.customerMessage}>
            <p>Hi! Can I visit tomorrow around 6?</p>
            <small>8:42 PM</small>
          </div>
          <div className={styles.assistantLabel}>
            <Sparkles size={12} /> Kroway
          </div>
          <div className={styles.aiMessage}>
            <p>
              Absolutely. I can book a gym visit for tomorrow at 6:00 PM. Shall I
              confirm it?
            </p>
            <small>
              8:42 PM <CheckCheck size={12} />
            </small>
          </div>
          <div className={styles.customerMessage}>
            <p>Yes, that works. Thank you!</p>
            <small>8:43 PM</small>
          </div>
          <div className={styles.bookingReceipt}>
            <div className={styles.receiptIcon}>
              <CalendarDays size={18} />
            </div>
            <div>
              <strong>Gym visit confirmed</strong>
              <span>Tomorrow · 6:00 PM · Downtown</span>
            </div>
            <Check size={15} />
          </div>
          <div className={styles.systemMessage}>
            <CheckCheck size={13} /> Booking added to Jordan’s record
          </div>
        </div>
        <div className={styles.composer}>
          <span>Message Jordan…</span>
          <span>
            <Send size={14} />
          </span>
        </div>
        <p className={styles.composerNote}>
          AI handles the reply. Your team can take over.
        </p>
      </div>
      <aside className={styles.customerContext}>
        <div className={styles.contextHeading}>
          Customer details <MoreHorizontal size={16} />
        </div>
        <div className={styles.profile}>
          <Avatar initials="JA" large />
          <strong>Jordan A.</strong>
          <span>New lead · WhatsApp</span>
        </div>
        <div className={styles.contextFields}>
          <div>
            <span>Interested in</span>
            <strong>Monthly membership</strong>
          </div>
          <div>
            <span>Branch</span>
            <strong>Downtown</strong>
          </div>
          <div>
            <span>Stage</span>
            <b className={styles.status}>Visit booked</b>
          </div>
        </div>
        <p className={styles.eyebrow}>Next up</p>
        <div className={styles.nextVisit}>
          <CalendarDays size={17} />
          <strong>Gym visit</strong>
          <span>Tomorrow, 6:00 PM</span>
        </div>
        <div className={styles.contextHistory}>
          <span />
          <p>
            Conversation started<small>Today, 8:42 PM</small>
          </p>
        </div>
        <div className={styles.contextHistory}>
          <span />
          <p>
            Visit confirmed<small>Today, 8:43 PM</small>
          </p>
        </div>
      </aside>
    </div>
  );
}

function BookingsPreview() {
  return (
    <div className={styles.workspace}>
      <div className={styles.workspaceHeading}>
        <div>
          <h3>Bookings</h3>
          <p>A clear plan for every visit.</p>
        </div>
        <span className={styles.viewSwitch}>
          <span>Today</span>
          <b>Week</b>
        </span>
      </div>
      <div className={styles.scheduleLayout}>
        <div className={styles.schedule}>
          <div className={styles.dayHeading}>
            <span>Tomorrow</span>
            <small>3 bookings</small>
          </div>
          {[
            ["18:00", "JA", "Jordan A.", "Gym visit", "Confirmed"],
            ["18:30", "SK", "Sam K.", "Consultation", "Confirmed"],
            ["19:15", "MR", "Maya R.", "Trial session", "Pending"],
          ].map(([time, initials, name, type, status], i) => (
            <div
              key={name}
              className={`${styles.appointment} ${i === 0 ? styles.highlightAppointment : ""}`}
            >
              <span className={styles.appointmentTime}>{time}</span>
              <Avatar
                initials={initials}
                color={i === 1 ? "blue" : i === 2 ? "green" : "copper"}
              />
              <div>
                <strong>{name}</strong>
                <span>{type}</span>
              </div>
              <b className={status === "Confirmed" ? styles.status : styles.pending}>
                {status}
              </b>
            </div>
          ))}
          <div className={styles.dayHeading}>
            <span>The following day</span>
            <small>1 booking</small>
          </div>
          <div className={styles.appointment}>
            <span className={styles.appointmentTime}>17:00</span>
            <Avatar initials="AM" color="purple" />
            <div>
              <strong>Alex M.</strong>
              <span>Gym visit</span>
            </div>
            <b className={styles.status}>Confirmed</b>
          </div>
          <div className={styles.scheduleNote}>
            <Clock3 size={14} /> All visit times shown for the Downtown branch.
          </div>
        </div>
        <aside className={styles.visitDetail}>
          <div className={styles.detailKicker}>
            <CalendarDays size={15} /> Booking details
          </div>
          <Avatar initials="JA" large />
          <h4>Jordan’s gym visit</h4>
          <span className={styles.status}>Confirmed</span>
          <dl>
            <div>
              <dt>When</dt>
              <dd>Tomorrow, 6:00 PM</dd>
            </div>
            <div>
              <dt>Where</dt>
              <dd>Downtown branch</dd>
            </div>
            <div>
              <dt>Created from</dt>
              <dd>
                <MessageSquare size={13} /> WhatsApp conversation
              </dd>
            </div>
          </dl>
          <blockquote>
            “Can I visit tomorrow around 6?”<span>Jordan A. · Original message</span>
          </blockquote>
          <p>
            <Check size={13} /> Customer context stays attached
          </p>
        </aside>
      </div>
    </div>
  );
}

function MembersPreview() {
  return (
    <div className={styles.workspace}>
      <div className={styles.workspaceHeading}>
        <div>
          <h3>Members</h3>
          <p>Know the person behind the membership.</p>
        </div>
        <span className={styles.memberLabel}>
          <UsersRound size={14} /> Member directory
        </span>
      </div>
      <div className={styles.memberLayout}>
        <div className={styles.directory}>
          <div className={styles.directoryToolbar}>
            <div className={styles.search}>
              <Search size={13} /> Search members
            </div>
            <span>
              All memberships <ChevronDown size={12} />
            </span>
          </div>
          <div className={styles.tableHeading}>
            <span>Member</span>
            <span>Package</span>
            <span>Status</span>
          </div>
          {[
            ["JA", "Jordan A.", "Monthly", "Active", "copper"],
            ["MR", "Maya R.", "Quarterly", "Expiring soon", "green"],
            ["SK", "Sam K.", "Annual", "Active", "blue"],
            ["AM", "Alex M.", "Monthly", "Active", "purple"],
          ].map(([initials, name, plan, status, color], i) => (
            <div
              key={name}
              className={`${styles.memberRow} ${i === 0 ? styles.highlightMember : ""}`}
            >
              <div>
                <Avatar initials={initials} color={color} />
                <strong>{name}</strong>
              </div>
              <span>
                {plan}
                <small>membership</small>
              </span>
              <b className={status === "Active" ? styles.status : styles.pending}>
                {status}
              </b>
            </div>
          ))}
          <div className={styles.scheduleNote}>
            <ShieldCheck size={14} /> Membership details and conversation history,
            together.
          </div>
        </div>
        <aside className={styles.memberDetail}>
          <div className={styles.detailKicker}>
            Member profile <MoreHorizontal size={16} />
          </div>
          <div className={styles.memberIdentity}>
            <Avatar initials="JA" large />
            <div>
              <h4>Jordan A.</h4>
              <span>Monthly membership</span>
            </div>
          </div>
          <div className={styles.membershipCard}>
            <span>Membership</span>
            <strong>Monthly</strong>
            <b className={styles.status}>Active</b>
          </div>
          <p className={styles.eyebrow}>The journey so far</p>
          <div className={styles.timeline}>
            {[
              [MessageSquare, "First conversation", "Asked about a gym visit"],
              [CalendarDays, "Visit booked", "Downtown · 6:00 PM"],
              [UserRoundCheck, "Membership active", "Monthly membership"],
            ].map(([Icon, title, text]) => {
              const StepIcon = Icon as typeof MessageSquare;
              return (
                <div key={String(title)}>
                  <span>
                    <StepIcon size={14} />
                  </span>
                  <p>
                    <strong>{String(title)}</strong>
                    <small>{String(text)}</small>
                  </p>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

const screens = [InboxPreview, BookingsPreview, MembersPreview];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function ScrollPanel({
  index,
  progress,
  active,
  reducedMotion,
}: {
  index: number;
  progress: MotionValue<number>;
  active: number;
  reducedMotion: boolean;
}) {
  const opacity = useTransform(progress, (value) => {
    if (index === 0) return 1 - clamp((value - 0.3) / 0.06);
    if (index === 1)
      return Math.min(clamp((value - 0.3) / 0.06), 1 - clamp((value - 0.63) / 0.06));
    return clamp((value - 0.63) / 0.06);
  });
  const shift = useTransform(opacity, [0, 1], [12, 0]);
  const Screen = screens[index];
  return (
    <motion.div
      id={`product-panel-${index}`}
      role="tabpanel"
      aria-labelledby={`product-tab-${index}`}
      aria-hidden={active !== index}
      inert={active !== index}
      className={styles.scrollPanel}
      style={
        reducedMotion ? { opacity: active === index ? 1 : 0 } : { opacity, y: shift }
      }
    >
      <Screen />
    </motion.div>
  );
}

export function ProductStory() {
  const trackRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const reducedMotion = Boolean(useReducedMotion());
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start 96px", "end end"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 220,
    damping: 38,
    mass: 0.35,
  });
  useMotionValueEvent(progress, "change", (value) => {
    if (!reducedMotion) setActive(value < 0.33 ? 0 : value < 0.66 ? 1 : 2);
  });
  // Each reveal is a position on the scroll track, never a timed playback.
  const inquiry = useTransform(progress, [0, 0.045], [0, 1]);
  const reply = useTransform(progress, [0.06, 0.105], [0, 1]);
  const confirmation = useTransform(progress, [0.12, 0.16], [0, 1]);
  const booking = useTransform(progress, [0.18, 0.235], [0, 1]);
  const visit = useTransform(progress, [0.37, 0.44], [0, 1]);
  const context = useTransform(progress, [0.46, 0.54], [0, 1]);
  const member = useTransform(progress, [0.7, 0.76], [0, 1]);
  const history = useTransform(progress, [0.78, 0.88], [0, 1]);
  const revealStyle = reducedMotion
    ? undefined
    : ({
        "--inquiry": inquiry,
        "--reply": reply,
        "--confirmation": confirmation,
        "--booking": booking,
        "--visit": visit,
        "--context": context,
        "--member": member,
        "--history": history,
      } as MotionStyle);

  function select(index: number) {
    if (reducedMotion) {
      setActive(index);
      return;
    }
    const track = trackRef.current;
    if (!track) return;
    const start = track.getBoundingClientRect().top + window.scrollY - 96;
    const travel = track.offsetHeight - window.innerHeight + 96;
    window.scrollTo({
      top: start + travel * [0.25, 0.57, 0.93][index],
      behavior: "smooth",
    });
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % 3
        : event.key === "ArrowLeft"
          ? (index + 2) % 3
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  }
  const chapter = chapters[active];
  return (
    <section
      id="product-system"
      aria-labelledby="product-story-title"
      className={styles.section}
      data-scroll-story={!reducedMotion}
    >
      <div className={styles.intro}>
        <h2 id="product-story-title">
          Where conversations
          <br />
          <span>become customers.</span>
        </h2>
        <p className={styles.introCopy}>One customer. Every step connected.</p>
      </div>
      <div ref={trackRef} className={styles.scrollTrack}>
        <div className={styles.stickyStage}>
          <div className={styles.scrollCaption}>
            <span>
              {reducedMotion
                ? "Explore Jordan’s journey"
                : "Scroll to follow Jordan’s journey"}
            </span>
            {!reducedMotion && <ArrowDown size={14} />}
          </div>
          <motion.div className={styles.frame} style={revealStyle}>
            <div className={styles.windowBar}>
              <div className={styles.windowDots}>
                <i />
                <i />
                <i />
              </div>
              <span>Kroway workspace</span>
              <span className={styles.previewBadge}>Product preview</span>
            </div>
            <div className={styles.application}>
              <aside className={styles.sidebar}>
                <div className={styles.brand}>
                  KROWAY<span>WORKSPACE</span>
                </div>
                <div className={styles.branch}>
                  <span className={styles.branchMonogram}>D</span>
                  <div>
                    Downtown<span>Gym workspace</span>
                  </div>
                  <ChevronDown size={12} />
                </div>
                <p className={styles.navLabel}>Workspace</p>
                <nav aria-label="Product preview navigation">
                  {[
                    ["Inbox", Inbox, 0],
                    ["Leads", UserRoundCheck, -1],
                    ["Bookings", CalendarDays, 1],
                    ["Members", UsersRound, 2],
                    ["Automations", Bot, -1],
                  ].map(([label, Icon, index]) => {
                    const NavIcon = Icon as typeof Inbox;
                    return Number(index) >= 0 ? (
                      <button
                        type="button"
                        key={String(label)}
                        onClick={() => select(Number(index))}
                        aria-label={`Show ${String(label)} preview`}
                        aria-pressed={active === index}
                        className={active === index ? styles.activeNav : ""}
                      >
                        <NavIcon size={16} />
                        <span>{String(label)}</span>
                        {active === index && <span className={styles.navDot} />}
                      </button>
                    ) : (
                      <span className={styles.staticNav} key={String(label)}>
                        <NavIcon size={16} />
                        <span>{String(label)}</span>
                      </span>
                    );
                  })}
                </nav>
                <div className={styles.sidebarBottom}>
                  <span>
                    <Settings size={15} /> Settings
                  </span>
                  <div>
                    <Avatar initials="DT" />
                    <p>
                      Downtown team<span>Gym administrator</span>
                    </p>
                  </div>
                </div>
              </aside>

              <div className={styles.main}>
                <header className={styles.appHeader}>
                  <div>
                    Workspace <span>/</span>
                    <strong>{chapter.label}</strong>
                  </div>
                  <span>
                    <span className={styles.connectionDot} /> WhatsApp connected
                  </span>
                </header>
                <div className={styles.screen}>
                  {screens.map((_, index) => (
                    <ScrollPanel
                      key={index}
                      index={index}
                      progress={progress}
                      active={active}
                      reducedMotion={reducedMotion}
                    />
                  ))}
                </div>
                <div className={styles.appStatus}>
                  <span>
                    <CheckCheck size={13} /> {chapter.proof}
                  </span>
                  <span>Illustrative customer records</span>
                </div>
              </div>
            </div>
            {!reducedMotion && (
              <div className={styles.scrollProgress} aria-hidden="true">
                <motion.span style={{ scaleX: progress }} />
              </div>
            )}
          </motion.div>
          <div
            className={styles.chapterNavigation}
            role="tablist"
            aria-label="Explore the Kroway workspace"
          >
            {chapters.map(({ label, icon: Icon }, index) => (
              <button
                key={label}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={`product-tab-${index}`}
                role="tab"
                aria-selected={active === index}
                aria-controls={`product-panel-${index}`}
                tabIndex={active === index ? 0 : -1}
                type="button"
                onClick={() => select(index)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                <span>0{index + 1}</span>
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className={styles.scrollExplanation}>
            <h3>{chapter.title}</h3>
            <p>{chapter.description}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
