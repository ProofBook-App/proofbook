import type { Role, WaitlistResult } from "../components/waitlist-form";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NOTE_MAX = 1000;

// Shared route action for every waitlist form on the site.
export async function joinWaitlist(request: Request, db: D1Database): Promise<WaitlistResult> {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role: Role = form.get("role") === "builder" ? "builder" : "backer";
  const note = String(form.get("note") ?? "").trim().slice(0, NOTE_MAX) || null;

  // Bots fill the hidden field; tell them it worked and store nothing.
  if (form.get("company")) return { ok: true, email, role };
  if (!EMAIL.test(email) || email.length > 254) {
    return { ok: false, error: "Enter a full email address, like name@example.com." };
  }
  try {
    await db
      .prepare(
        `INSERT INTO waitlist (email, role, note) VALUES (?1, ?2, ?3)
         ON CONFLICT(email) DO UPDATE SET note = COALESCE(excluded.note, waitlist.note)`,
      )
      .bind(email, role, note)
      .run();
  } catch {
    return { ok: false, error: "We couldn't save that just now. Try again in a minute." };
  }
  return { ok: true, email, role };
}
