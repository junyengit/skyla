"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  motion,
  type MotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform
} from "motion/react";

type SpiralImageStep = {
  kind: "image";
  eyebrow: string;
  title: string;
  detail: string;
  src: string;
  alt: string;
  position?: string;
};

type SpiralFactStep = {
  kind: "fact";
  eyebrow: string;
  title: string;
  detail: string;
};

type SpiralStep = SpiralImageStep | SpiralFactStep;

const spiralSteps: SpiralStep[] = [
  {
    kind: "image",
    eyebrow: "01 · West",
    title: "Century City",
    detail: "A skyline held above the neighborhoods of the Westside.",
    src: "/images/view-hills.jpg",
    alt: "Residential blocks stretching west toward the Century City skyline",
    position: "50% 82%"
  },
  {
    kind: "fact",
    eyebrow: "02 · The panorama",
    title: "360°",
    detail: "One top floor, with sightlines running from the Hollywood Hills toward the ocean."
  },
  {
    kind: "image",
    eyebrow: "03 · North",
    title: "Museum Row",
    detail: "The Academy Museum and the city grid, seen from above Wilshire.",
    src: "/images/view-academy.jpg",
    alt: "Academy Museum and Museum Row seen from above",
    position: "50% 68%"
  },
  {
    kind: "image",
    eyebrow: "04 · Inside",
    title: "The glass lounge",
    detail: "A quiet indoor vantage point behind floor-to-ceiling windows.",
    src: "/images/lounge-window.webp",
    alt: "Curved lounge seating surrounded by windows overlooking Los Angeles"
  },
  {
    kind: "fact",
    eyebrow: "05 · One ticket",
    title: "Deck + lounge",
    detail: "Admission covers the open observation deck and the indoor lounge on the full top floor."
  },
  {
    kind: "image",
    eyebrow: "06 · North",
    title: "Hollywood Hills",
    detail: "Rooftops rise toward the hills as the horizon keeps unfolding.",
    src: "/images/view-westside.jpg",
    alt: "Rooftops running north toward the Hollywood Hills",
    position: "50% 72%"
  },
  {
    kind: "fact",
    eyebrow: "07 · Your arrival",
    title: "Timed entry",
    detail: "Choose a date and arrival window after launch, so the deck stays comfortable."
  }
];

