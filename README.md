# TwitXGram

Turn tweets and threads into clean, shareable images — and push them straight to Metricool.
Fetches tweet data via Twitter API v2 and renders screenshots using Playwright Chromium.

## Setup

```bash
git clone https://github.com/highbaud/twitxgram.git
cd twitxgram
npm install
npx playwright install chromium
cp .env.example .env
# Fill in TWITTER_BEARER_TOKEN — get one free at developer.twitter.com
npm start            # → http://localhost:3030  (open it for the playground)
```

## Playground

Open **`http://localhost:3030/`** for an interactive UI: paste a tweet URL and the **preview
re-renders live** as you change any control. Pick **Style → Quote poster** for a big-type
"tweet as poster" card, toggle thread mode (stack or carousel, with reply approval), then copy the
API URL, download (every carousel/thread slide), or schedule straight to Metricool.

### Quote poster (`style=quote`)

Renders the tweet's *text* in large editorial type on the gradient — no avatar box, stats, or logo,
just the words and a `@handle`. Add `quoteFont=serif` for an editorial serif treatment. This is the
IG/LinkedIn-native artifact that pairs with the Metricool carousel flow.

```bash
curl ".../screenshot/<id>?style=quote&quoteFont=serif&background=citrus&aspectRatio=1:1" -o poster.png
```

## Usage

Accepts a bare tweet ID **or a full tweet URL** (x.com / twitter.com / vx/fx mirrors), via the path
or `?url=`:

```
GET http://localhost:3030/api/v1/screenshot/:idOrUrl
GET http://localhost:3030/api/v1/screenshot/123?...           # bare id
GET http://localhost:3030/api/v1/screenshot/https%3A%2F%2Fx.com%2Fu%2Fstatus%2F123
GET http://localhost:3030/api/v1/screenshot/x?url=https://x.com/u/status/123
```

### Parameters

| Param | Default | Options |
|-------|---------|---------|
| `format` | `png` | `png`, `jpg`, `webp`, `svg`, `html` |
| `scale` | `2` | `1`–`3` (device pixel ratio) |
| `quality` | `90` | `1`–`100` (jpg/webp only) |
| `style` | `tweet` | `tweet` (screenshot) or `quote` (big-type poster) |
| `quoteFont` | `sans` | `serif` for an editorial quote poster |
| `theme` | `light` | `light`, `dark` |
| `returnType` | `buffer` | `buffer`, `url` |
| `aspectRatio` | `auto` | `auto`, `1:1`, `4:5`, `5:4`, `16:9`, `9:16` |
| `logo` | `x` | `x`, `bluebird`, `none` |
| `showFullText` | `true` | |
| `showTimestamp` | `true` | |
| `showViews` | `true` | |
| `showStats` | `true` | |
| `showMeta` | `true` | `false` drops timestamp + stats + views together |
| `showMedia` | `true` | |
| `mediaLayout` | `grid` | `grid`, `vertical` |
| `timeZoneOffset` | `UTC+0` | `UTC±N` |
| `background` | — | preset name, or `custom:<id>` for an uploaded background |
| `containerBackground` | theme default | hex, rgba, CSS gradient |
| `backgroundImage` | — | HTTPS URL |
| `containerPadding` | `16` | pixels (min 28 when `shadow` is on) |
| `borderRadius` | `16` | corner radius of the card, in px (try `30`) |
| `shadow` | `true` | `false` removes the drop shadow behind the card |
| `width` | `410` | 300–1000 |
| `carousel` | `false` | `false`, `auto`, `true` |
| `thread` | `false` | `true` renders the tweet's thread (see below) |
| `threadStyle` | `stack` | `stack` (tall image), `carousel` (one tweet/slide) |
| `include` | — | comma-separated reply IDs to add (see thread mode) |
| `metricool` | `false` | `true` returns Metricool-ready URLs + payload |
| `networks` | `instagram` | comma-separated target networks (Metricool) |

> **Corners & shadow:** `borderRadius` sets the card's rounded corners (the outer frame stays
> concentric); `shadow` (on by default) floats the card above the background with a soft drop shadow.
> Want just the card + shadow on transparency? `containerBackground=transparent`.
>
> **Clean text, no meta:** `showMeta=false` strips the date, likes, reposts, and views in one flag.
>
> **Carousel breaks** land on the most logical boundary that fits — paragraph → sentence → word —
> so each slide starts on a clean thought.

### Examples

