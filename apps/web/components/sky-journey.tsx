"use client";

// Scroll-scrubbed journey film: 600 AVIF frames (300 mobile) painted to a
// pinned canvas, ported from the approved Skydeck LA design. Dependency-free.
// Under prefers-reduced-motion the poster is shown and chapters stack.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "@skyla/ui/icons";
import { siteConfig } from "@skyla/config";

const FRAME_COUNTS = { desktop: 600, mobile: 300 } as const;
const MAX_CACHED_BITMAPS = 240;
const MAX_CONCURRENT_LOADS = 8;
const PRIORITY_FRAME_INTERVAL = 10;
const MOBILE_QUERY = "(max-width: 860px)";
const COARSE_QUERY = "(hover: none) and (pointer: coarse)";
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

type SourceKind = keyof typeof FRAME_COUNTS;

const framePath = (kind: SourceKind, index: number) =>
  `/journey/${kind}/frame-${String(index + 1).padStart(4, "0")}.avif`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function priorityFramesFor(count: number): number[] {
  return [
    ...new Set([
      0,
      ...Array.from({ length: Math.ceil(count / PRIORITY_FRAME_INTERVAL) }, (_, i) =>
        Math.min(i * PRIORITY_FRAME_INTERVAL, count - 1)
      ),
      count - 1
    ])
  ];
}

export function initialFramesFor(
  count: number,
  cacheLimit = MAX_CACHED_BITMAPS
): number[] {
  if (count <= 0 || cacheLimit <= 0) return [];
  const limit = Math.min(count, cacheLimit);
  const frames: number[] = [];
  const included = new Set<number>();

  const add = (index: number) => {
    if (frames.length >= limit || included.has(index)) return;
    included.add(index);
    frames.push(index);
  };

  for (const index of priorityFramesFor(count)) add(index);
  for (let index = 0; index < count && frames.length < limit; index += 1) add(index);
  return frames;
}

export interface JourneyChapter {
  title: string;
  body: string;
}