const typedPhrases = [
  "West, toward Century City.",
  "A full turn around Los Angeles.",
  "North, over Museum Row.",
  "Inside, still wrapped in sky.",
  "One ticket. The whole top floor.",
  "The hills pull into view.",
  "Arrive, ascend, look outward."
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function useDesktopMotion(reduceMotion: boolean | null) {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 821px)");
    const update = () => setDesktop(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return desktop && !reduceMotion;
}

function SpiralCard({
  step,
  index,
  progress,
  enhanced
}: {
  step: SpiralStep;
  index: number;
  progress: MotionValue<number>;
  enhanced: boolean;
}) {
  const phase = (value: number) => value * (spiralSteps.length - 1) - index;
  const x = useTransform(progress, (value) => {
    const bounded = clamp(phase(value), -1.45, 1.45);
    const angle = bounded * 2.24 + index * Math.PI + Math.PI / 2;
    return `${Math.sin(angle) * 31}vw`;
  });
  const y = useTransform(progress, (value) => `${clamp(-phase(value) * 54, -78, 78)}vh`);
  const scale = useTransform(progress, (value) => 1 - Math.min(Math.abs(phase(value)), 1.5) * 0.22);
  const rotate = useTransform(progress, (value) => {
    const bounded = clamp(phase(value), -1.45, 1.45);
    const angle = bounded * 2.24 + index * Math.PI + Math.PI / 2;
    return Math.cos(angle) * 5;
  });
  const rotateY = useTransform(progress, (value) => {
    const bounded = clamp(phase(value), -1.45, 1.45);
    const angle = bounded * 2.24 + index * Math.PI + Math.PI / 2;
    return Math.cos(angle) * -13;
  });
  const opacity = useTransform(progress, (value) => {
    const distance = Math.abs(phase(value));
    if (distance >= 1.5) return 0.12;
    return 1 - distance * 0.48;
  });

  return (
    <motion.article
      className={`spiralCard spiralCard${step.kind === "image" ? "Image" : "Fact"}`}
      data-step={String(index + 1).padStart(2, "0")}
      style={enhanced ? { x, y, scale, rotate, rotateY, opacity } : undefined}
    >
      {step.kind === "image" ? (
        <figure>
          <div className="spiralCardMedia">
            <Image
              src={step.src}
              alt={step.alt}
              fill
              sizes="(max-width: 820px) calc(100vw - 40px), 32vw"
              style={{ objectPosition: step.position }}
            />
          </div>
          <figcaption>
            <span>{step.eyebrow}</span>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
          </figcaption>
        </figure>
      ) : (
        <div className="spiralFactBody">
          <span>{step.eyebrow}</span>
          <strong>{step.title}</strong>
          <p>{step.detail}</p>
        </div>
      )}
    </motion.article>
  );
}

function TypedSkylinePhrase({
  phrase,
  animate
}: {
  phrase: string;
  animate: boolean;
}) {
  const [typed, setTyped] = useState(() => (animate ? "" : phrase));

  useEffect(() => {
    if (!animate) return;

    let character = 0;
    const timer = window.setInterval(() => {
      character += 1;
      setTyped(phrase.slice(0, character));
      if (character >= phrase.length) window.clearInterval(timer);
    }, 34);

    return () => window.clearInterval(timer);
  }, [animate, phrase]);

  return (
    <p className="spiralTyped" aria-hidden="true">
      <span>{typed}</span>
      <i />
    </p>
  );
}

export function SpiralStory() {
  const storyRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const enhanced = useDesktopMotion(reduceMotion);
  const [activeStep, setActiveStep] = useState(0);
  const { scrollYProgress } = useScroll({
    target: storyRef,
    offset: ["start start", "end end"]
  });
  const orbitRotation = useTransform(scrollYProgress, [0, 1], [0, 300]);

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const next = clamp(Math.round(latest * (spiralSteps.length - 1)), 0, spiralSteps.length - 1);
    setActiveStep((current) => (current === next ? current : next));
  });

  return (
    <section
      className={`spiralStory${enhanced ? " isEnhanced" : ""}`}
      data-scroll-mode={enhanced ? "spiral" : "static"}
      ref={storyRef}
      aria-labelledby="spiral-story-title"
    >
      <div className="spiralStoryStage">
        <div className="spiralAtmosphere" aria-hidden="true">
          <motion.div
            className="spiralOrbit spiralOrbitOuter"
            style={enhanced ? { rotate: orbitRotation } : undefined}
          />
          <motion.div
            className="spiralOrbit spiralOrbitInner"
            style={enhanced ? { rotate: orbitRotation } : undefined}
          />
          <span className="spiralAxis" />
        </div>

        <header className="spiralStoryCore">
          <p className="sectionLabel">The ascent</p>
          <h2 id="spiral-story-title">The city turns around you.</h2>
          <p className="spiralStoryCopy">
            Each step opens another direction—street grid, museum domes, distant hills, then sky.
            The full top floor is yours to take in.
          </p>
          <ul className="spiralStoryFacts" aria-label="What one ticket includes">
            <li>360° views</li>
            <li>Deck + lounge</li>
            <li>Timed entry</li>
          </ul>
          <span className="srOnly">{typedPhrases.join(" ")}</span>
          <TypedSkylinePhrase
            key={`${enhanced ? "typed" : "static"}-${activeStep}`}
            phrase={typedPhrases[activeStep] ?? typedPhrases[0]}
            animate={enhanced}
          />
          <p className="spiralScrollCue" aria-hidden="true">
            <span>Scroll to climb</span>
            <b>{String(activeStep + 1).padStart(2, "0")} — {String(spiralSteps.length).padStart(2, "0")}</b>
          </p>
        </header>

        <div className="spiralSteps">
          {spiralSteps.map((step, index) => (
            <SpiralCard
              key={`${step.eyebrow}-${step.title}`}
              step={step}
              index={index}
              progress={scrollYProgress}
              enhanced={enhanced}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
