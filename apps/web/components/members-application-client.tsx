"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, ShieldCheck } from "@skyla/ui/icons";

type MemberTier = "obsidian" | "gold" | "black";

type ApplicationState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  tier: MemberTier;
  source: string;
  bio: string;
};

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; name: string; email: string }
  | { kind: "error"; message: string; code?: string };

type MemberApplicationResponse = {
  member?: {
    memberId: string;
    emailLower: string;
    tier: MemberTier;
    status: "pending";
    replayed: boolean;
  };
  error?: string;
  code?: string;
};

const sourceOptions = [
  "Referred by a current member",
  "Visited Sky LA as a guest",
  "Social media",
  "Press / publication",
  "Word of mouth",
  "Other"
];

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `member_${crypto.randomUUID()}`;
  }
  return `member_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function trackingValue(tier: MemberTier) {
  if (tier === "gold") return 500;
  if (tier === "obsidian") return 250;
  return 1000;
}

function trackLead(tier: MemberTier) {
  const maybeWindow = window as typeof window & {
    SkylaAds?: {
      trackLead?: (category: string, data?: Record<string, unknown>) => void;
    };
    fbq?: (event: "track", name: string, data?: Record<string, unknown>) => void;
  };

  try {
    maybeWindow.SkylaAds?.trackLead?.("membership", { value: trackingValue(tier) });
  } catch {
    // Tracking is non-critical; the application acceptance result is the source of truth.
  }

  try {
    maybeWindow.fbq?.("track", "Lead", { content_name: `Membership Application: ${tier}` });
  } catch {
    // Tracking is non-critical; the application acceptance result is the source of truth.
  }
}

export function MembersApplicationClient() {
  const [form, setForm] = useState<ApplicationState>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    tier: "gold",
    source: "",
    bio: ""
  });
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });

  function updateField<Key extends keyof ApplicationState>(key: Key, value: ApplicationState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") {
      setStatus({ kind: "idle" });
    }
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "submitting" });

    try {
      const response = await fetch("/api/members/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          phone: form.phone || undefined,
          source: form.source || undefined,
          bio: form.bio || undefined,
          idempotencyKey
        })
      });
      const data = (await response.json()) as MemberApplicationResponse;

      if (!response.ok || !data.member) {
        throw new Error(
          data.code === "convex_unconfigured"
            ? "Membership applications are temporarily paused while the secure database is connected. Please email reservations@skydeckla.com and we will follow up manually."
            : data.error ?? "Could not submit this application"
        );
      }

      trackLead(form.tier);
      setStatus({
        kind: "success",
        name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        email: form.email.trim()
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not submit this application"
      });
    }
  }

  function startAnother() {
    setForm({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      tier: "gold",
      source: "",
      bio: ""
    });
    setIdempotencyKey(createIdempotencyKey());
    setStatus({ kind: "idle" });
  }

  if (status.kind === "success") {
    return (
      <div className="memberSuccess" role="status">
        <div className="memberSuccessIcon">
          <ShieldCheck size={30} />
        </div>
        <p className="sectionLabel">Application received</p>
        <h2>Thank you, {status.name}.</h2>
        <p>
          Your application was accepted for review. The membership team will
          reply at <strong>{status.email}</strong> within 5 business days.
        </p>
        <button className="secondaryAction" type="button" onClick={startAnother}>
          Start another application
        </button>
      </div>
    );
  }

  return (
    <form className="memberApplicationForm" onSubmit={submitApplication}>
      <div className="memberFormGrid">
        <label>
          <span>First name</span>
          <input
            autoComplete="given-name"
            maxLength={80}
            placeholder="James"
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
            placeholder="Monroe"
            required
            type="text"
            value={form.lastName}
            onChange={(event) => updateField("lastName", event.target.value)}
          />
        </label>
      </div>

      <div className="memberFormGrid">
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            placeholder="james@example.com"
            required
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            autoComplete="tel"
            maxLength={40}
            placeholder="+1 (310) 000-0000"
            type="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
          />
        </label>
      </div>

      <fieldset className="memberTierSelect">
        <legend>Membership tier interest</legend>
        {([
          ["obsidian", "Obsidian", "from $250/mo"],
          ["gold", "Gold", "from $500/mo"],
          ["black", "Black Card", "by invitation"]
        ] as Array<[MemberTier, string, string]>).map(([tier, label, price]) => (
          <label className={form.tier === tier ? "isSelected" : ""} key={tier}>
            <input
              checked={form.tier === tier}
              name="tier"
              type="radio"
              value={tier}
              onChange={() => updateField("tier", tier)}
            />
            <span className={`memberTierGem memberTierGem-${tier}`} />
            <strong>{label}</strong>
            <em>{price}</em>
          </label>
        ))}
      </fieldset>

      <label>
        <span>How did you hear about Sky LA Members?</span>
        <select value={form.source} onChange={(event) => updateField("source", event.target.value)}>
          <option value="">Select one</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Tell us about yourself</span>
        <textarea
          maxLength={2000}
          placeholder="Why you are interested in membership, how you would use the space, or anything you would like the committee to know..."
          rows={5}
          value={form.bio}
          onChange={(event) => updateField("bio", event.target.value)}
        />
      </label>

      <p className="memberFormNote">
        Submitting an application does not guarantee membership. Applications
        are reviewed personally and kept confidential.
      </p>

      {status.kind === "error" ? <p className="memberFormError">{status.message}</p> : null}

      <button className="primaryAction memberSubmitButton" type="submit" disabled={status.kind === "submitting"}>
        {status.kind === "submitting" ? "Submitting..." : "Submit Application"}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
