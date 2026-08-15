import { stripe } from "../../../src/lib/stripe";

export async function POST(request: Request) {
  const body = await request.json();
  const charge = await stripe.paymentIntents.create({
    amount: body.amount,
    currency: "usd",
  });
  return Response.json({ id: charge.id });
}
