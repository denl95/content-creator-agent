'use client';

import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Brand } from '@/lib/types';

const CHANNELS = ['blog', 'linkedin', 'twitter', 'instagram', 'threads'];

/** Defaults to Ukrainian because the shipped brand corpus in data/brand is Ukrainian. */
const LANGUAGES = [
  { value: 'uk', label: 'Українська' },
  { value: 'en', label: 'English' },
];

const FIELD = 'rounded-md border bg-transparent px-3 py-2';
const LABEL = 'flex flex-col gap-1 text-sm';

/**
 * The brief a run starts from. Pure markup — it owns no run state, so it lives
 * apart from the page's stream/error state machine and re-renders only when
 * `running` flips.
 */
export function BriefForm({
  running,
  brands,
  onSubmit,
}: {
  running: boolean;
  /**
   * Default brand first, so the initial selection needs no extra logic.
   * `null` means still loading — distinct from an empty list, which means the
   * brands request failed or there are genuinely none.
   */
  brands: Brand[] | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL}>
            Topic
            <input
              name="topic"
              required
              defaultValue="Як LLM-асистент замінив менеджера підтримки"
              className={FIELD}
            />
          </label>
          <label className={LABEL}>
            Channel
            <select name="channel" className={FIELD}>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Tone
            <input name="tone" required defaultValue="доступний" className={FIELD} />
          </label>
          <label className={LABEL}>
            Audience
            <input
              name="target_audience"
              required
              defaultValue="власники малого бізнесу"
              className={FIELD}
            />
          </label>
          <label className={LABEL}>
            Word count
            <input name="word_count" type="number" required defaultValue={800} className={FIELD} />
          </label>
          <label className={LABEL}>
            Brand
            <select
              name="brand_id"
              className={FIELD}
              disabled={!brands || brands.length === 0}
              required
            >
              {brands === null ? (
                <option value="">Loading…</option>
              ) : brands.length === 0 ? (
                <option value="">No brands available</option>
              ) : (
                brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                    {brand.is_default ? ' (default)' : ''}
                  </option>
                ))
              )}
            </select>
            {brands?.length === 0 ? (
              <span className="text-xs text-red-600">
                Could not load brands. Every run needs one — check you are signed in, or{' '}
                <a href="/brands/new" className="underline">
                  ingest a brand
                </a>
                .
              </span>
            ) : null}
          </label>
          <label className={LABEL}>
            Language
            <select name="language" className={FIELD}>
              {LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={running} className="w-full">
              {running ? 'Running…' : 'Generate'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
