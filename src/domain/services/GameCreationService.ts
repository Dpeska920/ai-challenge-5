import type { Conversation } from '../entities/Conversation';
import type { ConversationRepository } from '../repositories/ConversationRepository';
import type { AIProvider } from './AIProvider';
import type { LimitService } from './LimitService';
import type { User } from '../entities/User';
import { addMessage, deactivateConversation } from '../entities/Conversation';
import { log } from '../../utils/logger';
import { GAMECREATION_SYSTEM_PROMPT } from '../../application/commands/GameCreationCommand';

interface GameCreationCollecting {
  status: 'collecting';
  message: string;
}

interface GameCreationComplete {
  status: 'complete';
  game: {
    genre: string;
    plot: string;
    gameplay: string;
  };
}

type GameCreationResponse = GameCreationCollecting | GameCreationComplete;

function isValidGameCreationResponse(data: unknown): data is GameCreationResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;

  if (obj.status === 'collecting') {
    return typeof obj.message === 'string';
  }

  if (obj.status === 'complete') {
    const game = obj.game as Record<string, unknown> | undefined;
    return (
      typeof game === 'object' &&
      game !== null &&
      typeof game.genre === 'string' &&
      typeof game.plot === 'string' &&
      typeof game.gameplay === 'string'
    );
  }

  return false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface GameCreationResult {
  response: string;
  parseMode?: 'HTML' | 'MarkdownV2';
  isComplete: boolean;
  user: User;
  conversation: Conversation;
}

export class GameCreationService {
  constructor(
    private conversationRepo: ConversationRepository,
    private aiProvider: AIProvider,
    private limitService: LimitService
  ) {}

  async processMessage(
    user: User,
    conversation: Conversation,
    message: string
  ): Promise<GameCreationResult> {
    // Add user message to conversation
    let updatedConversation = addMessage(conversation, 'user', message);

    // Get AI response with special prompt and json_object format
    const aiResponse = await this.aiProvider.chatWithOptions(
      updatedConversation.messages,
      {
        systemPrompt: GAMECREATION_SYSTEM_PROMPT,
        responseFormat: 'json_object',
        temperature: 0.7,
      }
    );

    // Parse JSON response
    let parsedResponse: GameCreationResponse;
    try {
      const data = JSON.parse(aiResponse.content);
      if (!isValidGameCreationResponse(data)) {
        throw new Error('Invalid response structure');
      }
      parsedResponse = data;
    } catch (error) {
      log('error', 'Failed to parse gamecreation response', {
        response: aiResponse.content,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback - ask user to try again
      return {
        response: 'Произошла ошибка при обработке. Попробуйте переформулировать свой ответ.',
        isComplete: false,
        user,
        conversation: updatedConversation,
      };
    }

    // Add AI response to conversation
    updatedConversation = addMessage(updatedConversation, 'assistant', aiResponse.content);

    // Increment usage
    const updatedUser = await this.limitService.incrementAndSave(user);

    if (parsedResponse.status === 'collecting') {
      // Still collecting - save conversation and return message
      await this.conversationRepo.update(updatedConversation);
      return {
        response: parsedResponse.message,
        isComplete: false,
        user: updatedUser,
        conversation: updatedConversation,
      };
    }

    // Complete - deactivate conversation and return formatted JSON
    const deactivated = deactivateConversation(updatedConversation);
    await this.conversationRepo.update(deactivated);

    const gameJson = JSON.stringify(parsedResponse.game, null, 2);
    const formattedResponse = `✅ *Концепция игры готова\\!*

\`\`\`json
${escapeHtml(gameJson)}
\`\`\`

Диалог завершён\\. Используйте /gamecreation чтобы создать новую концепцию\\.`;

    log('info', 'GameCreation completed', {
      telegramId: conversation.telegramId,
      game: parsedResponse.game,
    });

    return {
      response: formattedResponse,
      parseMode: 'MarkdownV2',
      isComplete: true,
      user: updatedUser,
      conversation: deactivated,
    };
  }
}
