import { describe, expect, test } from 'bun:test';
import { builder } from '../../src/graphBuilder';

/**
 * The content pipeline's shape, pinned where it is a product decision rather
 * than an implementation detail.
 *
 * Publishing used to be the last node, so finishing a run created a Notion page
 * as a side effect. It is now one action on one draft
 * (`POST /drafts/:id/publish`). A run costs money and a publish creates
 * something a client can see; putting both behind one keystroke was the bug.
 *
 * Imports `graphBuilder`, not `graph`: `runManagerActivity` mocks the latter
 * with `mock.module`, which bun applies process-wide, so asserting through
 * `graph` passes alone and fails in the full suite.
 */
describe('content graph', () => {
  const compiled = builder.compile().getGraph();
  const nodes = Object.keys(compiled.nodes);
  const edges = compiled.edges.map((e) => [e.source, e.target]);

  test('has no publisher node — a run never publishes', () => {
    expect(nodes).not.toContain('publisher');
  });

  test('ends at the finalizer', () => {
    expect(nodes).toContain('finalizer');
    expect(edges).toContainEqual(['finalizer', '__end__']);
  });

  test('still runs strategist, the approval gate, and the writer/editor loop', () => {
    expect(nodes).toEqual(
      expect.arrayContaining(['strategist', 'hitl', 'writer', 'editor', 'finalizer']),
    );
    // The evaluator-optimizer loop: the editor can send work back to the writer.
    expect(edges).toContainEqual(['editor', 'writer']);
  });
});
