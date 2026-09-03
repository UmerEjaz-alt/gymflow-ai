import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "Does Kroway work with my existing WhatsApp number?",
    answer:
      "Kroway can definitely work with your existing whatsapp number. We will just review some terms and conditions before setting it up for you.",
  },
  {
    question: "What can Kroway answer for customers?",
    answer:
      "Kroway can use your configured packages, prices, facilities, trainers, opening hours, policies and branch information to answer everyday customer questions. kroway also specialises in handling every kind of customer and their different questions without misleading them.",
  },
    {
    question: "Can kroway send my gym pictures to the customers?",
    answer:
      "Kroway can definitely send pictures to your customers to show them your gym facilities. We also design poster cards for trainers which will help promote them.",
    },
    {
    question: "Can Kroway book gym visits?",
    answer:
      "Yes. Kroway can book gym visits and trial sessions or personal-training consultations and reflect the bookings in the dashboard. It also make sure no double bookings are made.",
  },
  {
    question: "Can I take over a conversation from the AI?",
    answer:
      "Yes. Your team can take over a conversation when a human response is the better choice, while keeping the conversation and customer context together.",
  },
  {
    question: "Can Kroway follow up with leads?",
    answer:
      "Yes. Lead follow-ups can be configured so promising conversations do not depend on staff remembering to message again.",
  },
  {
    question: "What information can I teach Kroway about my gym?",
    answer:
      "You can configure membership packages, facilities, trainers, opening hours, general policies, visit and trial rules, branch details and other knowledge customers regularly ask about.",
  },
  {
    question: "How long does setup take?",
    answer:
      "It depends on your WhatsApp setup and how much gym information needs to be configured. We connect the account, add your operating information and test the experience before it goes live.",
  },
  
] as const;

export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-24 bg-[#0a0a0b] px-5 py-24 text-[#f4f3ef] md:px-12 md:py-32 lg:px-16"
    >
      <div className="mx-auto grid max-w-[90rem] gap-14 lg:grid-cols-[0.7fr_1.3fr] lg:gap-24">
        <header>
          <p className="text-[9px] font-semibold tracking-[0.3em] text-white/42 uppercase">
            Questions, answered
          </p>
          <h2
            id="faq-heading"
            className="font-display mt-5 max-w-[9ch] text-[clamp(3.3rem,5vw,5.4rem)] leading-[0.86] font-black tracking-[-0.065em] uppercase"
          >
            Before Kroway goes live.
          </h2>
          <p className="mt-7 max-w-sm text-sm leading-relaxed text-white/48 md:text-base">
            The practical details gym owners ask before Kroway starts handling customer
            conversations.
          </p>
        </header>

        <div className="border-t border-white/16">
          {faqs.map((faq, index) => (
            <details key={faq.question} className="group border-b border-white/12">
              <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-6 py-5 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white [&::-webkit-details-marker]:hidden">
                <span className="grid grid-cols-[2rem_1fr] items-start gap-3">
                  <span className="pt-1 text-[8px] tracking-[0.18em] text-white/32">
                    0{index + 1}
                  </span>
                  <span className="font-display text-lg leading-tight font-semibold tracking-[-0.025em] text-white/88 md:text-xl">
                    {faq.question}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className="size-4 shrink-0 text-white/38 transition-transform duration-300 group-open:rotate-180"
                />
              </summary>
              <div className="grid grid-cols-[2rem_1fr] gap-3 pb-7">
                <span aria-hidden />
                <p className="max-w-2xl text-sm leading-relaxed text-white/52 md:text-base">
                  {faq.answer}
                </p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
