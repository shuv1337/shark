import { runMigrations } from "../src/server/db/migrate";
import { offboardUserByEmail } from "../src/server/lib/offboarding";

const email = process.env.OFFBOARD_EMAIL?.trim();
if (!email) {
  throw new Error("Set OFFBOARD_EMAIL to the exact Apple email being removed.");
}

runMigrations();
const result = await offboardUserByEmail(email);
console.log(JSON.stringify({ ok: true, revoked: result }));
