"use client";

// The brand as a lit sign: champagne-gradient letters with a 3D extrusion,
// spelling themselves out as the footer arrives. Decorative only.
import { motion, useReducedMotion } from "motion/react";

export function SkyFooterSign() {
  const reduceMotion = useReducedMotion();

  return (
    <p aria-hidden="true" className="skySign">
      {"SKY LA".split("").map((letter, index) => (
        <motion.span
          className="skySign__letter"
          initial={reduceMotion ? false : { opacity: 0, rotateX: 58, y: 44 }}
          key={index}
          transition={{ delay: index * 0.08, duration: 0.75, ease: [0.2, 0.8, 0.2, 1] }}
          viewport={{ amount: 0.5, once: true }}
          whileInView={{ opacity: 1, rotateX: 0, y: 0 }}
        >
          {letter === " " ? "\u00A0" : letter}
        </motion.span>
      ))}
    </p>
  );
}
