import { useEffect, useState } from "react";
import { fetchOrders } from "./lib/orders";

export default function App() {
  const [orders, setOrders] = useState<unknown[]>([]);

  useEffect(() => {
    fetchOrders().then(setOrders);
  }, []);

  return (
    <main>
      <img src="/logo.png" alt="logo" />
      <p>{orders.length} orders</p>
    </main>
  );
}
