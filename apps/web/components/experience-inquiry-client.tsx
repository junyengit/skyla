"use client";

import { FormEvent, useState } from "react";
import { siteConfig } from "@skyla/config";
import { ArrowRight, ShieldCheck } from "@skyla/ui/icons";

type InquiryExperience =
  | "date-night"
  | "champagne-caviar"
  | "family-suite"
  | "champagne-room"
  | "private-events"
  | "other";

type InquiryState = {
  firstName: string;
  lastName: string;
  email: string;
  experience: InquiryExperience | "";
  eventDate: string;
  guestCount: string;
  notes: string;
};

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; email: string; experience: string }
  | { kind: "error"; message: string; code?: string };

type ExperienceInquiryResponse = {
  inquiry?: {
    inquiryId: string;
    emailLower: string;
    experience: InquiryExperience;
    eventDate: string;
    guestCount: string;
    status: "pending";
    replayed: boolean;
  };
  error?: string;
  code?: string;
};

const experienceOptions: Array<{ value: InquiryExperience; label: string }> = [
  { value: "date-night", label: "Date Night Experience" },
  { value: "champagne-caviar", label: "Champagne and Caviar Service" },
  { value: "family-suite", label: "Family Suite" },
  { value: "champagne-room", label: "Champagne Room" },
  { value: "private-events", label: "Private Event or Buyout" },
  { value: "other", label: "Other / Custom" }
];

const guestOptions = ["2", "3", "4", "5", "6", "7", "8", "9-12", "13+"];

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `inquiry_${crypto.randomUUID()}`;
  }
  return `inquiry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function labelForExperience(value: InquiryExperience) {
  return experienceOptions.find((option) => option.value === value)?.label ?? "Private Experience";
}

function trackLead(experience: InquiryExperience) {
  const maybeWindow = window as typeof window & {
    SkylaAds?: {
      trackLead?: (category: string, data?: Record<string, unknown>) => void;
    };
    fbq?: (event: "track", name: string, data?: Record<string, unknown>) => void;
  };

  try {
    maybeWindow.SkylaAds?.trackLead?.("event", { value: 250 });
  } catch {
    // Tracking is non-critical; the server-accepted inquiry is the source of truth.
  }

  try {
    maybeWindow.fbq?.("track", "Lead", { content_name: labelForExperience(experience) });
  } catch {
    // Tracking is non-critical; the server-accepted inquiry is the source of truth.
  }
}

export function ExperienceInquiryClient() {
  const [form, setForm] = useState<InquiryState>({
    firstName: "",
    lastName: "",
    email: "",
    experience: "",
    eventDate: "",
    guestCount: "2",
    notes: ""
  });
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });

  function updateField<Key extends keyof InquiryState>(key: Key, value: InquiryState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") {
      setStatus({ kind: "idle" });
    }
  }

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.experience) {
      setStatus({ kind: "error", message: "Please choose an experience." });
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const response = await fetch("/api/experiences/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          notes: form.notes || undefined,
          source: "native-experiences",
          idempotencyKey
        })
      });
      const data = (await response.json()) as ExperienceInquiryResponse;

      if (!response.ok || !data.inquiry) {
        throw new Error(
          response.status >= 500 ||
            data.code === "convex_unconfigured" ||
            data.code === "public_gateway_unconfigured"
            ? `Experience requests are temporarily unavailable. Please email ${siteConfig.email} and the team will follow up.`
            : data.error ?? "Could not submit this inquiry"
        );
      }

      trackLead(form.experience);
      setStatus({
        kind: "success",
        email: form.email.trim(),
        experience: labelForExperience(form.experience)
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not submit this inquiry"
      });
    }
  }

  function startAnother() {
    setForm({
      firstName: "",
      lastName: "",
      email: "",
      experience: "",
      eventDate: "",
      guestCount: "2",
      notes: ""
    });
    setIdempotencyKey(createIdempotencyKey());
    setStatus({ kind: "idle" });
  }

  if (status.kind === "success") {
    return (
      <div className="experienceSuccess" role="status">
        <div className="memberSuccessIcon">
          <ShieldCheck size={30} />
        </div>
        <p className="sectionLabel">Request received</p>
        <h2>{status.experience}</h2>
        <p>
          Your inquiry was accepted for review. The events team will reply at{" "}
          <strong>{status.email}</strong> within 24 hours.
        </p>
        <button className="secondaryAction" type="button" onClick={startAnother}>
          Start another inquiry
        </button>
      </div>
    );
  }

  return (
    <form className="experienceInquiryForm" onSubmit={submitInquiry}>
      <div className="memberFormGrid">
        <label>
          <span>First name</span>
          <input
            autoComplete="given-name"
            maxLength={80}
            placeholder="Jane"
            required
            type="text"
            value={form.firstName}
            onChange={(event) => updateField("firstName", event.target.value)}
          />
        </label>
        <label>
          <span>Last name</span>
          <input
            autoComplete="family-name"
            maxLength={80}
            placeholder="Smith"
            required
            type="text"
            value={form.lastName}
            onChange={(event) => updateField("lastName", event.target.value)}
          />
        </label>
      </div>

      <label>
        <span>Email address</span>
        <input
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder="jane@example.com"
          required
          type="email"
          value={form.email}
          onChange={(event) => updateField("email", event.target.value)}
        />
      </label>

      <div className="memberFormGrid">
        <label>
          <span>Experience</span>
          <select
            required
            value={form.experience}
            onChange={(event) => updateField("experience", event.target.value as InquiryExperience)}
          >
            <option value="">Select an experience</option>
            {experienceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Preferred date</span>
          <input
            required
            type="date"
            value={form.eventDate}
            onChange={(event) => updateField("eventDate", event.target.value)}
          />
        </label>
      </div>

      <label>
        <span>Number of guests</span>
        <select value={form.guestCount} onChange={(event) => updateField("guestCount", event.target.value)}>
          {guestOptions.map((guests) => (
            <option key={guests} value={guests}>
              {guests}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Special requests or notes</span>
        <textarea
          maxLength={2000}
          placeholder="Allergies, special occasions, timing preferences..."
          value={form.notes}
          onChange={(event) => updateField("notes", event.target.value)}
        />
      </label>

      {status.kind === "error" ? <p className="memberFormError">{status.message}</p> : null}

      <button className="primaryAction memberSubmitButton" disabled={status.kind === "submitting"} type="submit">
        {status.kind === "submitting" ? "Sending" : "Request event details"}
        <ArrowRight size={18} />
      </button>

      <p className="memberFormNote">
        For immediate help, email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
      </p>
    </form>
  );
}
