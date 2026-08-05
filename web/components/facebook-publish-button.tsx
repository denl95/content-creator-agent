'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
  const router = useRouter();
  const m = useMessages();
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
      router.refresh();
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
