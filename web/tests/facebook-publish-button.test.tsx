import { describe, expect, test } from 'bun:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacebookPublishButton } from '../components/facebook-publish-button';
import en from '../i18n/messages/en';
import { MessagesProvider } from '../i18n/provider';

// Only `refresh` is ever called; the rest satisfy the context's type.
const routerStub = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

const render = (props: { draftId: string; configured: boolean; pageName: string | null }) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={routerStub as never}>
      <MessagesProvider locale="en">
        <FacebookPublishButton {...props} />
      </MessagesProvider>
    </AppRouterContext.Provider>,
  );

describe('FacebookPublishButton', () => {
  // Assert the `disabled=""` attribute, never the bare word: the shadcn Button's
  // base class string contains `disabled:pointer-events-none disabled:opacity-50`,
  // so `toContain('disabled')` passes for every render and asserts nothing.
  test('offers the publish action when Facebook is configured', () => {
    const html = render({ draftId: 'd1', configured: true, pageName: 'EONYX' });
    expect(html).toContain(en.drafts.publishFacebook);
    expect(html).not.toContain('disabled=""');
  });

  test('is disabled and explains itself when Facebook is unconfigured', () => {
    const html = render({ draftId: 'd1', configured: false, pageName: null });
    expect(html).toContain('disabled=""');
    expect(html).toContain(en.drafts.facebookUnavailable);
  });

  test('does not show the confirmation until the button is pressed', () => {
    const html = render({ draftId: 'd1', configured: true, pageName: 'EONYX' });
    expect(html).not.toContain(en.drafts.confirmFacebook('EONYX'));
  });
});
