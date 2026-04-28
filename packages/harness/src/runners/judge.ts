import type { SatisfactionResult } from '../types.js';

export interface ScenarioContext {
  id: string;
  given: string;
  when: string;
  then: string;
  /**
   * The artifact the judge scores against. For v0.0.1 this is the spec body
   * (everything after frontmatter). Richer artifacts arrive with later layers.
   */
  artifact: string;
}

export interface Judgment {
  pass: boolean;
  score: number;
  reasoning: string;
}

export interface JudgeClient {
  judge(args: {
    criterion: string;
    scenario: { id: string; given: string; when: string; then: string };
    artifact: string;
    model: string;
    timeoutMs: number;
  }): Promise<Judgment>;
}

export interface JudgeRunnerOptions {
  client: JudgeClient;
  model: string;
  timeoutMs: number;
}

const SYSTEM_PROMPT = [
  'You are an LLM-as-judge for software factory specs.',
  'You receive a scenario in Given/When/Then form, an artifact (e.g. the spec body),',
  'and a single fuzzy criterion. Decide whether the criterion is met by the artifact',
  'in the context of the scenario, then call the `record_judgment` tool with',
  '`pass` (boolean), `score` (0..1), and `reasoning` (one or two sentences).',
  'Be strict: only `pass: true` if the criterion is clearly satisfied. When',
  'evidence is mixed or absent, prefer `pass: false` with a short reasoning.',
].join(' ');

export const RECORD_JUDGMENT_TOOL = {
  name: 'record_judgment',
  description: 'Record a structured judgment of whether the criterion is met.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pass: { type: 'boolean' as const },
      score: { type: 'number' as const, minimum: 0, maximum: 1 },
      reasoning: { type: 'string' as const, minLength: 1 },
    },
    required: ['pass', 'score', 'reasoning'] as const,
  },
};

function validateJudgment(value: unknown): Judgment {
  if (typeof value !== 'object' || value === null) {
    throw new Error('judge/malformed-response: tool input is not an object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.pass !== 'boolean') {
    throw new Error('judge/malformed-response: missing or non-boolean `pass`');
  }
  if (typeof v.score !== 'number' || v.score < 0 || v.score > 1 || Number.isNaN(v.score)) {
    throw new Error('judge/malformed-response: missing or out-of-range `score`');
  }
  if (typeof v.reasoning !== 'string' || v.reasoning.length === 0) {
    throw new Error('judge/malformed-response: missing or empty `reasoning`');
  }
  return { pass: v.pass, score: v.score, reasoning: v.reasoning };
}

interface AnthropicLike {
  messages: {
    create(args: unknown): Promise<{
      content: Array<
        | { type: 'tool_use'; name: string; input: unknown }
        | { type: 'text'; text: string }
        | { type: string }
      >;
    }>;
  };
}

/**
 * Wrap an Anthropic SDK client into a `JudgeClient`. Used by the default
 * factory; exposed for callers that want to reuse an existing SDK instance.
 */
export function anthropicJudgeClient(client: AnthropicLike): JudgeClient {
  return {
    async judge({ criterion, scenario, artifact, model, timeoutMs }) {
      const userText = [
        `Scenario: ${scenario.id}`,
        `Given: ${scenario.given}`,
        `When: ${scenario.when}`,
        `Then: ${scenario.then}`,
        '',
        'Criterion:',
        criterion,
        '',
        'Artifact:',
        artifact,
      ].join('\n');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Awaited<ReturnType<AnthropicLike['messages']['create']>>;
      try {
        response = await client.messages.create({
          model,
          max_tokens: 1024,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: [RECORD_JUDGMENT_TOOL],
          tool_choice: { type: 'tool', name: RECORD_JUDGMENT_TOOL.name },
          messages: [{ role: 'user', content: userText }],
          // SDK accepts AbortSignal at runtime; AnthropicLike intentionally
          // types `args` as unknown so the passthrough is type-safe here.
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const toolUse = response.content.find(
        (block): block is { type: 'tool_use'; name: string; input: unknown } =>
          block.type === 'tool_use' && 'name' in block && block.name === RECORD_JUDGMENT_TOOL.name,
      );
      if (!toolUse) {
        throw new Error('judge/malformed-response: model did not call record_judgment');
      }
      return validateJudgment(toolUse.input);
    },
  };
}

/**
 * Build the default Anthropic-backed JudgeClient. Lazily imports the SDK so
 * harness consumers that only use a custom client never pay the import cost.
 * Throws if `ANTHROPIC_API_KEY` is unset — callers should detect this earlier
 * via `runHarness`'s prerequisite check.
 */
export async function createDefaultJudgeClient(): Promise<JudgeClient> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new Error('runner/missing-api-key: ANTHROPIC_API_KEY is not set');
  }
  const mod = (await import('@anthropic-ai/sdk')) as unknown as {
    default: new (opts: { apiKey: string }) => AnthropicLike;
  };
  const client = new mod.default({ apiKey });
  return anthropicJudgeClient(client);
}

/**
 * Run a single `judge:` satisfaction. Never throws on operational failures —
 * malformed responses, timeouts, and SDK errors all surface as `status: 'error'`.
 */
export async function runJudgeSatisfaction(
  satisfaction: { kind: 'judge'; value: string; line: number },
  scenario: ScenarioContext,
  opts: JudgeRunnerOptions,
): Promise<SatisfactionResult> {
  const startedAt = performance.now();
  try {
    const judgment = await opts.client.judge({
      criterion: satisfaction.value,
      scenario: {
        id: scenario.id,
        given: scenario.given,
        when: scenario.when,
        then: scenario.then,
      },
      artifact: scenario.artifact,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
    });
    return {
      kind: 'judge',
      value: satisfaction.value,
      line: satisfaction.line,
      status: judgment.pass ? 'pass' : 'fail',
      durationMs: Math.round(performance.now() - startedAt),
      detail: judgment.reasoning,
      score: judgment.score,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      message.startsWith('judge/') || message.startsWith('runner/')
        ? message
        : `judge/error: ${message}`;
    return {
      kind: 'judge',
      value: satisfaction.value,
      line: satisfaction.line,
      status: 'error',
      durationMs: Math.round(performance.now() - startedAt),
      detail: code,
    };
  }
}
