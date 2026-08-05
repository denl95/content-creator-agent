# Publishing a Draft to Facebook — Design Spec

**Date:** 2026-08-05
**Goal:** Give a finished draft a second manual destination — a Facebook Page — without disturbing the Notion path or the deliberate rule that nothing publishes as part of a run.

---

## 1. Context

A draft reaches an outside system in exactly one way today. `POST /drafts/:id/publish` (`src/server.ts`) calls `publishDraft()` in `src/mcp/notion.ts`, writes the returned page URL onto the row via `setDraftNotionUrl`, and the draft detail page renders either that link or a `PublishButton`. There is no publisher node and no `SKIP_PUBLISH` flag: the graph ends at `finalizer`, and publishing is a per-draft human action. That was a deliberate decision — a run costs money and creates a page, and the two should not be one keystroke.

Facebook is a second destination under the same rule. The shape of the change is therefore already set by the Notion path; what it cannot inherit is the storage, because `notion_url` is a single column and the UI is binary — link *or* button — with no room for a second destination.

Facebook also differs from Notion in one way that drives several decisions below: a Page post is **public and effectively irreversible**. A wrong Notion row is a private mistake; a wrong Page post is not.

## 2. Goals and non-goals

**In scope**

- Post a draft's content to a single Facebook Page the operator owns
- Convert the draft's markdown to plain text, since Facebook renders no formatting
- Record the resulting post URL on the draft and link to it
- A confirmation step in front of the post, and a server-side guard against double-posting

**Explicitly out of scope**

- **Multiple Pages, OAuth, per-brand tokens.** One Page, configured by env, mirroring how Notion is configured. A page picker means an OAuth callback route, token storage and refresh handling — a different project.
- **Facebook Groups.** Meta deprecated Groups API publishing for most apps; it is not achievable without special approval.
- **An LLM-adapted Facebook version of the draft.** A rewrite pass (hook, short paragraphs, hashtags) would produce a better-looking post, but it costs money per publish, adds latency, and needs its own prompt and review gate. The draft is posted as written.
- **Scheduling, images, link attachments, unpublished Page drafts.** Text, now, on click.
- **Re-publishing.** One draft, one post. See §6.
- **Moving `src/mcp/notion.ts`.** It is Notion's transport, not a generic publisher, and relocating it is unrelated refactoring. See §3.
- **A publisher registry / `Publisher` interface.** The right shape at four destinations; at two it is indirection that makes each publisher harder to read than the flat function it replaces.

## 3. Decisions and their alternatives

### A sibling route, not a parameterized one

`POST /drafts/:id/publish/facebook` sits alongside an **untouched** `POST /drafts/:id/publish`.

The alternative — one route taking `{ destination: 'notion' | 'facebook' }` — is more symmetric and would remove the naming asymmetry noted below. It was rejected because it edits the only publish path that currently works, its compatibility default (`destination` absent ⇒ Notion) is a permanent wart, and the two destinations have different config checks and different failure modes that a shared handler forks on anyway. Nothing that works today can regress under a sibling route.

**Accepted cost:** the two publishers live in different directories — `src/mcp/notion.ts` and `src/publishers/facebook.ts`. This reads oddly. It is preferred to moving working code for tidiness. When a third destination arrives, moving Notion into `src/publishers/` and introducing the registry is the correct moment.

### Plain `fetch`, not MCP

`src/publishers/facebook.ts` calls the Graph API directly. There is no official Meta MCP server, and the `npx`-spawn cold start behind `src/mcp/notion.ts` is already documented as a production hazard — `loadFromNotion()` taking minutes on a cold cache is why `NOTION_BRAND_PAGE_ID` must not be set in production. Repeating that transport for a new integration would be repeating a known mistake. Meta's `facebook-nodejs-business-sdk` is ads-focused and far too heavy for one POST.

### A new column, not a publications table

`facebook_url` mirrors `notion_url`. A `publications(draft_id, destination, url, published_at)` table generalizes better, but requires backfilling existing `notion_url` rows and touches every publish path, the drafts list and `web/lib/types.ts` — a large migration for the payoff of one extra destination. Renaming `notion_url` to a generic `published_url` was rejected outright: it makes the destinations mutually exclusive and destroys an existing Notion link on the second publish.

## 4. Transport — `src/publishers/facebook.ts`

