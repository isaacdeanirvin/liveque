const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function parseSpotify(input: string): { type: string; id: string } | null {
  if (!input) return null;
  const s = input.trim();
  const uri = s.match(/spotify:(album|playlist|track):([A-Za-z0-9]+)/);
  if (uri) return { type: uri[1], id: uri[2] };
  const url = s.match(/open\.spotify\.com\/(?:[a-z-]+\/)?(album|playlist|track)\/([A-Za-z0-9]+)/);
  if (url) return { type: url[1], id: url[2] };
  return null;
}

function findEntity(obj: any): any | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj.trackList) && obj.trackList.length) return obj;
  for (const k of Object.keys(obj)) {
    const found = findEntity(obj[k]);
    if (found) return found;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body. Send { \"url\": \"<spotify link>\" }" }, 400);
  }

  const parsed = parseSpotify(body.url || body.uri || "");
  if (!parsed) {
    return json({ error: "Could not find a Spotify album/playlist/track ID in that input." }, 400);
  }

  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}`;

  let res: Response;
  let html: string;
  try {
    res = await fetch(embedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    html = await res.text();
  } catch (e) {
    return json({
      ok: false,
      stage: "fetch",
      error: String(e),
      note: "Network/fetch threw. Spotify may be blocking this server's IP.",
    }, 502);
  }

  if (!res.ok) {
    return json({
      ok: false,
      stage: "fetch",
      spotifyStatus: res.status,
      embedUrl,
      note:
        res.status === 403 || res.status === 429
          ? "Spotify REFUSED the request (403/429) — datacenter-IP block. This is the failure mode we were testing for."
          : "Spotify returned a non-200 status.",
    }, 502);
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    return json({
      ok: false,
      stage: "parse",
      spotifyStatus: res.status,
      htmlLength: html.length,
      note: "Fetch worked (NOT IP-blocked), but __NEXT_DATA__ wasn't found. Spotify changed their markup; send me the htmlSample.",
      htmlSample: html.slice(0, 500),
    }, 200);
  }

  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    return json({ ok: false, stage: "parse", note: "Found __NEXT_DATA__ but JSON.parse failed: " + String(e) }, 200);
  }

  const entity = findEntity(data);
  if (!entity) {
    return json({
      ok: false,
      stage: "parse",
      note: "Parsed the page JSON but found no trackList. Fetch is fine; the JSON shape changed.",
    }, 200);
  }

  const tracks = (entity.trackList as any[])
    .map((t) => ({
      title: t.title || t.name || "",
      artist:
        t.subtitle ||
        (Array.isArray(t.artists) ? t.artists.map((a: any) => a.name).join(", ") : "") ||
        "",
    }))
    .filter((t) => t.title);

  return json({
    ok: true,
    type: parsed.type,
    id: parsed.id,
    collectionName: entity.name || entity.title || "",
    count: tracks.length,
    tracks,
  });
});