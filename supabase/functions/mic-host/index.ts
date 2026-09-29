import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// MicQue host + manager controller. Powered by LiveQue.
// The ONLY path that can move an open-mic lineup or edit the room. Anon clients can read
// the list and sign up; every host/manager action lands here, gated by a server-side token
// (MIC_HOST_TOKEN) and executed with the service role. Same posture as LiveQue's admin-* fns.
//
// POST { action, room, ...args }   header: x-mic-host-token
//   state                                -> room + tonight's lineup
//   advance                              -> now->done, on_deck->now, next waiting->on_deck
//   set_status {id,status}               -> waiting | on_deck | now | done | bumped
//   bump {id} / restore {id}             -> no-show out / back to the end of the list
//   walkin {name, venmo?, socials?}      -> host adds someone at the door
//   feature {id, on}                     -> star / unstar the Featured Artist
//   feature_add {name, venmo?, socials?} -> manager adds a featured artist (with their tip + socials)
//   signup_update {id, name?, venmo?, socials?}
//   reorder {ids[]}                      -> set positions in the given order
//   room_update {host_venmo?, announcement?, socials?}
//   end_night                            -> mark everyone still active as done (and clear tonight's announcement)
//   ping {id}                            -> nudge one performer's phone (stamps pinged_at; their page buzzes + takes over)
//   remove_any {id}                      -> delete a signup from any night (archive too)
//   night_note {date, note}              -> rewrite a saved night's note

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOST_TOKEN = Deno.env.get("MIC_HOST_TOKEN") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

