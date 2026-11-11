import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { Briefing } from './briefing';
import { costUsd, DEFAULT_BRIEFING_CONFIG, type BriefingConfig } from './config';
import { checkBriefing, collectEvidence, type ToolCallRecord } from './guardrails';
import { PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT } from './prompt';
import { briefingTools, ToolError, type ToolDeps } from './tools';

export interface BriefingRunInfo {
  model: string;
  promptVersion: string;
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  /** USD; null when the model is not in the price table. */
  costUsd: number | null;
  latencyMs: number;
  /** API requests made. */
  turns: number;
}

export type BriefingRun = BriefingRunInfo &
  (
    | { status: 'done'; briefing: Briefing }
    | {
        status: 'failed';
        error: string;
        /** The schema-valid briefing the guardrails rejected, kept for evals; never shown. */
        rejectedBriefing?: Briefing;
      }
  );

export class BriefingPlanNotFoundError extends Error {
  constructor(id: string) {
    super(`No flight plan with id ${id}`);
    this.name = 'BriefingPlanNotFoundError';
  }
}

export interface RunBriefingOptions {
  client: Anthropic;
  deps: ToolDeps;
  config?: Partial<BriefingConfig>;
  /** Called after each tool call, e.g. to stream progress to the browser. */
  onToolCall?: (call: ToolCallRecord) => void;
}

/**
 * Runs the briefing agent for one flight plan: Claude reads the plan and its weather through the
 * tools (bound to this plan, so it cannot ask for another), answers with a Briefing, and the
 * guardrails check every label and citation against what the tools returned.
 *
 * Never throws for a bad briefing or an API failure: those come back as `failed` with the reason,
 * to be stored. Throws BriefingPlanNotFoundError before calling Claude when the plan is unknown.
 */
export async function runBriefing(
  flightPlanId: string,
  { client, deps, config, onToolCall }: RunBriefingOptions,
): Promise<BriefingRun> {
  const cfg = { ...DEFAULT_BRIEFING_CONFIG, ...config };
  if (!(await deps.flightPlans.get(flightPlanId)))
    throw new BriefingPlanNotFoundError(flightPlanId);

  const started = Date.now();
  const toolCalls: ToolCallRecord[] = [];
  // Counted when a call starts: parallel calls run concurrently, so finished calls lag behind.
  let toolCallsStarted = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let turns = 0;

  const info = (): BriefingRunInfo => ({
    model: cfg.model,
    promptVersion: PROMPT_VERSION,
    toolCalls,
    inputTokens,
    outputTokens,
    costUsd: costUsd(cfg.model, inputTokens, outputTokens),
    latencyMs: Date.now() - started,
    turns,
  });
  const failed = (error: string): BriefingRun => ({ ...info(), status: 'failed', error });

  const record = (call: ToolCallRecord) => {
    toolCalls.push(call);
    onToolCall?.(call);
  };

  const tools = briefingTools.map((tool) =>
    betaZodTool({
      name: tool.name,
      description: tool.description,
      // Bound to this plan: the model passes nothing.
      inputSchema: z.object({}),
      run: async () => {
        const callStarted = Date.now();
        if (toolCallsStarted >= cfg.maxToolCalls) {
          record({ name: tool.name, ok: false, error: 'tool call limit', ms: 0 });
          throw new ToolError('Tool call limit reached. Answer with what you have.');
        }
        toolCallsStarted += 1;
        try {
          const output = await tool.run({ flightPlanId }, deps);
          record({ name: tool.name, ok: true, output, ms: Date.now() - callStarted });
          return JSON.stringify(output);
        } catch (err) {
          const message = err instanceof ToolError ? err.message : 'The tool failed unexpectedly.';
          record({ name: tool.name, ok: false, error: message, ms: Date.now() - callStarted });
          throw new ToolError(message);
        }
      },
    }),
  );

  let final: Anthropic.Beta.BetaMessage | undefined;
  try {
    const runner = client.beta.messages.toolRunner({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      max_iterations: cfg.maxTurns,
      // Self-contained requests: the full history each turn, no server-side thread.
      thread: false,
      system: SYSTEM_PROMPT,
      tools,
      output_config: { effort: cfg.effort, format: betaZodOutputFormat(Briefing) },
      messages: [{ role: 'user', content: USER_PROMPT }],
    });
    for await (const message of runner) {
      turns += 1;
      inputTokens +=
        message.usage.input_tokens +
        (message.usage.cache_creation_input_tokens ?? 0) +
        (message.usage.cache_read_input_tokens ?? 0);
      outputTokens += message.usage.output_tokens;
      final = message;
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return failed(`Claude API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
    }
    return failed(`Briefing run failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!final) return failed('Claude returned no answer.');
  switch (final.stop_reason) {
    case 'end_turn':
      break;
    case 'refusal':
      return failed('Claude declined to write this briefing (refusal).');
    case 'max_tokens':
      return failed('The briefing was cut off (max_tokens).');
    case 'tool_use':
      return failed(`No briefing after ${cfg.maxTurns} turns (still calling tools).`);
    default:
      return failed(`Unexpected stop reason: ${final.stop_reason ?? 'none'}.`);
  }

  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failed('Claude did not answer with JSON.');
  }
  const parsed = Briefing.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return failed(`The briefing does not match the schema: ${issues.join('; ')}`);
  }

  const problems = checkBriefing(parsed.data, collectEvidence(toolCalls));
  if (problems.length > 0) {
    return {
      ...info(),
      status: 'failed',
      error: `Guardrails rejected the briefing: ${problems.join(' ')}`,
      rejectedBriefing: parsed.data,
    };
  }

  return { ...info(), status: 'done', briefing: parsed.data };
}
