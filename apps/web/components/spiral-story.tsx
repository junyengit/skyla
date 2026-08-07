"use client";

import Image from "next/image";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform
} from "motion/react";

type StaircaseImageStep = {
  kind: "image";
  eyebrow: string;
  title: string;
  detail: string;
  src: string;
  alt: string;
  position?: string;
  placement: "left" | "right" | "wide";
  railX: number;
};

type StaircaseFactStep = {
  kind: "fact";
  eyebrow: string;
  title: string;
  detail: string;
  placement: "left" | "right" | "center";
  railX: number;
};

type StaircaseStep = StaircaseImageStep | StaircaseFactStep;

const staircaseSteps: StaircaseStep[] = [
  {
    kind: "image",
    eyebrow: "01 · West",
    title: "Century City",
    detail: "A skyline held above the neighborhoods of the Westside.",
    src: "/images/view-hills.jpg",
    alt: "Residential blocks stretching west toward the Century City skyline",
    position: "50% 82%",
    placement: "right",
    railX: 66
  },
  {
    kind: "fact",
    eyebrow: "02 · The panorama",
    title: "360°",
    detail: "One top floor, with sightlines running from the Hollywood Hills toward the ocean.",
    placement: "left",
    railX: 34
  },
  {
    kind: "image",
    eyebrow: "03 · North",
    title: "Museum Row",
    detail: "The Academy Museum and the city grid, seen from above Wilshire.",
    src: "/images/view-academy.jpg",
    alt: "Academy Museum and Museum Row seen from above",
    position: "50% 68%",
    placement: "right",
    railX: 73
  },
  {
    kind: "image",
    eyebrow: "04 · Inside",
    title: "The glass lounge",
    detail: "A quiet indoor vantage point behind floor-to-ceiling windows.",
    src: "/images/lounge-window.webp",
    alt: "Curved lounge seating surrounded by windows overlooking Los Angeles",
    placement: "wide",
    railX: 30
  },
  {
    kind: "fact",
    eyebrow: "05 · One ticket",
    title: "Deck + lounge",
    detail: "Admission covers the open observation deck and the indoor lounge on the full top floor.",
    placement: "right",
    railX: 67
  },
  {
    kind: "image",
    eyebrow: "06 · North",
    title: "Hollywood Hills",
    detail: "Rooftops rise toward the hills as the horizon keeps unfolding.",
    src: "/images/view-westside.jpg",
    alt: "Rooftops running north toward the Hollywood Hills",
    position: "50% 72%",
    placement: "left",
    railX: 38
  },
  {
    kind: "fact",
    eyebrow: "07 · Your arrival",
    title: "Timed entry",
    detail: "Choose a date and arrival window after launch, so the deck stays comfortable.",
    placement: "center",
    railX: 58
  }
];

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

function TypedTitleAccent({
  text,
  play,
  staticMode
}: {
  text: string;
  play: boolean;
  staticMode: boolean;
}) {
  const [typed, setTyped] = useState(() => (staticMode ? text : ""));

  useEffect(() => {
    if (!play) return;

    let character = 0;
    const timer = window.setInterval(() => {
      character += 1;
      setTyped(text.slice(0, character));
      if (character >= text.length) window.clearInterval(timer);
    }, 44);

    return () => window.clearInterval(timer);
  }, [play, text]);

  return (
    <span className="staircaseTitleAccent" aria-hidden="true">
      {typed}
      <i />
    </span>
  );
}

function LandingCopy({
  step,
  enhanced,
  active
}: {
  step: StaircaseStep;
  enhanced: boolean;
  active: boolean;
}) {
  return (
    <div className="staircaseLandingCopy">
      <span className="staircaseEyebrow">{step.eyebrow}</span>
      <div className="staircaseTitleStack">
        <h3>{step.title}</h3>
        <TypedTitleAccent
          key={`${enhanced ? "enhanced" : "static"}-${active ? "active" : "waiting"}`}
          text={step.title}
          play={enhanced && active}
          staticMode={!enhanced}
        />
      </div>
      <p>{step.detail}</p>
    </div>
  );
}