function tonight(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
// The coming Thursday in LA (today if it is Thursday). The host creates "the night" for this date.
function nextThursday(): string {
  const la = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  la.setDate(la.getDate() + ((4 - la.getDay() + 7) % 7));
  return la.toLocaleDateString("en-CA");
}
const COLS = "id, room_id, night_date, name, venmo, socials, position, status, is_featured, confirmed_at, pinged_at, created_at, updated_at";
const STATUSES = new Set(["waiting", "on_deck", "now", "done", "bumped"]);
const PERF_SOCIALS = ["instagram", "tiktok", "youtube", "spotify", "link"];
const ROOM_SOCIALS = ["instagram", "tiktok", "website", "maps", "facebook", "host_instagram"];

const handle = (v: unknown, max: number) => {
  const s = String(v ?? "").trim().replace(/^@/, "").slice(0, max);
  return s || null;
};
function cleanSocials(v: unknown, keys: string[], max = 200): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const k of keys) {
      const s = String((v as Record<string, unknown>)[k] ?? "").trim().replace(/^@/, "").slice(0, max);
      if (s) out[k] = s;
    }
  }
  return out;
}
function insertError(error: { message: string; code?: string }) {
  return error.message.includes("LIST_FULL") ? "LIST_FULL" : error.code === "23505" ? "DUPLICATE" : error.message;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!HOST_TOKEN || req.headers.get("x-mic-host-token") !== HOST_TOKEN) {
    return json({ error: "no" }, 401);
  }
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const slug = String(body.room || "hama-venice");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: room } = await admin.from("mic_rooms").select("*").eq("slug", slug).single();
    if (!room) return json({ error: "no room" }, 404);
    const night = room.current_night || tonight();

    const lineup = async () => {
      const { data } = await admin.from("mic_signups").select(COLS)
        .eq("room_id", room.id).eq("night_date", night).order("position", { ascending: true });
      return data || [];
    };
    const setStatus = (id: string, status: string) =>
      admin.from("mic_signups").update({ status }).eq("id", id).eq("room_id", room.id);
    const freshRoom = async () => (await admin.from("mic_rooms").select("*").eq("id", room.id).single()).data;

    if (action === "state") {
      // A count only: the manager shows "12 emails" without pulling the addresses on every load.
      const { count } = await admin.from("mic_contacts").select("*", { count: "exact", head: true }).eq("room_id", room.id);
      return json({ room, night, lineup: await lineup(), contacts_count: count ?? 0 });
    }

    if (action === "ping") {
      // "Mark is calling you": stamp the row; the performer's page watches its own row and buzzes.
      await admin.from("mic_signups").update({ pinged_at: new Date().toISOString() })
        .eq("id", String(body.id)).eq("room_id", room.id).eq("night_date", night);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "advance") {
      const rows = await lineup();
      const now = rows.find((r) => r.status === "now");
      const deck = rows.find((r) => r.status === "on_deck");
      const next = rows.filter((r) => r.status === "waiting").sort((a, b) => a.position - b.position)[0];
      if (now) await setStatus(now.id, "done");
      if (deck) await setStatus(deck.id, "now");
      if (next) await setStatus(next.id, "on_deck");
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "set_status") {
      if (!STATUSES.has(body.status)) return json({ error: "bad status" }, 400);
      if (body.status === "now" || body.status === "on_deck") {
        // Only one act can hold each of these at a time.
        await admin.from("mic_signups").update({ status: "waiting" })
          .eq("room_id", room.id).eq("night_date", night).eq("status", body.status).neq("id", body.id);
      }
      await setStatus(String(body.id), body.status);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "bump") {
      await setStatus(String(body.id), "bumped");
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "restore") {
      const rows = await lineup();
      const maxp = rows.reduce((m, r) => Math.max(m, r.position), 0);
      await admin.from("mic_signups").update({ status: "waiting", position: maxp + 1 })
        .eq("id", String(body.id)).eq("room_id", room.id);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "walkin" || action === "feature_add") {
      const name = String(body.name || "").trim().slice(0, 60);
      if (!name) return json({ error: "name required" }, 400);
      const { data, error } = await admin.from("mic_signups").insert([{
        room_id: room.id, name, venmo: handle(body.venmo, 40), socials: cleanSocials(body.socials, PERF_SOCIALS),
      }]).select("id").single();
      if (error) return json({ error: insertError(error) }, 400);
      if (action === "feature_add" && data) {
        await admin.from("mic_signups").update({ is_featured: true }).eq("id", data.id);
      }
      return json({ ok: true, id: data?.id, lineup: await lineup() });
    }

    if (action === "feature") {
      await admin.from("mic_signups").update({ is_featured: !!body.on })
        .eq("id", String(body.id)).eq("room_id", room.id);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "signup_update") {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 60);
      if (body.venmo !== undefined) patch.venmo = handle(body.venmo, 40);
      if (body.socials !== undefined) patch.socials = cleanSocials(body.socials, PERF_SOCIALS);
      const { error } = await admin.from("mic_signups").update(patch).eq("id", String(body.id)).eq("room_id", room.id);
      if (error) return json({ error: insertError(error) }, 400);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "reorder") {
      const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
      let p = 0;
      for (const id of ids) {
        p += 1;
        await admin.from("mic_signups").update({ position: p }).eq("id", id).eq("room_id", room.id).eq("night_date", night);
      }
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "room_update") {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 80);
      if (body.venue !== undefined) patch.venue = String(body.venue).trim().slice(0, 80);
      if (body.host_name !== undefined) patch.host_name = String(body.host_name).trim().slice(0, 80);
      if (body.host_venmo !== undefined) patch.host_venmo = handle(body.host_venmo, 40);
      if (body.announcement !== undefined) patch.announcement = String(body.announcement ?? "").trim().slice(0, 300) || null;
      if (body.socials !== undefined) patch.socials = cleanSocials(body.socials, ROOM_SOCIALS, 300);
      await admin.from("mic_rooms").update(patch).eq("id", room.id);
      return json({ ok: true, room: await freshRoom(), lineup: await lineup() });
    }

    if (action === "remove") {
      // Hard-delete a bogus or duplicate signup from tonight's list.
      await admin.from("mic_signups").delete().eq("id", String(body.id)).eq("room_id", room.id).eq("night_date", night);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "remove_any") {
      // Scrub one signup from ANY night (a demo name, a duplicate on an old night). Gone from the archive too.
      await admin.from("mic_signups").delete().eq("id", String(body.id)).eq("room_id", room.id);
      return json({ ok: true });
    }

    if (action === "night_note") {
      // Rewrite the saved note on one night record (the archive shows it).
      const date = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
      const note = String(body.note ?? "").trim().slice(0, 300) || null;
      await admin.from("mic_nights").update({ note }).eq("room_id", room.id).eq("night_date", date);
      return json({ ok: true });
    }

    if (action === "confirm_tip") {
      // Host saw the Venmo land: one tap marks the tip paid (the public plate fills in solid).
      await admin.from("mic_tips").update({ paid: true, paid_at: new Date().toISOString() }).eq("id", String(body.id)).eq("room_id", room.id);
      return json({ ok: true });
    }

    if (action === "contact_remove") {
      await admin.from("mic_contacts").delete().eq("room_id", room.id).eq("email", String(body.email || "").toLowerCase().trim());
      return json({ ok: true });
    }

    if (action === "contacts") {
      // The mailing list. Only reachable with the host token; the public can never read it.
      const { data } = await admin.from("mic_contacts").select("name, email, consented_at").eq("room_id", room.id).order("created_at", { ascending: false });
      return json({ ok: true, contacts: data || [] });
    }

    if (action === "slide_down") {
      // No-show handling that keeps them on the list: move n spots down (default 3), never delete.
      const n = Math.max(1, Math.min(20, Number(body.n) || 3));
      const rows = await lineup();
      const act = rows.filter((r) => r.status !== "bumped").sort((a, b) => a.position - b.position);
      const ids = act.map((r) => r.id);
      const k = ids.indexOf(String(body.id));
      if (k < 0) return json({ error: "not found" }, 404);
      ids.splice(k, 1); ids.splice(Math.min(ids.length, k + n), 0, String(body.id));
      let p = 0;
      for (const id of ids) { p += 1; await admin.from("mic_signups").update({ position: p }).eq("id", id).eq("room_id", room.id); }
      await admin.from("mic_signups").update({ status: "waiting", confirmed_at: null }).eq("id", String(body.id)).eq("room_id", room.id);
      return json({ ok: true, lineup: await lineup() });
    }

    if (action === "start_night") {
      // Create the night for the right Thursday (or a given date) and open sign-ups.
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : nextThursday();
      await admin.from("mic_rooms").update({ current_night: date, is_open: true }).eq("id", room.id);
      // The night becomes a saved record people can go back to.
      await admin.from("mic_nights").upsert([{ room_id: room.id, night_date: date, note: room.announcement || null }], { onConflict: "room_id,night_date" });
      const { data } = await admin.from("mic_signups").select(COLS)
        .eq("room_id", room.id).eq("night_date", date).order("position", { ascending: true });
      return json({ ok: true, room: await freshRoom(), night: date, lineup: data || [] });
    }

    if (action === "close_night") {
      await admin.from("mic_rooms").update({ is_open: false }).eq("id", room.id);
      return json({ ok: true, room: await freshRoom(), night, lineup: await lineup() });
    }

    if (action === "end_night") {
      // Everyone still active is done, and sign-ups close until the host starts the next night.
      await admin.from("mic_signups").update({ status: "done" })
        .eq("room_id", room.id).eq("night_date", night).in("status", ["waiting", "on_deck", "now"]);
      // The night's note is saved on the night record first, then cleared: tonight's announcement means tonight.
      await admin.from("mic_nights").upsert([{ room_id: room.id, night_date: night, note: room.announcement || null, ended_at: new Date().toISOString() }], { onConflict: "room_id,night_date" });
      await admin.from("mic_rooms").update({ is_open: false, announcement: null }).eq("id", room.id);
      return json({ ok: true, room: await freshRoom(), night, lineup: await lineup() });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
