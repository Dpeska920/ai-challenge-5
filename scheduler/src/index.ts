import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MongoClient, Db, ObjectId, Filter, Document } from 'mongodb';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Reminder, CreateReminderParams, DeleteReminderParams, ListRemindersParams, RepeatInterval } from './types.js';

// MongoDB connection
let db: Db | null = null;

async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/telegram-ai-bot';
  console.log('[Scheduler] Connecting to MongoDB...');

  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();

  // Create indexes
  await db.collection('reminders').createIndex({ telegramId: 1 });
  await db.collection('reminders').createIndex({ scheduledAt: 1, status: 1 });
  await db.collection('reminders').createIndex({ status: 1 });

  console.log('[Scheduler] Connected to MongoDB');
  return db;
}

// Timezone configuration
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Europe/Moscow';

// Timezone offsets in hours (for conversion to UTC)
const TIMEZONE_OFFSETS: Record<string, number> = {
  'Europe/Moscow': 3,
  'Europe/Kiev': 2,
  'Europe/London': 0,
  'America/New_York': -5,
  'America/Los_Angeles': -8,
  'Asia/Tokyo': 9,
  'UTC': 0,
};

// Get timezone offset in hours
function getTimezoneOffset(timezone: string): number {
  return TIMEZONE_OFFSETS[timezone] ?? 3; // Default to MSK if unknown
}

// Convert local time string to UTC Date
// AI sends time in user's timezone (e.g., MSK), we need to store as UTC
// ALWAYS treats input as local timezone, stripping any timezone suffix AI might add
function localToUtc(localTimeString: string, timezone: string = DEFAULT_TIMEZONE): Date {
  // Strip any timezone suffix that AI might have added (Z, +00:00, +03:00, etc.)
  const cleanedString = localTimeString
    .replace(/Z$/, '')
    .replace(/[+-]\d{2}:\d{2}$/, '')
    .replace(/[+-]\d{4}$/, '');

  // Parse date components manually to avoid timezone ambiguity
  const match = cleanedString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/);
  if (!match) {
    console.error(`[Scheduler] Invalid date format: ${localTimeString}`);
    return new Date(localTimeString); // fallback
  }

  const [, year, month, day, hours, minutes, seconds = '0'] = match;

  // Create UTC date with the parsed components, then adjust for timezone
  // Example: AI sends 19:54 MSK -> we want to store 16:54 UTC
  const offset = getTimezoneOffset(timezone);
  const utcHours = parseInt(hours, 10) - offset;

  const date = new Date(Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1, // months are 0-indexed
    parseInt(day, 10),
    utcHours,
    parseInt(minutes, 10),
    parseInt(seconds, 10)
  ));

  console.log(`[Scheduler] localToUtc: input="${localTimeString}" (${timezone}), UTC result=${date.toISOString()}`);

  return date;
}

// Get current timezone for display
function getDisplayTimezone(): string {
  return DEFAULT_TIMEZONE;
}

// Reminder operations
async function createReminder(params: CreateReminderParams): Promise<Reminder> {
  const database = await connectToDatabase();

  const scheduledAtUtc = localToUtc(params.scheduledAt);

  const reminder: Reminder = {
    telegramId: params.telegramId,
    message: params.message,
    scheduledAt: scheduledAtUtc,
    isRepeatable: params.isRepeatable ?? false,
    repeatInterval: params.repeatInterval,
    status: 'pending',
    createdAt: new Date(),
  };

  console.log(`[Scheduler] Input time (${DEFAULT_TIMEZONE}): ${params.scheduledAt}, Stored as UTC: ${scheduledAtUtc.toISOString()}, isDate=${scheduledAtUtc instanceof Date}, now=${new Date().toISOString()}`);

  const result = await database.collection<Reminder>('reminders').insertOne(reminder);
  reminder._id = result.insertedId;

  console.log(`[Scheduler] Created reminder ${result.insertedId} for user ${params.telegramId}`);
  return reminder;
}

async function deleteReminder(params: DeleteReminderParams): Promise<number> {
  const database = await connectToDatabase();

  if (params.reminderId) {
    const result = await database.collection('reminders').deleteOne({
      _id: new ObjectId(params.reminderId),
    });
    console.log(`[Scheduler] Deleted reminder ${params.reminderId}`);
    return result.deletedCount;
  }

  if (params.reminderIds && params.reminderIds.length > 0) {
    const objectIds = params.reminderIds.map(id => new ObjectId(id));
    const result = await database.collection('reminders').deleteMany({
      _id: { $in: objectIds },
    });
    console.log(`[Scheduler] Deleted ${result.deletedCount} reminders`);
    return result.deletedCount;
  }

  if (params.telegramId) {
    const result = await database.collection('reminders').deleteMany({
      telegramId: params.telegramId,
      status: 'pending',
    });
    console.log(`[Scheduler] Deleted ${result.deletedCount} reminders for user ${params.telegramId}`);
    return result.deletedCount;
  }

  return 0;
}

