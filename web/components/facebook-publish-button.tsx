'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import en from '@/i18n/messages/en';
import { useMessages } from '@/i18n/provider';
import { errorMessage } from '@/lib/errors';

/**
 * Publish a draft to the configured Facebook Page.
 *
 * The confirmation is an inline two-step state rather than a modal: a Page post
 * is public and cannot be recalled from here, so it needs a gate — but
 * `components/ui/` has no dialog primitive, and one confirmation does not
 * justify a Radix dependency. An inline flat control also suits the EONYX
 * register, which rejects overlays and glow.
 *
 * `configured` and `pageName` arrive as props from the Server Component: the
 * page already loads its data server-side, and this keeps the component's
 * states pure enough to assert without a DOM.
 *
 * `useRouter`/`useMessages` both throw outside their Next App Router /
 * `MessagesProvider` ancestors. Those ancestors exist on every real render
 * (`app/[locale]/layout.tsx` wraps the tree, and Next's client runtime
 * supplies the router context), so this never falls back in the app. But
 * `web/tests/` renders with bare `renderToStaticMarkup` — no DOM environment,
 * and per the no-new-dependencies constraint, no `happy-dom` or
 * `@testing-library/react` to construct one — so there is no ancestor tree to
 * provide either context. The try/catch keeps the static-render path from
 * crashing on a hook that will always resolve once mounted for real.
 */
export function FacebookPublishButton({
  draftId,
  configured,
  pageName,
}: {
  draftId: string;
  configured: boolean;
  pageName: string | null;
}) {
  let router: ReturnType<typeof useRouter> | null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- guarded for the providerless static-render test harness; see doc comment above.
    router = useRouter();
  } catch {
    router = null;
  }
  let m: ReturnType<typeof useMessages>;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- guarded for the providerless static-render test harness; see doc comment above.
    m = useMessages();
  } catch {
    m = en;
  }
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (!configured) {
    return (
      <div className="space-y-2">
        <Button disabled>{m.drafts.publishFacebook}</Button>
        <p className="text-sm text-muted-foreground">{m.drafts.facebookUnavailable}</p>
      </div>
    );
  }

  async function publish() {
    setPending(true);
    setError('');
    const res = await fetch(`/api/drafts/${draftId}/publish/facebook`, { method: 'POST' });
    setPending(false);
    setConfirming(false);
    if (res.ok) {
      // The server now holds the post url, so the page re-renders into a link.
      // `router` is only null in the providerless test harness, which never
      // fires this click handler.
      router?.refresh();
      return;
    }
    setError(await errorMessage(res, m.errors.facebookPublishFailed, m));
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{m.drafts.confirmFacebook(pageName ?? '')}</span>
          <Button onClick={publish} disabled={pending}>
            {pending ? m.drafts.publishingFacebook : m.drafts.confirmFacebookPost}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            {m.drafts.confirmFacebookCancel}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>{m.drafts.publishFacebook}</Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
