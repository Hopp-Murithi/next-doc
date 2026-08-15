"use client";

import { useState } from "react";
import { getProfile } from "../../src/lib/data";

export function ProfileForm({ id }: { id: string }) {
  const [name, setName] = useState("");

  async function load() {
    const profile = await getProfile(id);
    setName(profile.name);
  }

  return (
    <form>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <button type="button" onClick={load}>
        Load
      </button>
    </form>
  );
}
