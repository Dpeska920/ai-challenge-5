import { ObjectId } from 'mongodb';

export interface UserLimits {
  daily: number | null;    // null = unlimited
  monthly: number | null;
  total: number | null;
}

export interface UserUsage {
  dailyUsed: number;
  monthlyUsed: number;
  totalUsed: number;
  lastDailyReset: Date;
  lastMonthlyReset: Date;
}

export type ChatResponseFormat = 'text' | 'json_object';

export type RerankMode = 'off' | 'cross' | 'llm';

export interface UserChatSettings {
  temperature: number | null;      // null = use default from config
  systemPrompt: string | null;     // null = use default from config
  maxTokens: number | null;        // null = use default from config
  responseFormat: ChatResponseFormat | null;  // null = use default from config
  model: string | null;            // null = use default provider, otherwise use OpenRouter with this model
  rerankMode: RerankMode | null;   // null = 'off', RAG reranking mode
  githubRepo: string | null;       // null = no repo selected, format: "owner/repo"
}

export interface UserProfile {
  location: string | null;         // User's location (city, region, etc)
  timezone: string | null;         // User's timezone (e.g., Europe/Moscow)
  personalization: string | null;  // User's personal info (profession, preferences, etc)
}

export interface User {
  _id: ObjectId;
  telegramId: number;
  username?: string;
  firstName?: string;
  isActivated: boolean;
  limits: UserLimits;
  usage: UserUsage;
  chatSettings?: UserChatSettings;  // Optional for backwards compatibility with existing users
  profile?: UserProfile;            // Optional for backwards compatibility with existing users
  createdAt: Date;
  updatedAt: Date;
}

export function createNewUser(telegramId: number, username?: string, firstName?: string): Omit<User, '_id'> {
  const now = new Date();
  return {
    telegramId,
    username,
    firstName,
    isActivated: false,
    limits: {
      daily: null,
      monthly: null,
      total: null,
    },
    usage: {
      dailyUsed: 0,
      monthlyUsed: 0,
      totalUsed: 0,
      lastDailyReset: now,
      lastMonthlyReset: now,
    },
    chatSettings: {
      temperature: null,
      systemPrompt: null,
      maxTokens: null,
      responseFormat: null,
      model: null,
      rerankMode: null,
      githubRepo: null,
    },
    profile: {
      location: null,
      timezone: null,
      personalization: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function activateUser(user: User, limits: UserLimits): User {
  return {
    ...user,
    isActivated: true,
    limits,
    updatedAt: new Date(),
  };
}

export function incrementUsage(user: User): User {
  return {
    ...user,
    usage: {
      ...user.usage,
      dailyUsed: user.usage.dailyUsed + 1,
      monthlyUsed: user.usage.monthlyUsed + 1,
      totalUsed: user.usage.totalUsed + 1,
    },
    updatedAt: new Date(),
  };
}

export function resetDailyUsage(user: User): User {
  return {
    ...user,
    usage: {
      ...user.usage,
      dailyUsed: 0,
      lastDailyReset: new Date(),
    },
    updatedAt: new Date(),
  };
}

export function resetMonthlyUsage(user: User): User {
  return {
    ...user,
    usage: {
      ...user.usage,
      monthlyUsed: 0,
      lastMonthlyReset: new Date(),
    },
    updatedAt: new Date(),
  };
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: 'daily' | 'monthly' | 'total';
  limit?: number;
  used?: number;
}

export function checkLimits(user: User): LimitCheckResult {
  const { limits, usage } = user;

  if (limits.daily !== null && usage.dailyUsed >= limits.daily) {
    return { allowed: false, reason: 'daily', limit: limits.daily, used: usage.dailyUsed };
  }

  if (limits.monthly !== null && usage.monthlyUsed >= limits.monthly) {
    return { allowed: false, reason: 'monthly', limit: limits.monthly, used: usage.monthlyUsed };
  }

  if (limits.total !== null && usage.totalUsed >= limits.total) {
    return { allowed: false, reason: 'total', limit: limits.total, used: usage.totalUsed };
  }

  return { allowed: true };
}

export function shouldResetDaily(user: User): boolean {
  const now = new Date();
  const lastReset = user.usage.lastDailyReset;
  return now.toDateString() !== lastReset.toDateString();
}

export function shouldResetMonthly(user: User): boolean {
  const now = new Date();
  const lastReset = user.usage.lastMonthlyReset;
  return now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear();
}

export function getDefaultChatSettings(): UserChatSettings {
  return {
    temperature: null,
    systemPrompt: null,
    maxTokens: null,
    responseFormat: null,
    model: null,
    rerankMode: null,
    githubRepo: null,
  };
}

export function updateChatSettings(user: User, settings: Partial<UserChatSettings>): User {
  const currentSettings = user.chatSettings ?? getDefaultChatSettings();
  return {
    ...user,
    chatSettings: {
      ...currentSettings,
      ...settings,
    },
    updatedAt: new Date(),
  };
}

export function getDefaultProfile(): UserProfile {
  return {
    location: null,
    timezone: null,
    personalization: null,
  };
}

export function updateProfile(user: User, profile: Partial<UserProfile>): User {
  const currentProfile = user.profile ?? getDefaultProfile();
  return {
    ...user,
    profile: {
      ...currentProfile,
      ...profile,
    },
    updatedAt: new Date(),
  };
}
