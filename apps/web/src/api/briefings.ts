import {
  BriefingEvent,
  LatestBriefingResponse,
  type StoredBriefing,
} from '@ofplens/agent/contract';
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiFetch } from './client';

const briefingsPath = (planId: string) =>
  `/api/flight-plans/${encodeURIComponent(planId)}/briefings`;

/** The plan's most recent AI briefing (done, failed or still running), or null. */
export const latestBriefingQuery = (planId: string) =>
  queryOptions({
    queryKey: ['flight-plans', 'detail', planId, 'briefing'],
    queryFn: () => apiFetch(`${briefingsPath(planId)}/latest`, LatestBriefingResponse),
  });

export function useLatestBriefing(planId: string): StoredBriefing | null {
  return useSuspenseQuery(latestBriefingQuery(planId)).data.briefing;
}

/** A tool call the agent made, as streamed: name and whether it worked. */
export interface BriefingStep {
  name: string;
  ok: boolean;
}

/**
 * Starts a briefing and follows its Server-Sent Events. Calls `onTool` per tool call and resolves
 * with the stored briefing (done or failed). Errors before the stream starts (503, 404, 429, 409)
 * throw ApiError with the API's own message.
 */
export async function generateBriefing(
  planId: string,
  onTool: (step: BriefingStep) => void,
): Promise<StoredBriefing> {
  let res: Response;
  try {
    res = await fetch(briefingsPath(planId), {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API');
  }
  if (!res.ok || !res.body) {
    throw errorFrom(res.status, await res.text().catch(() => ''));
  }

  for await (const event of readEvents(res.body)) {
    if (event.event === 'tool') onTool(event.data);
    if (event.event === 'done' || event.event === 'failed') return event.data;
  }
  throw new ApiError(
    res.status,
    'STREAM_ENDED',
    'The briefing stopped before it finished. Try again.',
  );
}

function errorFrom(status: number, body: string): ApiError {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = parsed.error ?? {};
    if (typeof code === 'string' && typeof message === 'string') {
      return new ApiError(status, code, message);
    }
  } catch {
    // Not JSON: fall through.
  }
  return new ApiError(status, 'HTTP_ERROR', `Starting the briefing failed (${status})`);
}

/** Parses a text/event-stream body into validated briefing events; skips anything unknown. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<BriefingEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = parseBlock(block);
      if (event) yield event;
    }
    if (done) return;
  }
}

function parseBlock(block: string): BriefingEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  try {
    const payload: unknown = JSON.parse(data.join('\n'));
    const parsed = BriefingEvent.safeParse({ event: name, data: payload });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Generates a briefing for the plan. `steps` lists the tool calls of the current run as they
 * stream in; on finishing, the stored briefing replaces the plan's latest one in the cache.
 */
export function useGenerateBriefing(planId: string) {
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<BriefingStep[]>([]);
  const mutation = useMutation({
    mutationFn: () => {
      setSteps([]);
      return generateBriefing(planId, (step) => setSteps((prev) => [...prev, step]));
    },
    onSuccess: (briefing) =>
      queryClient.setQueryData(latestBriefingQuery(planId).queryKey, { briefing }),
  });
  return { ...mutation, steps };
}
