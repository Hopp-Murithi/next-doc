const base = import.meta.env.VITE_API_URL;
const key = import.meta.env.VITE_SENDGRID_API_KEY;
const missing = import.meta.env.VITE_FEATURE_FLAGS;

export async function fetchOrders() {
  const res = await fetch(`${base}/orders`, { headers: { authorization: `Bearer ${key}` } });
  return res.json();
}

export const flags = missing;
