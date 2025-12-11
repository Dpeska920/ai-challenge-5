import type { Command, CommandContext } from './CommandHandler';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import type { AIProvider } from '../../domain/services/AIProvider';
import type { LimitService } from '../../domain/services/LimitService';
import {
  createNewConversation,
  addMessage,
  deactivateConversation,
} from '../../domain/entities/Conversation';
import { log } from '../../utils/logger';

const SUMMARIZATION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes conversations. Your task is to create a concise but comprehensive summary of the conversation history provided.

The summary should:
1. Capture the main topics discussed
2. Preserve important details, names, facts, and decisions
3. Maintain the context needed for continuing the conversation
4. Be written in the same language as the original conversation
5. Be structured and easy to understand

Format the summary as a clear narrative that can serve as context for future conversation.`;

export class CompactCommand implements Command {
  name = 'compact';
  description = 'Summarize current conversation and start fresh with context';

  constructor(
    private conversationRepo: ConversationRepository,
    private aiProvider: AIProvider,
    private limitService: LimitService
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { telegramId, sendMessage, args, user } = ctx;

    // Get active conversation
    const conversation = await this.conversationRepo.findActiveByTelegramId(telegramId);

    if (!conversation || conversation.messages.length === 0) {
      await sendMessage('No active conversation to summarize. Start chatting first.');
      return;
    }

    // Check if there are enough messages to summarize
    if (conversation.messages.length < 2) {
      await sendMessage('Not enough messages to summarize. Continue the conversation first.');
      return;
    }

    // Check limits
    const { checkResult: limitCheck } = await this.limitService.checkAndResetLimits(user);
    if (!limitCheck.allowed) {
      await sendMessage(this.limitService.formatLimitError(limitCheck));
      return;
    }

    await sendMessage('Summarizing conversation...');

    try {
      // Build summarization prompt
      const userPromptAddition = args.length > 0 ? args.join(' ') : '';
      const messagesText = conversation.messages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n\n');

      let summarizationRequest = `Please summarize the following conversation:\n\n${messagesText}`;

      if (userPromptAddition) {
        summarizationRequest += `\n\nAdditional instructions from user: ${userPromptAddition}`;
      }

      // Get summary from AI
      const summary = await this.aiProvider.singleRequest({
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
        userMessage: summarizationRequest,
        temperature: 0.3,
        maxTokens: 1000,
      });

      // Deactivate current conversation
      const deactivated = deactivateConversation(conversation);
      await this.conversationRepo.update(deactivated);

      // Create new conversation with summary as first system message
      const newConversationData = createNewConversation(telegramId, 'chat');
      const createdConversation = await this.conversationRepo.create(newConversationData);

      // Add summary as system message
      const conversationWithContext = addMessage(
        createdConversation,
        'system',
        `Previous conversation summary:\n${summary}`
      );

      // Update with the system message
      await this.conversationRepo.update(conversationWithContext);

      // Increment usage
      await this.limitService.incrementAndSave(user);

      log('info', 'Conversation compacted', {
        telegramId,
        originalMessages: conversation.messages.length,
        summaryLength: summary.length,
      });

      await sendMessage(
        `✓ Conversation summarized and archived.\n\nSummary saved as context for the new conversation:\n\n---\n${summary}\n\n---\n\nYou can continue chatting. The AI will remember this context.`
      );
    } catch (error) {
      log('error', 'Error compacting conversation', {
        telegramId,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendMessage('Error occurred while summarizing. Please try again later.');
    }
  }
}