function StaircaseLevel({
  step,
  index,
  enhanced
}: {
  step: StaircaseStep;
  index: number;
  enhanced: boolean;
}) {
  const levelRef = useRef<HTMLElement>(null);
  const active = useInView(levelRef, { amount: 0.38, once: true });
  const { scrollYProgress } = useScroll({
    target: levelRef,
    offset: ["start 0.96", "center 0.58"]
  });
  const direction = step.placement === "left" ? -1 : step.placement === "right" ? 1 : 0;
  const x = useTransform(scrollYProgress, [0, 1], [`${direction * 7}vw`, "0vw"]);
  const y = useTransform(scrollYProgress, [0, 1], [110, 0]);
  const rotate = useTransform(scrollYProgress, [0, 1], [direction * 2.8, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.955, 1]);
  const levelStyle = { "--stair-rail-x": `${step.railX}%` } as CSSProperties;

  return (
    <section
      className={`staircaseLevel staircaseLevel${step.kind === "image" ? "Image" : "Fact"}`}
      data-placement={step.placement}
      data-step={String(index + 1).padStart(2, "0")}
      ref={levelRef}
      style={levelStyle}
      aria-label={`${String(index + 1).padStart(2, "0")}: ${step.title}`}
    >
      <span className="staircaseStepMarker" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <motion.article
        className="staircaseLanding"
        style={enhanced ? { x, y, rotate, scale } : undefined}
      >
        {step.kind === "image" ? (
          <figure>
            <div className="staircaseMedia">
              <Image
                src={step.src}
                alt={step.alt}
                fill
                sizes="(max-width: 820px) calc(100vw - 40px), 62vw"
                style={{ objectPosition: step.position }}
              />
              <span aria-hidden="true" />
            </div>
            <figcaption>
              <LandingCopy step={step} enhanced={enhanced} active={active} />
            </figcaption>
          </figure>
        ) : (
          <div className="staircaseFactPanel">
            <LandingCopy step={step} enhanced={enhanced} active={active} />
          </div>
        )}
      </motion.article>
    </section>
  );
}

export function SpiralStaircaseStory() {
  const storyRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const enhanced = useDesktopMotion(reduceMotion);
  const { scrollYProgress } = useScroll({
    target: storyRef,
    offset: ["start 0.82", "end 0.18"]
  });

  return (
    <section
      className={`staircaseStory${enhanced ? " isEnhanced" : ""}`}
      data-scroll-mode={enhanced ? "descending" : "static"}
      ref={storyRef}
      aria-labelledby="staircase-story-title"
    >
      <header className="staircaseIntro">
        <p className="sectionLabel">Seven turns above Wilshire</p>
        <h2 id="staircase-story-title">The view keeps building.</h2>
        <p>
          Follow the city downward, one landing at a time. Every turn opens another direction;
          every level adds another piece of Los Angeles.
        </p>
        <ul aria-label="What one ticket includes">
          <li>360° views</li>
          <li>Observation deck</li>
          <li>Indoor lounge</li>
          <li>Timed entry</li>
        </ul>
        <span className="staircaseIntroCue" aria-hidden="true">
          Scroll down · the staircase builds with you
        </span>
      </header>

      <div className="staircaseBuild">
        <svg
          className="staircaseRail"
          viewBox="0 0 100 700"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="staircaseRailGhost"
            d="M50 0 C83 28 87 68 66 100 C42 132 16 165 34 200 C52 235 88 270 73 300 C58 335 20 365 30 400 C42 438 82 468 67 500 C52 535 25 566 38 600 C50 632 77 666 58 700"
          />
          <motion.path
            className="staircaseRailDraw"
            d="M50 0 C83 28 87 68 66 100 C42 132 16 165 34 200 C52 235 88 270 73 300 C58 335 20 365 30 400 C42 438 82 468 67 500 C52 535 25 566 38 600 C50 632 77 666 58 700"
            style={enhanced ? { pathLength: scrollYProgress } : undefined}
          />
        </svg>

        {staircaseSteps.map((step, index) => (
          <StaircaseLevel
            key={`${step.eyebrow}-${step.title}`}
            step={step}
            index={index}
            enhanced={enhanced}
          />
        ))}
      </div>
    </section>
  );
}
