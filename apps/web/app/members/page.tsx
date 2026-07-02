import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { ArrowLink, PublicHero, PublicPageShell } from "@/components/public-page-shell";
import { MembersApplicationClient } from "@/components/members-application-client";

export const metadata: Metadata = {
  title: "Members",
  description:
    "Apply for Sky LA membership, including Obsidian, Gold, and Black Card access above 6100 Wilshire."
};

const stats = [
  ["200", "Member limit", "Strictly capped with a waitlist after capacity."],
  ["3", "Access tiers", "Obsidian, Gold, and Black Card membership paths."],
  ["6100", "Wilshire address", "One Los Angeles location above Miracle Mile."],
  ["24/7", "Concierge", "Available for Black Card members."]
];

const tiers = [
  {
    name: "Obsidian",
    price: "From $250 / month",
    accent: "obsidian",
    perks: [
      "Unlimited observation deck access",
      "Private member lounge access",
      "Priority reservations with advance notice",
      "2 guest passes per month",
      "10% cafe and bar discount",
      "Members-only event invitations"
    ]
  },
  {
    name: "Gold",
    price: "From $500 / month",
    accent: "gold",
    badge: "Most requested",
    perks: [
      "Everything in Obsidian",
      "Cigar lounge access",
      "Private members bar menu",
      "6 guest passes per month",
      "20% cafe and bar discount",
      "$75 monthly champagne credit",
      "Early access to exclusive events"
    ]
  },
  {
    name: "Black Card",
    price: "By invitation",
    accent: "black",
    perks: [
      "Everything in Gold",
      "Complimentary monthly champagne room",
      "Dedicated personal host",
      "Unlimited guest passes",
      "30% cafe and bar discount",
      "Private founding member dinners",
      "Direct concierge line"
    ]
  }
];

const spaces = [
  {
    eyebrow: "Private access",
    title: "The Private Lounge",
    image: "/images/hero-lounge.jpg",
    imageAlt: "Sky LA private lounge seating",
    copy: "A calm member-only room above Wilshire with reserved seating, table service, and window positions held away from the public flow.",
    access: ["Obsidian", "Gold", "Black Card"]
  },
  {
    eyebrow: "Gold and Black Card",
    title: "The Cigar Lounge",
    image: "/images/private-room.jpg",
    imageAlt: "Sky LA private room",
    copy: "A quieter room for cigars, aged spirits, and conversations that should not compete with the observation deck.",
    access: ["Gold", "Black Card"]
  },
  {
    eyebrow: "Exclusive service",
    title: "The Members Bar",
    image: "/images/bar.jpg",
    imageAlt: "Sky LA bar",
    copy: "A private bar program with a tighter menu, senior bartender service, and bottle allocations for the highest tier.",
    access: ["Gold", "Black Card"]
  }
];

const privileges = [
  "Private lounge seating",
  "Cigar and cognac room",
  "Members bar access",
  "Unlimited deck visits",
  "Guest-pass allocation",
  "Monthly champagne credit",
  "Exclusive event previews",
  "Personal host options"
];

export default function MembersPage() {
  return (
    <PublicPageShell active="members">
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','27223205867364422');fbq('track','PageView');`}
      </Script>
      <Script src="/ads-config.js" strategy="afterInteractive" />
      <Script src="/ads-tracking.js?v=1" strategy="afterInteractive" />

      <PublicHero
        eyebrow="By application only"
        title={
          <>
            Sky LA
            <span>Members</span>
          </>
        }
        copy="A quieter circle above the city, with private rooms, reserved access, and a membership path reviewed by the Sky LA team."
        image="/images/checkin-desk.jpg"
        imageAlt="Sky LA reception desk"
        actions={<ArrowLink href="#apply">Apply for Membership</ArrowLink>}
      />

      <section className="memberStats" aria-label="Membership highlights">
        {stats.map(([value, label, copy]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
            <p>{copy}</p>
          </div>
        ))}
      </section>

      <section className="publicIntro memberIntro">
        <div>
          <p className="sectionLabel">Membership</p>
          <h2>Not a larger crowd. A more deliberate one.</h2>
        </div>
        <p>
          Sky LA membership is designed for guests who return often, host
          carefully, and want a calmer path through the building. Applications
          now flow through the server API instead of the legacy browser storage
          path.
        </p>
      </section>

      <section className="memberTierSection" id="tiers">
        <div className="publicBandHeader">
          <p className="sectionLabel">Membership tiers</p>
          <h2>Choose the access level that fits the way you visit.</h2>
          <p>Each accepted membership is reviewed annually.</p>
        </div>
        <div className="memberTierGrid">
          {tiers.map((tier) => (
            <article className={`memberTierCard memberTierCard-${tier.accent}`} key={tier.name}>
              {tier.badge ? <span className="memberTierBadge">{tier.badge}</span> : null}
              <div className="memberTierHeader">
                <span className={`memberTierGem memberTierGem-${tier.accent}`} />
                <h3>{tier.name}</h3>
              </div>
              <strong>{tier.price}</strong>
              <ul>
                {tier.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
              <Link className="secondaryAction" href="#apply" prefetch={false}>
                Apply
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="memberSpaces" aria-label="Member spaces">
        {spaces.map((space, index) => (
          <article className={index % 2 === 1 ? "memberSpace isReverse" : "memberSpace"} key={space.title}>
            <div className="memberSpaceMedia">
              <Image src={space.image} alt={space.imageAlt} fill sizes="(max-width: 900px) 100vw, 50vw" />
            </div>
            <div className="memberSpaceCopy">
              <p className="sectionLabel">{space.eyebrow}</p>
              <h2>{space.title}</h2>
              <p>{space.copy}</p>
              <div className="publicPillList">
                {space.access.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="publicCardBand memberPrivileges">
        <div className="publicBandHeader">
          <p className="sectionLabel">Privileges</p>
          <h2>Membership is built around repeated visits.</h2>
        </div>
        <div className="publicCardGrid">
          {privileges.map((privilege) => (
            <article key={privilege}>
              <p>{privilege}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="memberApply" id="apply">
        <div className="publicBandHeader">
          <p className="sectionLabel">Apply for membership</p>
          <h2>Begin your application.</h2>
          <p>
            Applications are reviewed by the membership team. The form only
            confirms success after the server accepts the application.
          </p>
        </div>
        <MembersApplicationClient />
      </section>
    </PublicPageShell>
  );
}
