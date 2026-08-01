import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  type Activity,
  clearActivitySink,
  type ResolvedActivity,
  reportActivity,
  setActivitySink,
} from '../../src/activity';

let logSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  clearActivitySink('t1');
  clearActivitySink('t2');
});

const act = (detail: string): Activity => ({ step: 'strategist', kind: 'web_search', detail });

describe('activity registry', () => {
  test('forwards to the sink registered for that thread', () => {
    const seen: ResolvedActivity[] = [];
    setActivitySink('t1', (a) => seen.push(a));
    reportActivity('t1', act('1/10 "query"'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.detail).toBe('1/10 "query"');
  });

  test('keeps threads isolated', () => {
    const one: ResolvedActivity[] = [];
    const two: ResolvedActivity[] = [];
    setActivitySink('t1', (a) => one.push(a));
    setActivitySink('t2', (a) => two.push(a));
    reportActivity('t2', act('only t2'));
    expect(one).toHaveLength(0);
    expect(two).toHaveLength(1);
  });

  test('is a no-op for an unregistered or undefined thread', () => {
    // A tool can run outside a server-driven run (the CLI, a test) — reporting
    // must never be the thing that breaks the pipeline.
    expect(() => reportActivity('nobody', act('x'))).not.toThrow();
    expect(() => reportActivity(undefined, act('x'))).not.toThrow();
  });

  test('stops forwarding once cleared, so a finished run cannot leak', () => {
    const seen: ResolvedActivity[] = [];
    setActivitySink('t1', (a) => seen.push(a));
    clearActivitySink('t1');
    reportActivity('t1', act('after teardown'));
    expect(seen).toHaveLength(0);
  });

  test('a throwing sink cannot break the caller', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    setActivitySink('t1', () => {
      throw new Error('listener blew up');
    });
    expect(() => reportActivity('t1', act('x'))).not.toThrow();
    errSpy.mockRestore();
  });

  test('still writes the stdout line the server logs are built on', () => {
    reportActivity('t1', act('1/10 "query"'));
    expect(logSpy).toHaveBeenCalledWith('[web_search] 1/10 "query"');
  });

  describe('step inheritance', () => {
    // A tool cannot name its own step: langgraph_node reads 'tools' inside the
    // agent's inner graph, and searchTool serves both strategist and writer.
    // A live run put every web_search under step 'tools', which is not a
    // pipeline node, so the dashboard highlighted nothing while it researched.
    test('a tool inherits the step of the node that is running', () => {
      const seen: ResolvedActivity[] = [];
      setActivitySink('t1', (a) => seen.push(a));
      reportActivity('t1', { step: 'writer', kind: 'writing', detail: 'draft 1 of 5' });
      reportActivity('t1', { kind: 'web_search', detail: '1/10 "x"' });
      expect(seen.map((a) => a.step)).toEqual(['writer', 'writer']);
    });

    test('follows the pipeline as the step changes', () => {
      const seen: ResolvedActivity[] = [];
      setActivitySink('t1', (a) => seen.push(a));
      reportActivity('t1', { step: 'strategist', kind: 'planning', detail: 'x' });
      reportActivity('t1', { kind: 'web_search', detail: '1/10 "x"' });
      reportActivity('t1', { step: 'writer', kind: 'writing', detail: 'draft 1 of 5' });
      reportActivity('t1', { kind: 'web_search', detail: '2/10 "y"' });
      expect(seen.map((a) => a.step)).toEqual(['strategist', 'strategist', 'writer', 'writer']);
    });

    test('falls back to strategist when nothing has reported yet', () => {
      const seen: ResolvedActivity[] = [];
      setActivitySink('t1', (a) => seen.push(a));
      reportActivity('t1', { kind: 'web_search', detail: '1/10 "x"' });
      expect(seen[0]?.step).toBe('strategist');
    });

    test('does not carry a step across runs', () => {
      const seen: ResolvedActivity[] = [];
      setActivitySink('t1', () => {});
      reportActivity('t1', { step: 'editor', kind: 'reviewing', detail: 'pass 1 of 5' });
      clearActivitySink('t1');
      setActivitySink('t1', (a) => seen.push(a));
      reportActivity('t1', { kind: 'web_search', detail: '1/10 "x"' });
      expect(seen[0]?.step).toBe('strategist');
    });
  });

  test('routes failures to stderr so log filters keep working', () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    reportActivity('t1', { step: 'publisher', kind: 'publish_failed', detail: 'Notion 502' });
    expect(errSpy).toHaveBeenCalledWith('[publish_failed] Notion 502');
    expect(logSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