async function listReminders(params: ListRemindersParams): Promise<Reminder[]> {
  const database = await connectToDatabase();

  const filter: Filter<Reminder> = {
    telegramId: params.telegramId,
  };

  if (params.status) {
    filter.status = params.status;
  } else if (!params.includeCompleted) {
    filter.status = 'pending';
  }

  const reminders = await database.collection<Reminder>('reminders')
    .find(filter)
    .sort({ scheduledAt: 1 })
    .toArray();

  return reminders;
}

// Get due reminders (scheduled time has passed)
async function getDueReminders(): Promise<Reminder[]> {
  const database = await connectToDatabase();

  const now = new Date();

  // Debug: log all pending reminders to see what's in DB
  const allPending = await database.collection<Reminder>('reminders')
    .find({ status: 'pending' })
    .toArray();

  if (allPending.length > 0) {
    console.log(`[Scheduler] DEBUG: now=${now.toISOString()}, pending reminders:`);
    for (const r of allPending) {
      const scheduledAt = r.scheduledAt;
      const isDate = scheduledAt instanceof Date;
      const scheduledAtStr = isDate ? scheduledAt.toISOString() : String(scheduledAt);
      const isDue = new Date(scheduledAt) <= now;
      console.log(`  - ${r._id}: scheduledAt=${scheduledAtStr} (isDate=${isDate}, isDue=${isDue})`);
    }
  }

  const reminders = await database.collection<Reminder>('reminders')
    .find({
      status: 'pending',
      scheduledAt: { $lte: now },
    })
    .toArray();

  return reminders;
}

// Mark reminder as sent
async function markReminderAsSent(reminderId: ObjectId): Promise<void> {
  const database = await connectToDatabase();

  await database.collection<Reminder>('reminders').updateOne(
    { _id: reminderId },
    {
      $set: {
        status: 'sent',
        sentAt: new Date(),
      }
    }
  );
}

// Calculate next scheduled time for repeatable reminder
// IMPORTANT: Returns a date in the FUTURE, skipping any missed intervals
function getNextScheduledTime(baseTime: Date, interval: RepeatInterval): Date {
  const now = new Date();
  const next = new Date(baseTime);

  // Keep adding intervals until we get a future date
  while (next <= now) {
    switch (interval) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
  }

  return next;
}

// Create next occurrence for repeatable reminder
async function createNextOccurrence(reminder: Reminder): Promise<void> {
  if (!reminder.isRepeatable || !reminder.repeatInterval) return;

  const database = await connectToDatabase();

  const nextReminder: Reminder = {
    telegramId: reminder.telegramId,
    message: reminder.message,
    scheduledAt: getNextScheduledTime(reminder.scheduledAt, reminder.repeatInterval),
    isRepeatable: true,
    repeatInterval: reminder.repeatInterval,
    status: 'pending',
    createdAt: new Date(),
  };

  const result = await database.collection<Reminder>('reminders').insertOne(nextReminder);
  console.log(`[Scheduler] Created next occurrence ${result.insertedId} for repeatable reminder, scheduled at ${nextReminder.scheduledAt.toISOString()}`);
}

