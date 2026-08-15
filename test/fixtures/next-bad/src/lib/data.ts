import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function getProfile(id: string) {
  const result = await pool.query("select * from profiles where id = $1", [id]);
  return result.rows[0];
}
