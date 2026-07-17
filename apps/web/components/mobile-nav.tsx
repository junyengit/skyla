"use client";

import Link from "next/link";
import { useState } from "react";

export type MobileNavItem = {
  label: string;
  href: string;
  current?: boolean;
};

export function MobileNav({ items }: { items: MobileNavItem[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="mobileNav">
      <button
        type="button"
        className="mobileNavToggle"
        aria-expanded={open}
        aria-controls="mobile-nav-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="srOnly">{open ? "Close menu" : "Open menu"}</span>
        <span className={open ? "mobileNavIcon mobileNavIconOpen" : "mobileNavIcon"} aria-hidden="true" />
      </button>
      {open ? (
        <nav id="mobile-nav-menu" className="mobileNavMenu" aria-label="Mobile navigation">
          {items.map((item) =>
            item.href.startsWith("#") ? (
              <a key={item.href} href={item.href} onClick={close}>
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={item.current ? "page" : undefined}
                onClick={close}
              >
                {item.label}
              </Link>
            )
          )}
          <Link className="navCta" href="/checkout" prefetch={false} onClick={close}>
            Buy Tickets
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
