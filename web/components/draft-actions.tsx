'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/i18n/provider';
import { slugifyTopic } from '@/lib/format';

/**
 * Copy and download for a draft. A client island because both the clipboard
 * and a Blob download need the browser — the page itself is a Server Component.
 *
 * Rendering markdown removed the reader's ability to select the source, so
 * these are part of that change rather than an extra.
 */
export function DraftActions({
  topic,
  id,
  content,
}: {
  topic: string;
  id: string;
  content: string;
}) {
  const m = useMessages();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const filename = `${slugifyTopic(topic) || 'draft'}-${id.slice(0, 8)}.md`;

  async function copy() {
    setState('idle');
    try {
      // The markdown source, not the rendered text: the point is pasting into
      // a CMS or editor.
      await navigator.clipboard.writeText(content);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (error) {
      // navigator.clipboard is undefined on non-secure origins other than
      // localhost, so this is a real path rather than defensive noise.
      console.error('clipboard write failed', error);
      setState('failed');
    }
  }

  function download() {
    setState('idle');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Deferred: revoking synchronously races the browser's own fetch of the
    // blob URL to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          {state === 'copied' ? m.drafts.copied : m.drafts.copy}
        </Button>
        <Button variant="secondary" onClick={download}>
          {m.drafts.download}
        </Button>
      </div>
      {state === 'failed' ? (
        <p className="text-sm text-destructive">{m.drafts.copyFailed}</p>
      ) : null}
    </div>
  );
}
