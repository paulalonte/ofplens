/**
 * A scripted stand-in for the Claude Messages API, used through the real SDK via its `fetch`
 * option: each request gets the next scripted reply, and every request body is kept.
 * Test-only.
 */
export interface FakeReply {
  content: unknown[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface FakeClaude {
  fetch: typeof globalThis.fetch;
  /** Parsed JSON bodies of the requests, in order. */
  requests: Record<string, unknown>[];
}

export function fakeClaude(
  replies: (FakeReply | { status: number; error: { type: string; message: string } })[],
): FakeClaude {
  const requests: Record<string, unknown>[] = [];
  const fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : '{}';
    requests.push(JSON.parse(body) as Record<string, unknown>);
    const reply = replies.shift();
    if (!reply) throw new Error('fakeClaude: more requests than scripted replies');
    if ('status' in reply) {
      return Promise.resolve(
        new Response(JSON.stringify({ type: 'error', error: reply.error }), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    const message = {
      id: `msg_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: (requests.at(-1)!.model as string | undefined) ?? 'claude-haiku-5-5',
      content: reply.content,
      stop_reason: reply.stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: reply.usage?.input_tokens ?? 1000,
        output_tokens: reply.usage?.output_tokens ?? 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    return Promise.resolve(
      new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json' } }),
    );
  };
  return { fetch, requests };
}

/** An assistant turn calling the given tools (no input: the tools are bound to the plan). */
export const callTools = (...names: string[]): FakeReply => ({
  content: names.map((name, i) => ({
    type: 'tool_use',
    id: `toolu_${name}_${i}`,
    name,
    input: {},
  })),
  stop_reason: 'tool_use',
});

/** The final assistant turn: the briefing as JSON text. */
export const answer = (briefing: unknown, usage?: FakeReply['usage']): FakeReply => ({
  content: [{ type: 'text', text: JSON.stringify(briefing) }],
  stop_reason: 'end_turn',
  ...(usage && { usage }),
});