A leaf module importing nothing from the rest of the app.

```ts
export type FacebookPostArgs = { pageId: string; accessToken: string; message: string };
export type FacebookPostResult = { id: string; url: string };

export async function publishToFacebook(args: FacebookPostArgs): Promise<FacebookPostResult>;
export async function fetchPageName(pageId: string, accessToken: string): Promise<string | null>;
```

`publishToFacebook` issues `POST https://graph.facebook.com/${FACEBOOK_API_VERSION}/${pageId}/feed` with a form-encoded body carrying `message` and `access_token`. Verified against Meta's live documentation on 2026-08-05: this endpoint, the `pages_manage_posts` permission, and a success body of `{"id": "<pageid>_<postid>"}`.

`FACEBOOK_API_VERSION` is a constant in `src/constants.ts` defaulting to `v25.0` (current as of February 2026) and overridable by env, so a Meta deprecation is a config change rather than a code change.

The post URL is `https://www.facebook.com/{id}`, built from the returned composite id.

Two failure modes the module owns:

- **Over-length.** Facebook's cap is 63,206 characters. The module rejects before the network call. A 1,200-word draft is nowhere near this, but a Meta error about truncation is a worse diagnostic than our own explicit one.
- **Graph errors.** Meta returns 4xx with `{error: {message, code, error_subcode, fbtrace_id}}`. The thrown `Error` carries Meta's own `message` and `code` verbatim. This matters more than usual: the app cannot distinguish a stale token from a wrong Page ID from a missing permission, and only Meta's prose can. A generic "publish failed" would make the most likely real-world failure undiagnosable.

`fetchPageName` issues `GET /{page-id}?fields=name`, used only by the status route in §6.

## 5. Conversion — `markdownToPlainText()` in `src/utils/text.ts`

Drafts are markdown; Facebook renders none of it. Posting the raw source shows literal `##` and `**` to readers.

The function joins `countWords` in the existing utils module — pure, no I/O, unit-testable without a network. Rules:

| Markdown | Becomes |
|---|---|
| `#` … `######` headings | the heading text, markers dropped |
| `- ` / `* ` / `+ ` bullets | `• ` |
| `1. ` numbered items | unchanged |
| `**bold**`, `__bold__`, `*em*`, `_em_` | the inner text |
| `` `code` `` | the inner text |
| ` ```fenced``` ` blocks | the contents, fences dropped |
| `[text](url)` | `text (url)` |
| `![alt](url)` | `alt (url)` |
| `> ` quote markers | dropped |
| `---` horizontal rules | line dropped |
| 3+ consecutive blank lines | 2 |

Output is trimmed. Facebook collapses long posts behind "See more" but publishes them in full.

## 6. API

Two routes in `src/server.ts`, inside the existing `/drafts*` auth guard.

### `POST /drafts/:id/publish/facebook`

| Condition | Status | Error code |
|---|---|---|
| No such draft | 404 | `draft_not_found` |
| `FACEBOOK_PAGE_ID` or `FACEBOOK_PAGE_ACCESS_TOKEN` unset | 400 | `facebook_not_configured` |
| `draft.facebook_url` already set | 409 | `facebook_already_published` |
| Graph rejected the post | 502 | `facebook_publish_failed`, `message` = Meta's text |
| Posted | 200 | `{ url }` |

**The 409 is evaluated before the Graph call.** The "one draft, one post" rule is enforced server-side, not merely by a button that disappeared — a stale browser tab must not be able to double-post to a live Page. On success the route calls `setDraftFacebookUrl` and returns the URL.

### `GET /publish/facebook/status` → `{ configured: boolean, page_name: string | null }`

Exists so the confirmation can name the Page it is about to post to, and so an install without Facebook configured disables the button rather than failing after a click — an improvement over the Notion button, which only reports `notion_not_configured` post-hoc.

`page_name` comes from `fetchPageName`, cached in a module-level variable because a Page's name does not change within a process lifetime, and falling back to the Page ID if the lookup fails. `configured` is false when either env var is unset, and the route never touches Graph in that case.

## 7. Persistence

`prisma/schema.prisma` gains `facebookUrl String? @map("facebook_url")` on `Draft`.

