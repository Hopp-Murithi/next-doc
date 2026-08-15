import Image from "next/image";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export default async function HomePage() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/stats`, {
    next: { revalidate: 60 },
  });
  const stats = await res.json();

  return (
    <main className={inter.className}>
      <Image src="/hero.png" alt="" width={640} height={480} />
      <p>{stats.total}</p>
    </main>
  );
}
