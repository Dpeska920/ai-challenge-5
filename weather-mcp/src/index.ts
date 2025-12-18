import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

if (!OPENWEATHER_API_KEY) {
  console.error('[Weather MCP] OPENWEATHER_API_KEY is not set');
  process.exit(1);
}

interface WeatherData {
  location: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  description: string;
  icon: string;
  clouds: number;
  visibility: number;
  sunrise: string;
  sunset: string;
}

function formatUnixTime(timestamp: number, timezoneOffset: number): string {
  const date = new Date((timestamp + timezoneOffset) * 1000);
  return date.toISOString().substring(11, 16);
}

async function getCurrentWeather(location: string, units: string = 'metric', lang: string = 'ru'): Promise<WeatherData> {
  const url = `${OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(location)}&appid=${OPENWEATHER_API_KEY}&units=${units}&lang=${lang}`;

  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenWeather API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    location: `${data.name}, ${data.sys.country}`,
    temperature: data.main.temp,
    feelsLike: data.main.feels_like,
    humidity: data.main.humidity,
    pressure: data.main.pressure,
    windSpeed: data.wind.speed,
    windDirection: data.wind.deg,
    description: data.weather[0].description,
    icon: data.weather[0].icon,
    clouds: data.clouds.all,
    visibility: data.visibility,
    sunrise: formatUnixTime(data.sys.sunrise, data.timezone),
    sunset: formatUnixTime(data.sys.sunset, data.timezone),
  };
}

function formatWeatherResponse(weather: WeatherData): string {
  const unitSymbol = '°C';
  const windUnit = 'м/с';

  return `Погода в ${weather.location}:
Температура: ${weather.temperature}${unitSymbol} (ощущается как ${weather.feelsLike}${unitSymbol})
${weather.description.charAt(0).toUpperCase() + weather.description.slice(1)}
Влажность: ${weather.humidity}%
Давление: ${weather.pressure} гПа
Ветер: ${weather.windSpeed} ${windUnit}
Облачность: ${weather.clouds}%
Видимость: ${(weather.visibility / 1000).toFixed(1)} км
Восход: ${weather.sunrise}, Закат: ${weather.sunset}`;
}

// Create MCP server instance
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'weather',
    version: '1.0.0',
  });

  // getCurrentWeather
  server.registerTool(
    'getCurrentWeather',
    {
      description: 'Получить текущую погоду для указанного города или местоположения',
      inputSchema: {
        location: z.string().describe('Город на АНГЛИЙСКОМ языке (например: "Moscow", "London", "New York, US", "Saint Petersburg")'),
        units: z.enum(['metric', 'imperial']).optional().describe('Единицы измерения: metric (Цельсий) или imperial (Фаренгейт). По умолчанию metric'),
        lang: z.string().optional().describe('Язык описания погоды (ru, en, etc). По умолчанию ru'),
      },
    },
    async (args) => {
      try {
        const weather = await getCurrentWeather(
          args.location,
          args.units ?? 'metric',
          args.lang ?? 'ru'
        );
        const formatted = formatWeatherResponse(weather);
        return { content: [{ type: 'text' as const, text: formatted }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Ошибка получения погоды: ${message}` }] };
      }
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

// MCP endpoint
app.all('/mcp', async (req: Request, res: Response) => {
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    sessionId = randomUUID();
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[Weather MCP] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, { server, transport });
    await server.connect(transport);
    console.log(`[Weather MCP] New session created: ${sessionId}`);
    session = { server, transport };
  }

  if (req.method === 'POST') {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[Weather MCP] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'GET') {
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[Weather MCP] Error handling SSE:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[Weather MCP] Session closed: ${sessionId}`);
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
  const port = Number(process.env.PORT) || 3003;
  app.listen(port, () => {
    console.log(`[Weather MCP] Server running on http://localhost:${port}`);
    console.log(`[Weather MCP] MCP endpoint: http://localhost:${port}/mcp`);
  });
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('[Weather MCP] Shutting down...');
  for (const [sessionId, session] of sessions) {
    await session.transport.close();
    console.log(`[Weather MCP] Closed session: ${sessionId}`);
  }
  process.exit(0);
});

start().catch((error) => {
  console.error('[Weather MCP] Failed to start:', error);
  process.exit(1);
});