// Send reminder to bot API (bot will process via AI and send to Telegram)
async function sendReminderToBot(reminder: Reminder): Promise<boolean> {
  const botApiUrl = process.env.BOT_API_URL || 'http://bot:3000';

  try {
    const response = await fetch(`${botApiUrl}/internal/send-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: reminder.telegramId,
        message: reminder.message,
        scheduledAt: reminder.scheduledAt.toISOString(),
        isRepeatable: reminder.isRepeatable,
        repeatInterval: reminder.repeatInterval,
      }),
    });

    if (!response.ok) {
      console.error(`[Scheduler] Failed to send reminder to bot: ${response.status}`);
      return false;
    }

    console.log(`[Scheduler] Reminder sent to bot for user ${reminder.telegramId}`);
    return true;
  } catch (error) {
    console.error('[Scheduler] Error sending reminder to bot:', error);
    return false;
  }
}

// Process due reminders
async function processDueReminders(): Promise<void> {
  try {
    const dueReminders = await getDueReminders();

    if (dueReminders.length === 0) return;

    console.log(`[Scheduler] Processing ${dueReminders.length} due reminders`);

    for (const reminder of dueReminders) {
      const sent = await sendReminderToBot(reminder);

      if (sent) {
        await markReminderAsSent(reminder._id!);

        if (reminder.isRepeatable && reminder.repeatInterval) {
          await createNextOccurrence(reminder);
        }
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error processing due reminders:', error);
  }
}

// Start scheduler (runs every minute)
function startScheduler(): void {
  console.log('[Scheduler] Starting scheduler (checks every minute)');

  // Run immediately on start
  processDueReminders();

  // Then run every 30 seconds for better precision
  setInterval(processDueReminders, 30 * 1000);
}

// Get current date/time in the configured timezone for tool descriptions
function getCurrentDateTimeInTimezone(): { dateTime: string; year: number } {
  const now = new Date();
  // Use Intl to get time in the configured timezone
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // Format: "2025-12-17 19:49:00" -> convert to ISO-like
  const formatted = formatter.format(now).replace(' ', 'T');
  const year = parseInt(formatted.substring(0, 4), 10);
  return { dateTime: formatted, year };
}

// Create MCP server instance
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'scheduler',
    version: '1.0.0',
  });

  // Note: Description is static at registration time, but we include timezone info.
  // The actual current time will be provided in the tool response.
  const { year: currentYear } = getCurrentDateTimeInTimezone();

  // createReminder
  server.registerTool(
    'createReminder',
    {
      description: `Создать напоминание для пользователя. ВАЖНО: scheduledAt должен быть в часовом поясе ${DEFAULT_TIMEZONE} БЕЗ суффикса timezone (например 2025-12-17T19:54:00, НЕ добавляй +00:00 или Z).`,
      inputSchema: {
        telegramId: z.number().describe('Telegram ID пользователя (будет подставлен автоматически)'),
        message: z.string().describe('Текст напоминания или задача для выполнения (может содержать инструкции для бота)'),
        scheduledAt: z.string().describe(`Дата и время в ${DEFAULT_TIMEZONE} в формате YYYY-MM-DDTHH:MM:SS (например ${currentYear}-12-20T16:00:00). НЕ добавляй Z или +00:00!`),
        isRepeatable: z.boolean().optional().describe('Повторяющееся напоминание (по умолчанию false)'),
        repeatInterval: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional().describe('Интервал повторения'),
      },
    },
    async (args) => {
      // Get current time at the moment of tool call
      const { dateTime: currentDateTime } = getCurrentDateTimeInTimezone();

      const reminder = await createReminder(args as CreateReminderParams);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            reminderId: reminder._id?.toString(),
            scheduledAtUTC: reminder.scheduledAt.toISOString(),
            scheduledAtLocal: reminder.scheduledAt.toLocaleString('ru-RU', { timeZone: DEFAULT_TIMEZONE }),
            currentTimeLocal: currentDateTime,
            timezone: DEFAULT_TIMEZONE,
            message: `Напоминание создано на ${reminder.scheduledAt.toLocaleString('ru-RU', { timeZone: DEFAULT_TIMEZONE })} (${DEFAULT_TIMEZONE})`,
          })
        }]
      };
    }
  );

  // deleteReminder
  server.registerTool(
    'deleteReminder',
    {
      description: 'Удалить напоминание или несколько напоминаний',
      inputSchema: {
        reminderId: z.string().optional().describe('ID напоминания для удаления'),
        reminderIds: z.array(z.string()).optional().describe('Массив ID напоминаний для удаления'),
        telegramId: z.number().optional().describe('Удалить все активные напоминания пользователя'),
      },
    },
    async (args) => {
      const deletedCount = await deleteReminder(args as DeleteReminderParams);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            deletedCount,
            message: deletedCount > 0
              ? `Удалено напоминаний: ${deletedCount}`
              : 'Напоминания не найдены',
          })
        }]
      };
    }
  );

  // listReminders
  server.registerTool(
    'listReminders',
    {
      description: 'Получить список напоминаний пользователя',
      inputSchema: {
        telegramId: z.number().describe('Telegram ID пользователя'),
        status: z.enum(['pending', 'sent', 'cancelled']).optional().describe('Фильтр по статусу'),
        includeCompleted: z.boolean().optional().describe('Включить выполненные напоминания'),
      },
    },
    async (args) => {
      const reminders = await listReminders(args as ListRemindersParams);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            count: reminders.length,
            reminders: reminders.map(r => ({
              id: r._id?.toString(),
              message: r.message,
              scheduledAt: r.scheduledAt.toISOString(),
              scheduledAtFormatted: r.scheduledAt.toLocaleString('ru-RU', { timeZone: DEFAULT_TIMEZONE }),
              isRepeatable: r.isRepeatable,
              repeatInterval: r.repeatInterval,
              status: r.status,
            })),
          })
        }]
      };
    }
  );

  return server;
}

// Session management
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

// Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// MCP endpoint - handles POST, GET, DELETE for MCP protocol
app.all('/mcp', async (req: Request, res: Response) => {
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    sessionId = randomUUID();
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[Scheduler] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, { server, transport });
    await server.connect(transport);
    console.log(`[Scheduler] New session created: ${sessionId}`);
    session = { server, transport };
  }

  if (req.method === 'POST') {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[Scheduler] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'GET') {
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[Scheduler] Error handling SSE:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[Scheduler] Session closed: ${sessionId}`);
      res.status(200).json({ message: 'Session closed' });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
});

// Start server
async function start() {
  // Pre-connect to MongoDB
  await connectToDatabase();

  // Start the scheduler
  startScheduler();

  const port = Number(process.env.PORT) || 3003;
  app.listen(port, () => {
    console.log(`[Scheduler] Server running on http://localhost:${port}`);
    console.log(`[Scheduler] MCP endpoint: http://localhost:${port}/mcp`);
  });
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('[Scheduler] Shutting down...');
  for (const [sessionId, session] of sessions) {
    await session.transport.close();
    console.log(`[Scheduler] Closed session: ${sessionId}`);
  }
  process.exit(0);
});

start().catch((error) => {
  console.error('[Scheduler] Failed to start:', error);
  process.exit(1);
});