export function SkyJourney({ chapters }: { chapters: JourneyChapter[] }) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const poster = posterRef.current;
    if (!root || !canvas || !poster) return;
    if (window.matchMedia(REDUCE_QUERY).matches) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const small = window.matchMedia(MOBILE_QUERY);
    const coarse = window.matchMedia(COARSE_QUERY);
    const chapterNodes = [...root.querySelectorAll<HTMLElement>("[data-journey-chapter]")];

    const bitmaps = new Map<number, ImageBitmap>();
    const loading = new Map<number, Promise<void>>();
    const controllers = new Set<AbortController>();
    const unavailable = new Set<number>();
    let destroyed = false;
    let frame = 0;
    let dirty = true;
    let targetFrame = 0;
    let currentFrame = 0;
    let drawnFrame = -1;
    let activeIndex = -1;
    let sourceKind: SourceKind = small.matches || coarse.matches ? "mobile" : "desktop";
    let frameCount: number = FRAME_COUNTS[sourceKind];
    let rootTop = 0;
    let totalScroll = 1;
    let viewportHeight = window.innerHeight;
    let loadQueue: number[] = [];
    let queued = new Set<number>();
    let activeLoads = 0;
    let lastTarget = 0;
    let lastTick = 0;

    const enforceCap = () => {
      while (bitmaps.size > MAX_CACHED_BITMAPS) {
        let evicted = false;
        for (const [index, bitmap] of bitmaps) {
          if (index === drawnFrame || Math.abs(index - targetFrame) <= 4) continue;
          bitmaps.delete(index);
          bitmap.close();
          evicted = true;
          break;
        }
        if (!evicted) {
          const oldest = bitmaps.entries().next().value as [number, ImageBitmap] | undefined;
          if (!oldest) break;
          bitmaps.delete(oldest[0]);
          oldest[1].close();
        }
      }
    };

    const loadFrame = async (index: number) => {
      if (destroyed || bitmaps.has(index) || unavailable.has(index) || loading.has(index)) return;
      const controller = new AbortController();
      controllers.add(controller);
      const request = (async () => {
        try {
          const response = await fetch(framePath(sourceKind, index), { signal: controller.signal });
          if (!response.ok) throw new Error(String(response.status));
          const bitmap = await createImageBitmap(await response.blob());
          if (destroyed || controller.signal.aborted) {
            bitmap.close();
            return;
          }
          bitmaps.set(index, bitmap);
          enforceCap();
          dirty = true;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) unavailable.add(index);
        } finally {
          controllers.delete(controller);
        }
      })();
      loading.set(index, request);
      await request;
      loading.delete(index);
    };

    const pump = () => {
      while (!destroyed && activeLoads < MAX_CONCURRENT_LOADS && loadQueue.length > 0) {
        const index = loadQueue.shift();
        if (index === undefined) break;
        queued.delete(index);
        if (bitmaps.has(index) || loading.has(index) || unavailable.has(index)) continue;
        activeLoads += 1;
        void loadFrame(index).finally(() => {
          activeLoads -= 1;
          pump();
        });
      }
    };

    const queueFrame = (index: number, priority = false) => {
      if (bitmaps.has(index) || loading.has(index) || unavailable.has(index)) return;
      if (queued.has(index)) {
        if (!priority) return;
        loadQueue = loadQueue.filter((i) => i !== index);
      } else {
        queued.add(index);
      }
      if (priority) loadQueue.unshift(index);
      else loadQueue.push(index);
    };

    const queueInitial = () => {
      loadQueue = [];
      queued = new Set();
      for (const index of initialFramesFor(frameCount)) queueFrame(index);
      pump();
    };

    const nearestLoaded = (index: number) => {
      if (bitmaps.has(index)) return index;
      for (let distance = 1; distance < frameCount; distance += 1) {
        if (index - distance >= 0 && bitmaps.has(index - distance)) return index - distance;
        if (index + distance < frameCount && bitmaps.has(index + distance)) return index + distance;
      }
      return -1;
    };

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        drawnFrame = -1;
      }
    };

    const paint = (bitmap: ImageBitmap, alpha: number) => {
      const cw = canvas.width;
      const ch = canvas.height;
      const imageRatio = bitmap.width / bitmap.height;
      const canvasRatio = cw / ch;
      let sw = bitmap.width;
      let sh = bitmap.height;
      let sx = 0;
      let sy = 0;
      if (canvasRatio > imageRatio) {
        sh = bitmap.width / canvasRatio;
        sy = (bitmap.height - sh) / 2;
      } else {
        sw = bitmap.height * canvasRatio;
        sx = (bitmap.width - sw) / 2;
      }
      context.globalAlpha = alpha;
      context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, cw, ch);
    };

    const drawBlended = (position: number) => {
      const lower = clamp(Math.floor(position), 0, frameCount - 1);
      const upper = Math.min(lower + 1, frameCount - 1);
      const fraction = position - lower;
      const base = bitmaps.get(lower) ?? bitmaps.get(nearestLoaded(lower));
      if (!base) return;
      resizeCanvas();
      paint(base, 1);
      const next = upper !== lower && fraction > 0.01 ? bitmaps.get(upper) : undefined;
      if (next) paint(next, fraction);
      context.globalAlpha = 1;
      drawnFrame = position;
      canvas.dataset.painted = "true";
      poster.hidden = true;
    };

    const layout = () => {
      const pageY = window.scrollY || window.pageYOffset;
      rootTop = root.getBoundingClientRect().top + pageY;
      viewportHeight = window.innerHeight;
      totalScroll = Math.max(root.offsetHeight - viewportHeight, 1);
      resizeCanvas();
      dirty = true;
    };

    const updateChapter = () => {
      const probe = viewportHeight * 0.48;
      let next = 0;
      chapterNodes.forEach((node, index) => {
        if (node.getBoundingClientRect().top <= probe) next = index;
      });
      if (next !== activeIndex) {
        activeIndex = next;
        setActive(next);
      }
    };

    const readScroll = () => {
      const pageY = window.scrollY || window.pageYOffset;
      const progress = clamp((pageY - rootTop) / totalScroll, 0, 1);
      targetFrame = progress * (frameCount - 1);
      updateChapter();
      const target = clamp(Math.round(targetFrame), 0, frameCount - 1);
      const direction = target >= lastTarget ? 1 : -1;
      lastTarget = target;
      for (let step = 24; step >= 1; step -= 1) {
        const ahead = target + step * direction;
        if (ahead >= 0 && ahead < frameCount) queueFrame(ahead, true);
      }
      queueFrame(target, true);
      pump();
    };

    const tick = (now: number) => {
      if (destroyed) return;
      if (dirty) {
        dirty = false;
        readScroll();
      }
      const dt = lastTick ? Math.min(now - lastTick, 50) : 16.7;
      lastTick = now;
      const delta = targetFrame - currentFrame;
      if (Math.abs(delta) > 0.01) currentFrame += delta * (1 - Math.pow(0.8, dt / 16.7));
      else currentFrame = targetFrame;
      const position = clamp(currentFrame, 0, frameCount - 1);
      if (Math.abs(position - drawnFrame) > 0.02) drawBlended(position);
      frame = window.requestAnimationFrame(tick);
    };

    const onScroll = () => {
      dirty = true;
    };
    const onResize = () => {
      const nextKind: SourceKind = small.matches || coarse.matches ? "mobile" : "desktop";
      if (nextKind !== sourceKind) {
        sourceKind = nextKind;
        frameCount = FRAME_COUNTS[sourceKind];
        for (const controller of controllers) controller.abort();
        for (const bitmap of bitmaps.values()) bitmap.close();
        bitmaps.clear();
        unavailable.clear();
        loading.clear();
        loadQueue = [];
        queued.clear();
        drawnFrame = -1;
        canvas.dataset.painted = "false";
        poster.hidden = false;
        queueInitial();
      }
      layout();
    };

    canvas.dataset.painted = "false";
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    layout();
    queueInitial();
    frame = window.requestAnimationFrame(tick);

    return () => {
      destroyed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      for (const controller of controllers) controller.abort();
      for (const bitmap of bitmaps.values()) bitmap.close();
      bitmaps.clear();
    };
  }, []);

  return (
    <section className="skyJourney" ref={rootRef}>
      <div className="skyJourney__stage">
        <img
          alt=""
          aria-hidden="true"
          className="skyJourney__poster"
          fetchPriority="high"
          ref={posterRef}
          src="/journey/poster.jpg"
        />
        <canvas aria-hidden="true" className="skyJourney__canvas" ref={canvasRef} />
        <div aria-hidden="true" className="skyJourney__shade" />
      </div>
      <div className="skyJourney__chapters">
        {chapters.map((chapter, index) => {
          const Heading = index === 0 ? "h1" : "h2";
          return (
            <article
              className={`skyJourney__chapter${index === active ? " is-active" : ""}`}
              data-journey-chapter=""
              key={chapter.title}
            >
              <div className="skyJourney__copy">
                <Heading>{chapter.title}</Heading>
                <p>{chapter.body}</p>
                {index === 0 ? (
                  <div className="skyJourney__ticket">
                    <span className="skyJourney__price">$20</span>
                    <span className="skyJourney__priceMeta">
                      {siteConfig.launched
                        ? "all-in, per adult"
                        : "planned launch pricing, per adult"}
                      <em>Ages 12 and under $10</em>
                    </span>
                    {siteConfig.launched ? (
                      <Link className="primaryAction skyCta" href="/checkout" prefetch={false}>
                        Buy Tickets
                        <ArrowRight size={18} />
                      </Link>
                    ) : (
                      <a className="primaryAction skyCta" href={`mailto:${siteConfig.email}`}>
                        Ask about opening
                        <ArrowRight size={18} />
                      </a>
                    )}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
