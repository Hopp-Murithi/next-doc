import { StaticCard } from "./StaticCard";

export default async function DashboardPage() {
  const res = await fetch("https://api.example.com/stats");
  const stats = await res.json();

  return (
    <main>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
      <StaticCard title="Revenue" body={stats.revenue} />
    </main>
  );
}
