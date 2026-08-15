"use client";

export function StaticCard({ title, body }: { title: string; body: string }) {
  return (
    <article>
      <h2>{title}</h2>
      <p>{body}</p>
      <img src="/hero.png" alt="" />
    </article>
  );
}
