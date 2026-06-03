# Writing captions (with an AI-slop pass)

TwitXGram renders the *image*. The **caption** that ships with a Metricool post is written
separately and passed in as text — raw tweet text rarely makes a good caption. This is the
repeatable process for producing a caption that reads like a human wrote it.

Caption-writing and the AI-slop check are LLM tasks, so they run in your assistant (Claude), **not**
inside the Node server. The server just accepts the finished caption (`text` on `/api/v1/publish`,
or `info.text` for the Metricool MCP).

## The process

1. **Get the source.** The tweet text (and, for a thread, the first tweet) — `GET /api/v1/thread/:id`
   returns previews, or just paste the tweet.
2. **Draft the caption.** Hook line → one or two lines of context → a soft, specific CTA → 2–4
   hashtags. Match the destination network's voice. (Reuse a writing skill if you have one —
   `viral-post-writer`, `hook-generator`, `tweet-thread` — TwitXGram stays focused on the visual.)
3. **Run the AI-slop pass.** Send the draft through the **`ai-slop-detector`** skill. It flags the 21
   slop patterns (binary contrasts, rule-of-three, emoji confetti, "save this 👇" CTAs, em-dash
   melodrama, etc.) and returns a cleaned rewrite. Use the rewrite.
4. **Schedule with the clean caption.** Pass it as the post text:

   ```bash
   POST /api/v1/publish
   {
     "url": "https://x.com/u/status/123",
     "blogId": "<your-blog-id>",
     "text": "<the slop-checked caption>",
     "networks": ["instagram"],
     "draft": true
   }
   ```

   Or, if you schedule via the Metricool MCP, the cleaned caption is `info.text` in
   `createScheduledPost(blogId, date, info)`.

## Worked example

**Source tweet:** "Most people think the hard part of investing is picking winners. It isn't. The
hard part is staying in your seat when everything is screaming at you to sell."

**Draft (pre-check):** opened with a "not X, it's Y" contrast, a rule-of-three line ("reward
patience, punish panic, and humble everyone"), 📉/👇 emoji, a "Save this post 👇" CTA, and 5 hashtags
— flagged **High** slop.

**After the `ai-slop-detector` pass:**

> Picking winners is the easy part. Sitting still is what's hard.
>
> When a position drops 20% and your gut says sell, that's the moment that actually decides your
> returns — not the stock you bought.
>
> The investors who do well aren't smarter. They're just harder to rattle.
>
> \#investing #mindset

That cleaned string is what goes in `text`.

## Note on the auto-follow watcher

The watcher drafts autonomously (no assistant in the loop), so its drafts use the **raw tweet text**
as a placeholder caption. Polish them with this process at review time — the daily digest is the
prompt to do exactly that before anything is scheduled to go live.
