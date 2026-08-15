export async function POST(request: Request) {
  const event = await request.json();

  if (event.type === "checkout.session.completed") {
    await fulfillOrder(event.data.object.id);
  }

  return new Response("ok");
}

async function fulfillOrder(id: string) {
  return id;
}
