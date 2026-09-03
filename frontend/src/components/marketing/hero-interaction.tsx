"use client";

import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export type HeroPhase =
  | "opening"
  | "darkness"
  | "statement"
  | "customer-one"
  | "answer-one"
  | "customer-two"
  | "answer-two"
  | "resolving"
  | "booked";

const LAMP_OFF_TIME = 2.47;
const STATEMENT_TIME = 2.94;
const ease = [0.16, 1, 0.3, 1] as const;

export interface HeroStoryState {
  phase: HeroPhase;
  messageCount: number;
  showStatement: boolean;
  showConversation: boolean;
  showBooked: boolean;
  reducedMotion: boolean;
  setVideoRef: (video: HTMLVideoElement | null) => void;
  onVideoTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onVideoEnded: () => void;
  onVideoLoaded: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onVideoCanPlay: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onVideoError: () => void;
}

function prepareVideoForInlineAutoplay(video: HTMLVideoElement) {
  // Establish the native muted state before asking mobile browsers to play.
  // The explicit attributes cover client-side navigations and older iOS WebKit.
  video.defaultMuted = true;
  video.muted = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
}

export function useHeroStory(): HeroStoryState {
  const reducedMotion = Boolean(useReducedMotion());
  const [phase, setPhase] = useState<HeroPhase>(reducedMotion ? "booked" : "opening");
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoEndedRef = useRef(false);
  const playbackFallbackAttemptedRef = useRef(false);
  const postVideoTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearPostVideoTimers = useCallback(() => {
    postVideoTimers.current.forEach(clearTimeout);
    postVideoTimers.current = [];
  }, []);

  useEffect(() => clearPostVideoTimers, [clearPostVideoTimers]);

  useEffect(() => {
    if (!reducedMotion) return;

    clearPostVideoTimers();
    videoEndedRef.current = true;
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (Number.isFinite(video.duration))
        video.currentTime = Math.max(0, video.duration - 0.08);
    }
  }, [clearPostVideoTimers, reducedMotion]);

  const onVideoTimeUpdate = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      if (reducedMotion || videoEndedRef.current) return;
      const time = event.currentTarget.currentTime;
      setPhase(
        time >= STATEMENT_TIME
          ? "statement"
          : time >= LAMP_OFF_TIME
            ? "darkness"
            : "opening",
      );
    },
    [reducedMotion],
  );

  const onVideoEnded = useCallback(() => {
    if (reducedMotion || videoEndedRef.current) return;

    videoEndedRef.current = true;
    setPhase("statement");
    const beats: Array<[number, HeroPhase]> = [
      [450, "customer-one"],
      [1100, "answer-one"],
      [1850, "customer-two"],
      [2600, "answer-two"],
      [3250, "resolving"],
      [3700, "booked"],
    ];
    postVideoTimers.current = beats.map(([delay, nextPhase]) =>
      setTimeout(() => setPhase(nextPhase), delay),
    );
  }, [reducedMotion]);

  const showStaticFinal = useCallback(
    (video: HTMLVideoElement) => {
      clearPostVideoTimers();
      videoEndedRef.current = true;
      setPhase("booked");
      if (Number.isFinite(video.duration))
        video.currentTime = Math.max(0, video.duration - 0.08);
    },
    [clearPostVideoTimers],
  );

  const setVideoRef = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (video) prepareVideoForInlineAutoplay(video);
  }, []);

  const attemptVideoPlayback = useCallback(
    (video: HTMLVideoElement) => {
      if (reducedMotion || videoEndedRef.current || !video.paused) return;
      if (playbackFallbackAttemptedRef.current) return;

      playbackFallbackAttemptedRef.current = true;
      prepareVideoForInlineAutoplay(video);
      video.autoplay = true;

      const playback = video.play();
      if (!playback) return;

      void playback.catch(() => {
        // iOS may still reject autoplay when a device-level power or motion
        // policy is active. Keep the hero meaningful and avoid a rejected
        // playback promise in that case.
        if (video.isConnected) showStaticFinal(video);
      });
    },
    [reducedMotion, showStaticFinal],
  );

  const onVideoLoaded = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      prepareVideoForInlineAutoplay(video);

      if (reducedMotion) {
        showStaticFinal(video);
        return;
      }

      // WebKit can defer `canplay` until playback has already been requested.
      // Metadata is sufficient for one muted, inline playback attempt.
      attemptVideoPlayback(video);
    },
    [attemptVideoPlayback, reducedMotion, showStaticFinal],
  );

  const onVideoCanPlay = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      attemptVideoPlayback(event.currentTarget);
    },
    [attemptVideoPlayback],
  );

  const onVideoError = useCallback(() => {
    const video = videoRef.current;
    if (video) showStaticFinal(video);
    else setPhase("booked");
  }, [showStaticFinal]);

  const resolvedPhase = reducedMotion ? "booked" : phase;
  const messageCount =
    resolvedPhase === "customer-one"
      ? 1
      : resolvedPhase === "answer-one"
        ? 2
        : resolvedPhase === "customer-two"
          ? 3
          : resolvedPhase === "answer-two" ||
              resolvedPhase === "resolving" ||
              resolvedPhase === "booked"
            ? 4
            : 0;

  return {
    phase: resolvedPhase,
    messageCount,
    showStatement: !["opening", "darkness"].includes(resolvedPhase),
    showConversation: [
      "customer-one",
      "answer-one",
      "customer-two",
      "answer-two",
      "resolving",
    ].includes(resolvedPhase),
    showBooked: resolvedPhase === "booked",
    reducedMotion,
    setVideoRef,
    onVideoTimeUpdate,
    onVideoEnded,
    onVideoLoaded,
    onVideoCanPlay,
    onVideoError,
  };
}

