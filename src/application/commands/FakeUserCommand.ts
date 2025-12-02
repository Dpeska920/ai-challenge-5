import type { Command, CommandContext } from './CommandHandler';
import type { AIProvider } from '../../domain/services/AIProvider';
import type { LimitService } from '../../domain/services/LimitService';
import { log } from '../../utils/logger';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const FAKEUSER_PROMPT = `You are a fake user profile generator. Respond with a valid JSON object in this EXACT format:

{"first_name": "string", "last_name": "string", "age": "string", "desc": "string"}

Rules:
- Generate exactly ONE user profile
- first_name: realistic first name
- last_name: realistic last name
- age: realistic age as string (e.g., "23")
- desc: 1-2 sentence first-person bio

Language rules:
- Default: English for all fields
- If user specifies nationality/language (e.g., "русский", "japanese", "french"), ALL fields must be in that language
- Names must match the culture/nationality
- desc must be in the same language as names

If user provides context (gender, traits, hobbies, age range), incorporate it naturally.

Return ONLY the raw JSON object. No markdown code blocks, no explanation, no extra text.`;

interface FakeUserProfile {
  first_name: string;
  last_name: string;
  age: string;
  desc: string;
}

function isValidFakeUserProfile(data: unknown): data is FakeUserProfile {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.first_name === 'string' &&
    typeof obj.last_name === 'string' &&
    typeof obj.age === 'string' &&
    typeof obj.desc === 'string'
  );
}

export class FakeUserCommand implements Command {
  name = 'fakeuser';
  description = 'Generate a fake user profile via AI';

  constructor(
    private aiProvider: AIProvider,
    private limitService: LimitService
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    // 1. Check limits before making AI request
    const { user, checkResult } = await this.limitService.checkAndResetLimits(ctx.user);

    if (!checkResult.allowed) {
      const errorMessage = this.limitService.formatLimitError(checkResult);
      await ctx.sendMessage(errorMessage);
      return;
    }

    // 2. Build context from args
    const userContext = ctx.args.join(' ').trim();
    const userMessage = userContext || 'Generate a fake user profile';

    try {
      // 3. Make AI request with json_object format
      const response = await this.aiProvider.singleRequest({
        systemPrompt: FAKEUSER_PROMPT,
        userMessage,
        responseFormat: 'json_object',
        temperature: 0.9, // Higher temperature for more creative profiles
      });

      // 4. Parse JSON response
      let profileData: unknown;
      try {
        profileData = JSON.parse(response);
      } catch (parseError) {
        log('error', 'Failed to parse fakeuser JSON response', {
          response,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        await ctx.sendMessage('Error: AI returned invalid JSON. Please try again.');
        return;
      }

      // Validate the profile structure
      if (!isValidFakeUserProfile(profileData)) {
        log('error', 'Invalid fakeuser profile structure', { profileData });
        await ctx.sendMessage('Error: AI returned invalid profile format. Please try again.');
        return;
      }

      // 5. Send result in code block (HTML format)
      const jsonString = JSON.stringify(profileData);
      const formattedResponse = `<code>${escapeHtml(jsonString)}</code>`;
      await ctx.sendMessage(formattedResponse, { parseMode: 'HTML' });

      // 6. Increment usage counters
      await this.limitService.incrementAndSave(user);
    } catch (error) {
      log('error', 'FakeUserCommand execution error', {
        error: error instanceof Error ? error.message : String(error),
        telegramId: ctx.telegramId,
      });
      await ctx.sendMessage('Error generating fake user profile. Please try again later.');
    }
  }
}