```bash
# PNG (default)
curl "http://localhost:3030/api/v1/screenshot/1617979122625712128" -o tweet.png

# Dark SVG, no stats
curl "http://localhost:3030/api/v1/screenshot/1617979122625712128?format=svg&theme=dark&showStats=false" -o tweet.svg

# Return a URL instead of binary
curl "http://localhost:3030/api/v1/screenshot/1617979122625712128?returnType=url"
# → { "url": "http://localhost:3030/output/...", "format": "png", "tweetId": "..." }

# Custom background color, square crop
curl "http://localhost:3030/api/v1/screenshot/1617979122625712128?containerBackground=%23ff6b6b&aspectRatio=1:1" -o tweet.png
```

### Backgrounds

The card sits on a background. Resolution priority, highest first:

1. **`backgroundImage=<https URL>`** — your own image, cover-fit
2. **`background=<preset>`** — a curated gradient (list below)
3. **`containerBackground=<CSS>`** — raw hex / rgba / `linear-gradient(...)` escape hatch
4. **nothing** — a tasteful theme-aware default gradient (sky for light, midnight for dark)

**Presets** (`GET /api/v1/backgrounds` to list at runtime):

- *Mesh gradients:* `sunset`, `ocean`, `grape`, `forest`, `midnight`, `peach`, `mint`
- *Linear gradients:* `twilight`, `flamingo`, `citrus`, `sky`, `slate`, `ember`, `graphite`
- *Flat solids:* `white`, `black`, `ash`, `ink`

```bash
# Designed share card: sunset mesh, square crop, generous padding
curl "http://localhost:3030/api/v1/screenshot/1617979122625712128?background=sunset&aspectRatio=1:1&containerPadding=48" -o card.png
```

**Custom backgrounds (upload & reuse).** The playground's **"Upload a background"** button saves your
own image for repeated use; saved ones appear as a thumbnail gallery (click to use, hover to remove)
and in the Background dropdown. Reference one in the API with `background=custom:<id>`. Uploads are
downscaled (max 1600px) and re-encoded to WebP, which also strips EXIF/metadata.

```
GET    /api/v1/backgrounds              # { presets:[…], custom:[{id,name,url,addedAt}] }
POST   /api/v1/backgrounds/custom       # { name, dataUri }  (base64 image) → { added }
DELETE /api/v1/backgrounds/custom/:id   # remove a saved background
```

Files live in `backgrounds/` (gitignored); cap with `MAX_CUSTOM_BACKGROUNDS` (default 60).

### Fitting & carousels (never chop a tweet)

When you force an `aspectRatio`, a tall tweet would normally get clipped by the fixed-height frame. Two behaviors prevent that:

**Fit-to-frame (automatic).** The card auto-scales down so the *whole* tweet fits neatly inside the frame, centered — never chopped. No flag needed; it applies to every fixed-ratio render.

**Carousel mode.** When a tweet is too long to stay readable at one scale, split it into multiple cleanly-paginated slides:

- `carousel=auto` — only splits if the tweet won't fit one frame (requires an `aspectRatio`; with `aspectRatio=auto` there's no frame, so no split). Otherwise returns a single image.
- `carousel=true` — always produces a carousel (defaults to a `4:5` portrait frame if no `aspectRatio` given).

Each slide keeps the header for context, the timestamp + stats land on the **final** slide, and a swipe indicator (dots + `n/total`) appears on every slide, with a **"Swipe →"** hint on the first.

