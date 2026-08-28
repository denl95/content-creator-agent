# Facebook Page Publishing — Meta Setup

Everything on Meta's side that has to exist before `FACEBOOK_PAGE_ID` and
`FACEBOOK_PAGE_ACCESS_TOKEN` mean anything to this app.

The code (`src/publishers/facebook.ts`) does exactly one thing: `POST` to
`https://graph.facebook.com/{version}/{page-id}/feed` with a `message` and an
`access_token`. It has no OAuth flow, no token refresh, and no page picker —
those were deliberately scoped out
(`docs/superpowers/specs/2026-08-05-facebook-publishing-design.md` §2). So the
token you produce here has to be one that keeps working unattended.

**Time:** ~20 minutes. **Cost:** free. **App Review:** not required — see §4.

---

## 0. What you need first

- A Facebook account that is an **admin of the Page** you want to post to.
- The Page itself. A personal profile cannot be posted to by this API.
- For the recommended token path (§5), the Page must sit in a **business
  portfolio** (Meta Business Manager). Creating one is free and takes a minute;
  §5 covers it.

---

## 1. Register as a Meta developer

1. Go to <https://developers.facebook.com/> and log in with the Facebook
   account that admins the Page.
2. Click **Get Started** in the top-right and follow the prompts — accept the
   platform terms, verify the account (phone or email), and pick a role when
   asked (any answer is fine; it only tunes the docs you're shown).

Reference: [Register as a Meta developer](https://developers.facebook.com/documentation/development/register)

---

## 2. Create the app

1. Go to <https://developers.facebook.com/apps/> → **Create App**.
2. **App name:** anything internal — e.g. `EONYX Content Publisher`. This is
   never shown on the post; posts are attributed to the Page.
3. **Use case / app type:** choose **Other** → **Business**.
   The Business type is what gets Standard Access to the Page permissions
   automatically (§4). Do not pick Consumer or Gaming.
4. Link it to a business portfolio when asked, or create one — you need one
   anyway for §5.
5. Note the **App ID** from the dashboard. You won't put it in `.env`, but the
   token generator asks for it.

**Leave the app in Development mode.** The toggle at the top of the App
Dashboard should read "In development", not "Live". Development mode plus
Standard Access is precisely the configuration that skips App Review, and this
app is only ever used by you.

Reference: [Create an App](https://developers.facebook.com/documentation/development/create-an-app)

---

## 3. Which permissions the publisher needs

For `POST /{page-id}/feed` you need the Page task **`CREATE_CONTENT`**, granted
through these permissions:

| Permission | Why |
|---|---|
| `pages_manage_posts` | Creating the post. The one that actually matters. |
| `pages_read_engagement` | Reading Page data — backs `fetchPageName()`, used by `GET /publish/facebook/status` to name the Page in the confirmation. |
| `pages_show_list` | Enumerating the Pages you have a role on. Needed by `GET /me/accounts` in the §6 fallback token path. |
| `pages_manage_metadata` | Listed by Meta among the Pages API prerequisites. Harmless to include; not exercised by this code. |

Reference: [Pages API — Getting Started](https://developers.facebook.com/docs/pages-api/getting-started)

---

## 4. Why App Review is *not* required here

Meta grants permissions at two levels:

- **Standard Access** — works only for app users who **hold a role on the app**
  (admin, developer, tester). Business and Consumer apps are *automatically
  approved* for every permission available to their type at this level. No
  review, no verification.
- **Advanced Access** — needed to serve the general public. Requires **App
  Review per permission** *and* **Business Verification**.

Since the only person using this app is you, and you're the app's admin,
Standard Access is sufficient and nothing needs approval.

You will see the Pages API docs say Page permissions "require approval through
the App Review process before your app can use them when your app goes live."
That sentence is about Advanced Access — i.e. going live to users who have no
role on your app. It does not apply to this setup.

**The consequence to remember:** this arrangement stays valid only while you
hold both the app role and the Page admin role. Lose either and publishing
starts failing with a permissions error, not a clear message.

Reference: [Permissions Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)

---

## 5. Get the token — System User (recommended)

A System User token is the one that survives. It has no expiry driven by time
and is not tied to your personal login session, so a password change or a
"log out of all sessions" doesn't kill it. A Page token derived from your user
token *does* die on both, and this app has no refresh flow to recover — the
first symptom would be a failed publish with Meta's `code 190`.

1. Open **Meta Business Settings**: <https://business.facebook.com/settings>.
   Create a business portfolio if you have none.
2. **Accounts → Pages → Add** — add the Page you'll publish to, if it isn't
   already in the portfolio.
3. **Accounts → Apps → Add** — add the app from §2. The system user, the app,
   and the Page must all live in the same business portfolio, or token
   generation will refuse the combination.
4. **Users → System users → Add**.
   - Name: e.g. `content-publisher`.
   - Role: **Employee access** is enough. Admin is not needed to post.
5. Select the new system user → **Assign assets**:
   - Assign the **Page**, with the **Content** / *Create content* task enabled
     (this is the `CREATE_CONTENT` task from §3). Full control also works.
   - Assign the **App**, with *Develop app* enabled.
6. Still on the system user → **Generate new token**.
   - Choose the app from §2.
   - Token expiration: **Never**.
   - Tick the four permissions from §3.
   - Click **Generate token**.
7. **Copy the token now.** It is shown exactly once. It is a bearer credential
   for posting to your Page — treat it like a password, keep it out of git, and
   never paste it into a browser URL bar or a support thread.

Meta's Business Settings UI is relabelled fairly often; if a menu name above
doesn't match, the nouns (System users → Assign assets → Generate new token)
have been stable even when the navigation moves.

Reference: [System Users](https://developers.facebook.com/docs/marketing-api/system-users/create-retrieve-update)

---

## 6. Fallback: a long-lived Page token from the Graph API Explorer

Use this only if you cannot create a business portfolio. It is more fragile —
it dies when your password changes or your sessions are revoked.

1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/),
   pick your app, and click **Generate Access Token**. Grant the four
   permissions from §3. You now hold a **short-lived user token** (1–2 hours).
2. Exchange it for a **long-lived user token** (~60 days):

   ```bash
   curl -sG 'https://graph.facebook.com/v26.0/oauth/access_token' \
     -d grant_type=fb_exchange_token \
     -d client_id=YOUR_APP_ID \
     -d client_secret=YOUR_APP_SECRET \
     -d fb_exchange_token=SHORT_LIVED_USER_TOKEN
   ```

3. Derive the **Page token** from the *long-lived* user token. A Page token
   derived this way carries no time-based expiry:

   ```bash
   curl -sG 'https://graph.facebook.com/v26.0/me/accounts' \
     -d access_token=LONG_LIVED_USER_TOKEN
   ```

   The response lists each Page you have a role on with its `id` and
   `access_token`. Take both — that's your `FACEBOOK_PAGE_ID` and
   `FACEBOOK_PAGE_ACCESS_TOKEN`.

Step 3 must use the long-lived user token. Running it against the short-lived
one gives you a Page token that expires in an hour, and the failure arrives
later as an unexplained `code 190` mid-demo.

Reference: [Page Access Tokens](https://developers.facebook.com/docs/pages/access-tokens/)

---

## 7. Find the Page ID

If §6 didn't already hand it to you:

- **From the API** (works with a System User token too):

  ```bash
  curl -sG 'https://graph.facebook.com/v26.0/me/accounts' -d access_token=YOUR_TOKEN
  ```

- **From the UI:** the Page → **Settings** → **Page transparency** (or **About**),
  where the numeric Page ID is listed. The vanity URL slug is *not* the ID; the
  app needs the digits.

---

## 8. Verify before wiring it into the app

Confirm the credential works on its own, so that a later failure is
unambiguously the app's fault and not the token's.

```bash
# 1. Token is valid and can read the Page — this is what `fetchPageName()` does.
curl -sG "https://graph.facebook.com/v26.0/$FACEBOOK_PAGE_ID" \
  -d fields=name \
  -d access_token="$FACEBOOK_PAGE_ACCESS_TOKEN"
# → {"name":"Your Page","id":"1234..."}

# 2. Token can actually post. This publishes publicly — delete the post after.
curl -sX POST "https://graph.facebook.com/v26.0/$FACEBOOK_PAGE_ID/feed" \
  -d message='setup test' \
  -d access_token="$FACEBOOK_PAGE_ACCESS_TOKEN"
# → {"id":"1234..._5678..."}
```

Step 2 posts to your real Page for real. Delete it from the Page afterwards —
there is no unpublish path in this app.

---

## 9. Put it in `.env`

```bash
FACEBOOK_PAGE_ID=1234567890
FACEBOOK_PAGE_ACCESS_TOKEN=EAAG...
FACEBOOK_API_VERSION=v26.0
```

Both `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_ACCESS_TOKEN` must be set or the
publish route returns `facebook_not_configured` (400) and the dashboard button
renders disabled with an explanation rather than failing on click.

For the deployed app, set them as Fly secrets rather than baking them into the
image:

```bash
fly secrets set FACEBOOK_PAGE_ID=… FACEBOOK_PAGE_ACCESS_TOKEN=…
```

---

## 10. Graph API version

The code defaults `FACEBOOK_API_VERSION` to **v26.0** (released 29 July 2026).
The prior version, **v25.0** (released 18 February 2026), remains available
until **29 July 2028** — so pinning back to it is safe for roughly two more
years if you ever need to, and the variable exists precisely so that bump (or
rollback) is a config change, not a code change.

Meta keeps each version alive for about two years past release. Check
<https://developers.facebook.com/docs/graph-api/changelog> before assuming the
pin is still current.

---

## 11. When it fails

`src/publishers/facebook.ts` surfaces Meta's own error prose and numeric code
verbatim, and the route returns it as `facebook_publish_failed` (502) with that
message attached. **Read Meta's text** — from inside this app a stale token, a
wrong Page ID and a missing permission are indistinguishable, which is exactly
why the message is passed through rather than replaced.

| What you'll see | Usually means |
|---|---|
| `code 190` — "Error validating access token" / "Session has expired" | The token died. If it's a §6 token, a password change or session revocation killed it — regenerate, and switch to §5. |
| `code 200` — permissions error | `pages_manage_posts` missing from the token, or the system user lost the Page's *Create content* task. |
| `code 100` — invalid parameter | Usually a wrong `FACEBOOK_PAGE_ID` (a slug instead of the numeric ID). |
| `facebook_not_configured` (400) | One of the two env vars is unset in the process actually serving the request. |
| `facebook_already_published` (409) | Expected. This draft has a `facebook_url` already; the guard runs *before* Graph so a stale tab can't double-post. |

Two things that quietly invalidate a working token: dropping your admin role on
the Page, and removing the system user's asset assignment in Business Settings.
Neither produces a warning until the next publish attempt.

---

## See also

- Design spec: `docs/superpowers/specs/2026-08-05-facebook-publishing-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-05-facebook-publishing.md`
- [Pages API](https://developers.facebook.com/docs/pages-api/) ·
  [Permissions Reference](https://developers.facebook.com/docs/permissions/) ·
  [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)
