import Stripe from "stripe";

export const stripe = new Stripe(process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

export const timeout = Number(process.env.API_TIMEOUT);
export const missingOne = process.env.SENDGRID_API_KEY;