Carousels always return **JSON** (they're inherently multi-image), PNG slides:

```bash
# returnType=buffer (default) → base64 data URIs
curl "http://localhost:3030/api/v1/screenshot/<id>?carousel=true&aspectRatio=4:5&background=ocean"
# → { "type":"carousel", "count":3, "slides":[ {"index":0,"total":3,"dataUri":"data:image/png;base64,..."}, ... ] }

# returnType=url → saved files
curl "http://localhost:3030/api/v1/screenshot/<id>?carousel=true&returnType=url"
# → { "type":"carousel", "count":3, "slides":[ {"index":0,"total":3,"url":"http://.../output/..."}, ... ] }
```

### Thread mode

Render a whole thread, not just one tweet. The thread is rebuilt by walking the **reply chain
upward** from the tweet you give — so paste the **last** tweet of a thread and you get the whole thing.

- **Only the original author's chain is included automatically.** Replies from *other accounts* are
  surfaced as candidates and render **only when you approve them**.
- Discover the thread first (no render), then approve:

```bash
GET /api/v1/thread/:idOrUrl
# → { mainAuthor, count, tweets:[{id, isMainAuthor, author, textPreview}], candidates:[ids] }

# Render the author chain only:
GET /api/v1/screenshot/<lastTweetId>?thread=true

# Approve specific other-account replies by id:
GET /api/v1/screenshot/<lastTweetId>?thread=true&include=<id1>,<id2>

# As a swipeable carousel instead of one tall image:
GET /api/v1/screenshot/<lastTweetId>?thread=true&threadStyle=carousel
```

The playground does this for you: tick **Thread**, then either check a detected reply, or — the easy
path — **paste a reply's link into "Include a reply"** and it's added as a removable chip. Any
`include` id that isn't on the upstream chain is fetched and merged into the render at its
chronological spot, so you can hand-pick exactly the replies you want.

> Note: rebuilding *upward* works on any API tier. Auto-*detecting* downstream replies needs the
> recent-search endpoint (tier-limited) — which is why pasting the reply link is the reliable way to
> include one.

### Publish to Metricool

This service produces **Metricool-ready output**; the actual scheduling is done with the Metricool
**MCP** tool (the same path Shortsmith uses). Two steps:

```bash
# 1. Render to PUBLIC image URL(s) + get a ready createScheduledPost payload.
#    (a thread/long-tweet carousel → multiple media URLs = an Instagram carousel)
GET /api/v1/screenshot/<idOrUrl>?metricool=1&format=jpg&networks=instagram,facebook
# → { type:"metricool", media:["https://<public>/output/..."], info:{ media, providers, draft:true, ... } }
```

2. Fill `text`/`dateTime`, pick the `blogId`, and call the MCP tool:
   `createScheduledPost(blogId, date, info)`.

#### Or publish directly from the app (no Claude/MCP)

Set `METRICOOL_USER_TOKEN` + `METRICOOL_USER_ID` (Metricool **Advanced** plan) and the app schedules
on its own via Metricool's HTTP API. The playground's **"Schedule to Metricool"** panel drives this.

```bash
# Discover your brands/blogIds:
GET /api/v1/metricool/brands

# Render + schedule in one call (renders to public /output URLs, then schedules):
POST /api/v1/publish
{
  "url": "https://x.com/u/status/123",
  "blogId": "<your-blog-id>",          // from GET /api/v1/metricool/brands
  "text": "caption…",
  "networks": ["instagram", "facebook"],
  "dateTime": "2026-06-10T09:00:00",   // optional; omit to post now/draft
  "timezone": "America/Chicago",
  "draft": true,                        // default true — flip to false to go live
  "render": { "theme": "dark", "background": "ocean", "thread": "true" }
}
# → { scheduled:true, draft:true, blogId:"<your-blog-id>", media:[...urls], metricool:{...} }
```

Pick which brand to post to at runtime — `GET /api/v1/metricool/brands` lists every brand on your
account, and the playground's brand dropdowns are populated from it. Nothing is tied to a specific brand.

- **Public URLs:** Metricool fetches the image by URL, so set **`PUBLIC_BASE_URL`** to your deployed
  origin (else `/output` links use the request host).
- **Safety:** payloads default to `draft:true` / `autoPublish:false`. Optionally hard-block any brand
  you never want posted to via `METRICOOL_BLOCKED_BLOG_IDS` (fail-fast `403`, before any render).
  `/api/v1/publish` requires the `X-API-KEY` header when `API_KEY` is set.

### Auto-follow accounts (watchers)

Follow a Twitter account and TwitXGram will, on its own, render each new tweet (or whole self-thread)
and create a **Metricool draft** for review — an in-app poller, no Claude/MCP in the loop. The
playground's **"Auto-follow accounts"** panel manages this.

```bash
GET    /api/v1/watches                 # list followed accounts + state
POST   /api/v1/watches                 # { username, blogId, networks?, render? }
DELETE /api/v1/watches/:username        # unfollow
POST   /api/v1/watch/run                # poll now (the interval poller calls this too)
```

**How it behaves (safe by design):**
- **Drafts only** — never auto-publishes; you approve/schedule in Metricool.
- Renders a **screenshot** for a standalone tweet, or the **whole thread** when the new tweet is part
  of the author's self-thread (deduped by conversation, so a thread is drafted once).
- Skips retweets and replies to other accounts; advances a per-account `since_id` so nothing repeats.
- Honors the per-watch `render` options (style/background/etc.) and any `METRICOOL_BLOCKED_BLOG_IDS`.

**Requirements / caveats:**
- ⚠️ **Twitter read tier.** Polling timelines needs read access — the **free tier's read cap is very
  low**, so continuous polling realistically needs **Basic+**. Tune `WATCH_INTERVAL_MS` to your quota.
- Set **`PUBLIC_BASE_URL`** so Metricool can fetch the rendered images.
- Poller config: `WATCH_ENABLED`, `WATCH_INTERVAL_MS` (default 5 min), `WATCH_MAX_PER_POLL`.
- State persists in `data/watches.json` (gitignored).

#### Review notifications (so drafts don't sit unseen)

When a draft is created it's queued for a **daily digest** — one Slack/Discord message and/or email
listing everything drafted, with thumbnails and a link to review in Metricool. No more silent drafts.

```bash
GET  /api/v1/digest        # { pending, channelsConfigured }
POST /api/v1/digest/run    # send the digest now (the daily scheduler calls this)
```

- **Channels:** set `NOTIFY_WEBHOOK_URL` (Slack/Discord incoming webhook — auto-detected — or any URL,
  which receives structured JSON) and/or SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` +
  `NOTIFY_EMAIL_TO`). Configure either or both.
- **Cadence:** one digest per day at `DIGEST_HOUR` (server local, default 9am) — only if something's
  pending. Queue persists in `data/digest.json` and is cleared once delivered (kept for retry on failure).
- Drafts are queued only when a channel is configured; `POST /api/v1/digest/run` sends on demand.

### Auth (optional)

Set `API_KEY=your-secret` in `.env`. Then pass `X-API-KEY: your-secret` header on every request.

## Twitter API credentials

1. Go to [developer.twitter.com](https://developer.twitter.com)
2. Create a project and app (free tier is fine)
3. Copy the **Bearer Token** → `TWITTER_BEARER_TOKEN` in `.env`

Free tier gives 500k tweet reads/month, which is plenty for screenshot use.

## Deploying (Docker)

The bundled `Dockerfile` is based on the official Playwright image and installs
`fonts-noto-color-emoji` — **required** so emoji render in color on headless Linux (without it
they show as tofu boxes). It runs as the non-root `pwuser`.

```bash
docker compose up -d            # restart-on-crash + persistent data/ + backgrounds/ volumes
# or, plain docker:
docker build -t twitxgram .
docker run -p 3030:3030 --env-file .env twitxgram
# liveness:  GET /health
# readiness: GET /health/ready   (503 until Chromium is connected)
```

**Write-endpoint protection.** State-changing endpoints (`/publish`, `/watches`, `/watch/run`,
`/digest/run`, background upload/delete) require the `X-API-KEY` when `API_KEY` is set; when it
isn't, they're allowed **only from localhost** (real TCP peer) — so a public deploy can't post to
your Metricool or accept uploads anonymously. **Set `API_KEY` before exposing the service.** Render
throughput is capped by `RENDER_CONCURRENCY` (excess requests queue) to bound Chromium memory.

Behind a reverse proxy, `trust proxy` is enabled so client IPs (for rate limiting) come from
`X-Forwarded-For`.

## Production behavior & security

- **Rate limiting** — 60 req/min per IP (or per API key when auth is on). Over the limit → `429`.
  Configure with `RATE_LIMIT`. `X-Quota-Remaining` / `X-Quota-Limit` reflect the real window count.
- **SSRF protection** — `backgroundImage` must be `https://` and resolve to a public host;
  private / loopback / link-local / cloud-metadata targets are rejected with `400`.
- **CSS-injection guard** — `containerBackground` is whitelisted (hex / rgb / rgba / hsl / a single
  gradient); anything that could break out of the CSS context → `400`.
- **Render timeouts** — each capture is capped (per-op `8s`, hard request ceiling `RENDER_CEILING_MS`,
  default `30s` → `504`) so a slow/broken image CDN can't hang the server.
- **Render cache** — identical `returnType=buffer` requests are served from an in-memory LRU
  (`X-Render-Cache: HIT|MISS`). Tweet data is cached 5 min.
- **Disk hygiene** — `returnType=url` files in `/output` are swept hourly; anything older than
  `OUTPUT_TTL_MS` (default 24h) is deleted.
- **Browser lifecycle** — Chromium is warmed at boot and closed on `SIGTERM`/`SIGINT`
  (graceful drain). Render contexts always close, even on error.

### Config (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `TWITTER_BEARER_TOKEN` | — | Twitter API v2 token (required) |
| `API_KEY` | — | If set, requires `X-API-KEY` header |
| `PUBLIC_BASE_URL` | request host | Absolute origin for `/output` URLs (needed for Metricool) |
| `METRICOOL_USER_TOKEN` | — | Metricool API token (enables `POST /api/v1/publish`) |
| `METRICOOL_USER_ID` | — | Metricool user id (with the token above) |
| `METRICOOL_BLOCKED_BLOG_IDS` | (none) | Blog IDs to hard-block from posting |
| `PORT` | `3030` | Listen port |
| `RATE_LIMIT` | `60` | Requests per minute per key/IP |
| `RENDER_CEILING_MS` | `30000` | Hard per-request render timeout |
| `OUTPUT_TTL_MS` | `86400000` | Age before `/output` files are swept |

## Tests

```bash
npm test     # unit tests (node:test) — validation, backgrounds, renderer
npm run smoke # visual smoke: renders sample PNGs to ./test-output
```
