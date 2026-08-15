import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function POST(request: Request) {
  const store = await cookies();
  const session = store.get("session");
  const url = new URL(request.url);

  if (!session) {
    redirect(url.searchParams.get("next") ?? "/login");
  }

  return Response.json({ ok: true });
}
