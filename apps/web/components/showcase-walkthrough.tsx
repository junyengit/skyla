"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  showcaseChapters,
  showcaseFrameSrc,
  type ShowcaseChapter
} from "@/lib/showcase-experience";

const CHAPTER_SCROLL_VH = 1.35;
const TRANSITION_EDGE = 0.08;
const SCRIM_PEAK = 0.96;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const smooth = (value: number) => value * value * (3 - 2 * value);

function gradeFilter(grade: ShowcaseChapter["grade"]) {
  return [
    `brightness(${grade.brightness})`,
    `contrast(${grade.contrast})`,
    `saturate(${grade.saturation})`,
    `sepia(${grade.sepia})`
  ].join(" ");
}

export function ShowcaseWalkthrough() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const motionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const overlayRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const wrap = wrapRef.current;
    const rail = railRef.current;
    if (!wrap) return;

    let disposed = false;
    let progress = 0;
    let dirty = true;
    let activeChapter = -1;
    const railButtons = rail ? Array.from(rail.querySelectorAll("button")) : [];

    document.documentElement.classList.add("showcaseScrub");

    function updateScene() {
      const scaled = progress * showcaseChapters.length;
      const index = Math.min(Math.floor(scaled), showcaseChapters.length - 1);
      const local = clamp01(
        index === showcaseChapters.length - 1 && progress === 1 ? 1 : scaled - index
      );
      const entering = index > 0 && local < TRANSITION_EDGE
        ? smooth(local / TRANSITION_EDGE)
        : 1;
      const exiting = local > 1 - TRANSITION_EDGE
        ? smooth((local - (1 - TRANSITION_EDGE)) / TRANSITION_EDGE)
        : 0;
      const push = smooth(clamp01((local - TRANSITION_EDGE) / (1 - TRANSITION_EDGE * 2)));
      const exitProgress = index < showcaseChapters.length - 1 ? exiting : 0;

      layerRefs.current.forEach((layer, layerIndex) => {
        if (!layer) return;
        const active = layerIndex === index;
        layer.style.opacity = active ? "1" : "0";
        layer.style.visibility = active ? "visible" : "hidden";
        layer.style.zIndex = active ? "1" : "0";
        layer.style.filter = active
          ? `brightness(${1 - exitProgress * 0.72}) blur(${exitProgress * 8}px)`
          : "";
      });

      const motion = motionRefs.current[index];
      if (motion) {
        const scale = local < TRANSITION_EDGE ? 1.15 - entering * 0.15 : 1 + push * 0.12;
        motion.style.transform = `translate3d(0, ${1.5 - push * 3}%, 0) scale(${scale})`;
      }

      if (scrimRef.current) {
        scrimRef.current.style.opacity = String(
          index > 0 && local < TRANSITION_EDGE
            ? SCRIM_PEAK * (1 - entering)
            : index < showcaseChapters.length - 1 && local > 1 - TRANSITION_EDGE
              ? SCRIM_PEAK * exiting
              : 0
        );
      }

      const textIn = index === 0 ? 1 : smooth(clamp01((local - 0.04) / 0.13));
      const textOut = index === showcaseChapters.length - 1
        ? 0
        : smooth(clamp01((local - 0.79) / 0.13));
      const textOpacity = textIn * (1 - textOut);
      overlayRefs.current.forEach((overlay, overlayIndex) => {
        if (!overlay) return;
        if (overlayIndex === index) {
          overlay.style.opacity = String(textOpacity);
          overlay.style.transform = `translateY(${26 * (1 - textIn) - 18 * textOut}px)`;
          overlay.classList.toggle("live", textOpacity > 0.6);
        } else {
          overlay.style.opacity = "0";
          overlay.style.transform = "translateY(26px)";
          overlay.classList.remove("live");
        }
      });

      if (index !== activeChapter) {
        railButtons.forEach((button, buttonIndex) => {
          button.setAttribute("aria-current", buttonIndex === index ? "true" : "false");
        });
        activeChapter = index;
      }
    }

    function clearScene() {
      layerRefs.current.forEach((layer) => {
        if (!layer) return;
        ["opacity", "visibility", "z-index", "filter"].forEach((property) =>
          layer.style.removeProperty(property)
        );
      });
      motionRefs.current.forEach((motion) => motion?.style.removeProperty("transform"));
      overlayRefs.current.forEach((overlay) => {
        if (!overlay) return;
        overlay.style.removeProperty("opacity");
        overlay.style.removeProperty("transform");
        overlay.classList.remove("live");
      });
      scrimRef.current?.style.removeProperty("opacity");
    }

    let trigger: {
      kill: (revert?: boolean) => void;
      start: number;
      end: number;
      progress: number;
    } | null = null;
    let ticker: (() => void) | null = null;
    let gsapRef: typeof import("gsap").gsap | null = null;
    const railListeners: Array<{ button: HTMLButtonElement; handler: () => void }> = [];

    async function setup() {
      const { gsap } = await import("gsap");
      if (disposed) return;
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);
      gsapRef = gsap;

      trigger = ScrollTrigger.create({
        trigger: wrap,
        start: "top top",
        end: () => `+=${Math.round(showcaseChapters.length * innerHeight * CHAPTER_SCROLL_VH)}`,
        pin: true,
        scrub: true,
        anticipatePin: 1,
        onUpdate(self) {
          progress = self.progress;
          dirty = true;
        },
        onToggle(self) {
          rail?.classList.toggle("visible", self.isActive);
        }
      });

      railButtons.forEach((button, index) => {
        const handler = () => {
          if (!trigger) return;
          const midpoint = (index + 0.5) / showcaseChapters.length;
          scrollTo({
            top: trigger.start + midpoint * (trigger.end - trigger.start),
            behavior: "smooth"
          });
        };
        button.addEventListener("click", handler);
        railListeners.push({ button, handler });
      });

      ticker = () => {
        if (!dirty) return;
        dirty = false;
        updateScene();
      };
      gsap.ticker.add(ticker);
      progress = trigger.progress;
      dirty = true;
    }

    void setup().catch((error: unknown) => {
      if (disposed) return;
      clearScene();
      document.documentElement.classList.remove("showcaseScrub");
      console.error("Showcase enhancement failed", error);
    });

    return () => {
      disposed = true;
      railListeners.forEach(({ button, handler }) => button.removeEventListener("click", handler));
      if (ticker && gsapRef) gsapRef.ticker.remove(ticker);
      trigger?.kill(true);
      clearScene();
      rail?.classList.remove("visible");
      document.documentElement.classList.remove("showcaseScrub");
    };
  }, []);

  return (
    <section className="showcaseStage" aria-label="A walkthrough of Sky LA">
      <div className="showcasePinned" ref={wrapRef} aria-hidden="true">
        <div className="showcaseStack">
          {showcaseChapters.map((chapter, index) => (
            <div
              className="showcaseLayer"
              key={chapter.image}
              ref={(element) => { layerRefs.current[index] = element; }}
            >
              <div
                className="showcaseImageMotion"
                ref={(element) => { motionRefs.current[index] = element; }}
              >
                <picture>
                  <source media="(max-width: 767px)" srcSet={showcaseFrameSrc(chapter.image, true)} />
                  <img
                    className="showcaseImage"
                    src={showcaseFrameSrc(chapter.image, false)}
                    alt=""
                    fetchPriority={index === 0 ? "high" : "auto"}
                    style={{ filter: gradeFilter(chapter.grade), objectPosition: chapter.focus }}
                  />
                </picture>
              </div>
            </div>
          ))}
        </div>
        <div className="showcaseVignette" />
        <div className="showcaseGrain" />
        <div className="showcaseScrim" ref={scrimRef} />
        {showcaseChapters.map((chapter, index) => (
          <div
            className="showcaseOverlay"
            key={chapter.title}
            ref={(element) => { overlayRefs.current[index] = element; }}
          >
            <p className="showcaseKicker">{chapter.kicker}</p>
            <p className="showcaseTitle">{chapter.title}</p>
            <p className="showcaseCopy">{chapter.copy}</p>
            {"cta" in chapter ? (
              <p className="showcaseCta">
                <a className="showcaseButton" href="#book-venue" tabIndex={-1}>{chapter.cta}</a>
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {showcaseChapters.map((chapter, index) => {
        const style: CSSProperties = {
          filter: gradeFilter(chapter.grade),
          objectPosition: chapter.focus
        };
        return (
          <article className="showcaseStatic" key={chapter.title}>
            <picture>
              <source media="(max-width: 767px)" srcSet={showcaseFrameSrc(chapter.image, true)} />
              <img
                className="showcaseImage"
                src={showcaseFrameSrc(chapter.image, false)}
                alt=""
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                style={style}
              />
            </picture>
            <div className="showcaseText">
              <p className="showcaseKicker">{chapter.kicker}</p>
              {index === 0
                ? <h1 className="showcaseTitle">{chapter.title}</h1>
                : <h2 className="showcaseTitle">{chapter.title}</h2>}
              <p className="showcaseCopy">{chapter.copy}</p>
              {"cta" in chapter ? (
                <p className="showcaseCta"><a className="showcaseButton" href="#book-venue">{chapter.cta}</a></p>
              ) : null}
            </div>
          </article>
        );
      })}

      <nav className="showcaseRail" ref={railRef} aria-label="Walkthrough chapters">
        {showcaseChapters.map((chapter) => (
          <button key={chapter.title} type="button" aria-current="false">
            <span>{chapter.kicker}</span><i aria-hidden="true" />
          </button>
        ))}
      </nav>
    </section>
  );
}