const messages = [
  { speaker: "Customer", text: "Hi, how much is the monthly membership?" },
  {
    speaker: "Kroway",
    text: "Membership starts at $89/month, including full gym access.",
  },
  { speaker: "Customer", text: "Can I visit tomorrow around 6?" },
  { speaker: "Kroway", text: "Absolutely. I can book that for you." },
];

const surfacePosition =
  "absolute right-5 bottom-[11.5svh] left-5 md:right-[4vw] md:bottom-20 md:left-auto md:w-[20rem]";

function ConversationSurface({ story }: { story: HeroStoryState }) {
  return (
    <AnimatePresence>
      {story.showConversation ? (
        <motion.div
          data-hero-proof="conversation"
          className={surfacePosition}
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: story.phase === "resolving" ? 0.18 : 1,
            y: story.phase === "resolving" ? -8 : 0,
          }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: story.reducedMotion ? 0 : 0.48, ease }}
        >
          <div className="relative border-t border-l border-white/16 bg-black/58 px-4 py-3.5 shadow-[0_16px_42px_rgba(0,0,0,.28)] md:px-5 md:py-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <p className="text-[7px] font-semibold tracking-[0.28em] text-white/74 uppercase">
                After hours
              </p>
              <p className="text-[7px] tracking-[0.22em] text-white/38 uppercase">
                Kroway
              </p>
            </div>

            <div>
              <AnimatePresence initial={false}>
                {messages.slice(0, story.messageCount).map((message) => {
                  const isKroway = message.speaker === "Kroway";
                  return (
                    <motion.div
                      key={message.text}
                      initial={{ opacity: 0, y: 7 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.36, ease }}
                      className="grid grid-cols-[3.8rem_1fr] gap-2.5 border-b border-white/[0.07] py-2 md:grid-cols-[4rem_1fr]"
                    >
                      <span
                        className={`pt-0.5 text-[6px] font-semibold tracking-[0.19em] uppercase ${isKroway ? "text-white/72" : "text-white/34"}`}
                      >
                        {message.speaker}
                      </span>
                      <p
                        className={`text-[10px] leading-[1.35] tracking-[-0.01em] md:text-[11px] ${isKroway ? "text-[#f3f0ec]" : "font-serif text-white/64 italic"}`}
                      >
                        {message.text}
                      </p>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function BookingResult({ story }: { story: HeroStoryState }) {
  return (
    <AnimatePresence>
      {story.showBooked ? (
        <motion.div
          data-hero-proof="booked"
          className={surfacePosition}
          initial={story.reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: story.reducedMotion ? 0 : 0.58, ease }}
        >
          <div className="border-t border-l border-white/20 bg-black/64 px-4 py-4 shadow-[0_16px_42px_rgba(0,0,0,.3)] md:px-5 md:py-5">
            <p className="text-[7px] font-semibold tracking-[0.26em] text-white/42 uppercase">
              Conversation resolved
            </p>
            <div className="mt-2 overflow-hidden">
              <motion.h2
                initial={story.reducedMotion ? false : { y: "106%" }}
                animate={{ y: 0 }}
                transition={{ duration: story.reducedMotion ? 0 : 0.58, ease }}
                className="font-display text-[1.85rem] leading-[0.9] font-black tracking-[-0.045em] text-[#f7f4f0] uppercase md:text-[2rem]"
              >
                Visit booked
              </motion.h2>
            </div>
            <motion.div
              className="mt-4 flex items-end justify-between border-t border-white/10 pt-3"
              initial={story.reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: story.reducedMotion ? 0 : 0.44,
                delay: 0.2,
                ease,
              }}
            >
              <div>
                <p className="text-[6px] tracking-[0.2em] text-white/34 uppercase">
                  Day
                </p>
                <p className="font-display mt-1 text-lg font-bold tracking-[-0.035em] text-white/82 uppercase">
                  Tomorrow
                </p>
              </div>
              <div className="border-l border-white/12 pl-5 text-right">
                <p className="text-[6px] tracking-[0.2em] text-white/34 uppercase">
                  Time
                </p>
                <p className="font-display mt-1 text-xl font-bold tracking-[-0.035em] text-white uppercase">
                  18:00
                </p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function HeroNarrative({ story }: { story: HeroStoryState }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <ConversationSurface story={story} />
      <BookingResult story={story} />
    </div>
  );
}
