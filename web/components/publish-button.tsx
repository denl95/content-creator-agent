'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/i18n/provider';
import { errorMessage } from '@/lib/errors';

export function PublishButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const m = useMessages();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function publish() {
    setPending(true);
    setError('');
    const res = await fetch(`/api/drafts/${draftId}/publish`, { method: 'POST' });
    setPending(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    setError(await errorMessage(res, m.errors.publishFailed, m));
  }

  return (
    <div className="space-y-2">
      <Button onClick={publish} disabled={pending}>
        {pending ? m.drafts.publishing : m.drafts.publish}
      </Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
