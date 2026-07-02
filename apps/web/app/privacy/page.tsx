import type { Metadata } from "next";
import { siteConfig } from "@skyla/config";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Sky LA collects, uses, stores, and protects guest, booking, payment, and inquiry information."
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="June 17, 2026"
      intro={
        <p>
          Skyla Los Angeles, also called Skyla, we, us, or our in this policy,
          is located at 6100 Wilshire Blvd, Los Angeles, CA, and respects your
          privacy. This policy explains what information we collect when you
          visit our website or book a ticket, how we use it, and the choices you
          have.
        </p>
      }
      sections={[
        {
          title: "Information We Collect",
          items: [
            <>
              <strong>Booking details</strong> such as your name, email address,
              visit date and time, package selection, and guest count.
            </>,
            <>
              <strong>Payment information</strong> processed securely by{" "}
              <strong>Stripe</strong>. We never see, handle, or store your full
              card number; Stripe processes it directly on its PCI-compliant
              systems.
            </>,
            <>
              <strong>Membership and inquiry details</strong> if you apply for
              membership or request a reservation.
            </>,
            <>
              <strong>Technical data</strong> such as basic device and browser
              information used to keep the site working reliably.
            </>
          ]
        },
        {
          title: "How We Use Your Information",
          items: [
            "To process your booking and send confirmation, ticket, and check-in details.",
            "To verify your reservation at the front desk on the day of your visit.",
            "To respond to membership applications and reservation inquiries.",
            "To operate, secure, and improve our website and services."
          ]
        },
        {
          title: "How Your Information Is Stored",
          body: (
            <>
              <p>
                The Next.js booking, staff, POS, and application workflows are
                designed to store canonical business data in <strong>Convex</strong>.
                Some legacy compatibility pages may remain during the migration
                and are kept only until their Convex-backed replacements are
                accepted.
              </p>
              <p>
                Confirmation emails may be delivered through the configured
                email provider for Skyla. These providers process data on our
                behalf under their own security and privacy commitments.
              </p>
            </>
          )
        },
        {
          title: "Sharing Your Information",
          body: (
            <p>
              We do not sell your personal information. We share it only with
              service providers needed to run our service, such as Stripe for
              payments, Convex for data storage, email providers for
              confirmations, or where required by law.
            </p>
          )
        },
        {
          title: "Your Choices",
          items: [
            <>
              You may request access to, correction of, or deletion of your
              personal information by emailing us at{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
            </>,
            "Transactional emails, such as booking confirmations, are necessary to provide the service you requested; promotional emails, if any, will include an unsubscribe option."
          ]
        },
        {
          title: "Children's Privacy",
          body: (
            <p>
              Our site is intended for adults booking visits, which may include
              children as guests. We do not knowingly collect personal
              information directly from children.
            </p>
          )
        },
        {
          title: "Changes To This Policy",
          body: (
            <p>
              We may update this policy from time to time. The last updated date
              above reflects the most recent revision.
            </p>
          )
        },
        {
          title: "Contact Us",
          body: (
            <p>
              Questions about this policy or your data? Email us at{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
            </p>
          )
        }
      ]}
    />
  );
}
