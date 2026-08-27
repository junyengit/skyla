"use client";

// The day-to-night film with facts cycling on their own timer. Facts are
// real: operating summary from admin config, live sunset computed for the
// venue coordinates, and the real address.
import { useEffect, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

function subscribeReducedMotion(onChange: () => void) {
  const query = reducedMotionQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getReducedMotion = () => reducedMotionQuery().matches;
import * as SunCalc from "suncalc";
import { siteConfig } from "@skyla/config";

const FACT_INTERVAL_MS = 4000;

export function SkyStageFilm({ hoursLine }: { hoursLine: string | null }) {
  const [sunset, setSunset] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const reduced = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);

  useEffect(() => {
    const compute = () => {
      const times = SunCalc.getTimes(new Date(), 34.0625, -118.3524);
      setSunset(
        times.sunset.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Los_Angeles"
        })
      );
    };
    const initial = window.setTimeout(compute, 0);
    const timer = window.setInterval(compute, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  const facts: Array<{ value: string; caption: string }> = [
    hoursLine
      ? { value: hoursLine, caption: "Timed entry, choose your window" }
      : { value: siteConfig.launchStatus.label, caption: "Hours announced before launch" },
    {
      value: sunset ? sunset : "Every evening",
      caption: "Tonight's sunset over the basin"
    },
    { value: "Museum Row", caption: siteConfig.address.full }
  ];

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(
      () => setActive((index) => (index + 1) % facts.length),
      FACT_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [reduced, facts.length]);

  return (
    <section aria-label="The deck from day to night" className="skyStage">
      <video
        aria-hidden="true"
        autoPlay
        className="skyStage__film"
        disablePictureInPicture
        loop
        muted
        playsInline
        poster="/film/daynight-poster.webp"
        preload="metadata"
      >
        <source media="(max-width: 860px)" src="/film/daynight-mobile.mp4" type="video/mp4" />
        <source src="/film/daynight.mp4" type="video/mp4" />
      </video>
      <div aria-hidden="true" className="skyStage__shade" />
      <div className={`skyStage__facts${reduced ? " is-static" : ""}`}>
        {facts.map((fact, index) => (
          <div
            className={`skyStage__fact${index === active ? " is-active" : ""}`}
            key={fact.caption}
          >
            <p className="skyStage__value">{fact.value}</p>
            <p className="skyStage__caption">{fact.caption}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