The migration is authored with `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` and applied with `prisma migrate deploy`. **`prisma migrate dev` must not be run** — the pre-Prisma table's `created_at TEXT DEFAULT (datetime('now'))` reads as drift against Prisma's `DATETIME DEFAULT CURRENT_TIMESTAMP`, and `migrate dev` responds by offering to reset the database.

A nullable column should emit a plain `ALTER TABLE "drafts" ADD COLUMN "facebook_url" TEXT`. If it instead emits a `new_drafts` table rebuild, the generated SQL must be read to confirm the `INSERT INTO "new_drafts" … SELECT` carries every existing column before it is applied, and rehearsed against a copy of `data/app.db`.

`src/db.ts` gains `setDraftFacebookUrl(id, url)` using **`updateMany`, not `update`** — `update` throws P2025 when no row matches, where the hand-written SQL it replaced was a silent no-op. `toDraftRow()` gains `facebook_url`, keeping the snake_case wire shape.

`web/lib/types.ts` mirrors `facebook_url: string | null` by hand; there is no shared type across the Hono/Next boundary.

## 8. UI

**`web/components/facebook-publish-button.tsx`**, modeled on `publish-button.tsx`.

The confirmation is a **two-step inline state on the button itself**: the button is replaced in place by "Post publicly to «Page»?" with `[Post]` and `[Cancel]`. `web/components/ui/` has no dialog primitive, and adding `@radix-ui/react-alert-dialog` for a single confirmation is not worth the dependency. An inline flat control also suits the EONYX register — angular, editorial, no modals or glow — better than a centred overlay.

The component fetches `/api/publish/facebook/status` on mount. When `configured` is false the button renders disabled with an explanatory line rather than inviting a click that cannot succeed.

**The draft detail page** (`web/app/[locale]/(dashboard)/drafts/[id]/page.tsx`) grows a second block below the existing Notion one, in the same link-or-button shape: `facebook_url` present ⇒ a link to the post; absent ⇒ the button.

**i18n.** New keys land in **both** `web/i18n/messages/en.ts` and `uk.ts` — `tests/unit/i18n.test.ts` enforces parity. Needed: the button label, the pending label, the confirm question, the confirm and cancel labels, the "open post" link, the not-configured explanation, and three error strings.

**`web/lib/errors.ts`** registers `facebook_not_configured`, `facebook_already_published` and `facebook_publish_failed`. The existing `publishFailed` string reads "Publishing to Notion failed" and cannot be reused.

## 9. Configuration

`.env.example` gains:

```
# Facebook Page publishing (optional — enables the Publish to Facebook button
# on a draft). Nothing posts automatically; this is a per-draft manual action.
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_API_VERSION=v25.0
```

With a comment recording the operational constraint: `pages_manage_posts` normally requires App Review and Business Verification, which is avoidable **only** because the operator owns the Page and holds an admin or developer role on the app. A Page token derived from a user token can go stale — password change, session revocation — and this app has no OAuth refresh, so a **System User token from Business Manager**, which does not expire, is the token to use.

`CLAUDE.md`'s "Nothing publishes automatically" paragraph is extended to name both destinations rather than only Notion, and `ARCHITECTURE.md` records `src/publishers/` as a leaf directory alongside `src/mcp/`.

## 10. Testing

**Unit (`tests/unit/`), no network, no live Page:**

- `markdownToPlainText` across every rule in §5, plus a realistic full draft
- `publishToFacebook` against a stubbed `fetch`: success, a Graph error body (asserting Meta's message survives), and an over-length message rejected before any call
- `setDraftFacebookUrl` as a silent no-op on a missing row
- `server.test.ts`: each of the five outcomes in §6, and specifically that the 409 path performs **no** Graph call
- `GET /publish/facebook/status` with and without env configured

**`web/tests/`:** the button's unconfigured, confirm-then-post, cancel, and already-published states.

**Not tested, deliberately:** anything that posts to a real Facebook Page. No suite makes a live Graph call.

## 11. Risks

- **Token staleness is undiagnosable from inside the app.** Mitigated only by surfacing Meta's error text verbatim (§4) and by documenting the System User token (§9).
- **A published post cannot be recalled from here.** Mitigated by the inline confirmation and the server-side 409; not eliminated. Deleting a post is done in Facebook.
- **The two-publisher directory split will confuse a reader** until a third destination forces the registry. Recorded in §3 and in `ARCHITECTURE.md` so it is a known state rather than a discovery.
