import type { Metadata } from "next";
import { currentTermsVersion } from "@skyla/payments";
import { siteConfig } from "@skyla/config";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms for using Sky LA's website, booking tickets, payment processing, venue access, and guest conduct."
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="August 6, 2026"
      intro={
        <>
          <p>
            <strong>Pre-launch attorney-review draft.</strong> These purchase
            terms are not effective and ticket sales remain unavailable until
            venue counsel approves the final version.
          </p>
          <p>Document version: {currentTermsVersion}</p>
          <p>
            When ticket sales open, checking the separate Terms box and
            completing a purchase will mean you agree to the version displayed
            at checkout. Please read it carefully.
          </p>
        </>
      }
      sections={[
        {
          title: "Tickets And Bookings",
          items: [
            "All tickets are for a specific date and timed entry. Please arrive within 30 minutes of your selected entry window.",
            "Your booking confirmation and check-in QR code are sent to the email address you provide. Present them on your phone or printed at the front desk.",
            "Prices are listed in U.S. dollars. The total displayed before purchase includes all mandatory charges imposed by Sky LA; Sky LA currently adds no mandatory booking fee.",
            "Premium experiences and private rooms may carry additional terms, minimums, or fees disclosed at the time of booking."
          ]
        },
        {
          title: "Payments",
          body: (
            <p>
              Payments are processed securely by <strong>Stripe</strong>. By
              completing a purchase, you authorize the charge for your selected
              tickets, packages, and applicable fees.
            </p>
          )
        },
        {
          title: "Refunds And Changes",
          items: [
            "Tickets are valid only for the date and time booked. If you need to change your visit, contact us in advance and we will accommodate where possible.",
            "Refund eligibility, including for weather or closures, is handled on a case-by-case basis. Please reach out to us directly."
          ]
        },
        {
          title: "Conduct And Safety",
          items: [
            "Guests must follow all posted rules and the directions of Skyla staff. We may refuse entry or remove anyone for unsafe or disruptive behavior without refund.",
            "Alcohol service requires valid ID and a valid Skyla ticket. We reserve the right to refuse service.",
            "Children must be supervised by an adult at all times."
          ]
        },
        {
          title: "The Venue",
          body: (
            <p>
              Access to outdoor decks, specific views, and amenities may vary
              due to weather, maintenance, private events, or capacity. Views
              described on our site reflect typical conditions and are not
              guaranteed on any given day.
            </p>
          )
        },
        {
          title: "Intellectual Property",
          body: (
            <p>
              All content on this website, including text, photography, and
              branding, is the property of Skyla Los Angeles and may not be
              reproduced without permission.
            </p>
          )
        },
        {
          title: "Limitation Of Liability",
          body: (
            <p>
              To the fullest extent permitted by law, Skyla is not liable for
              indirect or incidental damages arising from your use of the website
              or your visit. Your visit is at your own risk, subject to
              applicable law.
            </p>
          )
        },
        {
          title: "Changes To These Terms",
          body: (
            <p>
              We may update these Terms from time to time. Continued use of the
              site or services constitutes acceptance of the current version.
            </p>
          )
        },
        {
          title: "Contact Us",
          body: (
            <p>
              Questions about these Terms? Email us at{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
            </p>
          )
        }
      ]}
    />
  );
}
