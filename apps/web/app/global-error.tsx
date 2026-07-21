"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-reporting";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// Root-layout error boundary. It replaces the entire document, so global CSS
// is unavailable and styling must be inline; it mirrors the site theme with
// customer-safe copy only.
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    reportClientError(error, "global-error-boundary");
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#ffffff",
          color: "#111111",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px"
        }}
      >
        <div>
          <h1 style={{ fontWeight: 500, fontSize: "1.6rem" }}>Sky LA is briefly unavailable.</h1>
          <p style={{ lineHeight: 1.5 }}>
            Please try again. If it keeps happening, email reservations@skydeckla.com and we will
            help with your visit.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "18px",
              padding: "12px 24px",
              borderRadius: "2px",
              border: "1px solid #111111",
              background: "#111111",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: "1rem"
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
