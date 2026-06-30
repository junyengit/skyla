import { createCheckoutOrderDraft } from "@skyla/payments";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const draft = createCheckoutOrderDraft(input);

    return Response.json({ draft });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create checkout order draft" },
      { status: 400 }
    );
  }
}
