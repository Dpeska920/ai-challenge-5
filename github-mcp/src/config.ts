import { z } from "zod";

const ConfigSchema = z.object({
  githubToken: z.string().min(1, "GITHUB_TOKEN is required"),
  allowedRepos: z.array(z.string()).optional(),
  port: z.number().int().positive().default(3008),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const allowedReposRaw = process.env.GITHUB_REPOS || "";
  const allowedRepos = allowedReposRaw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const rawConfig = {
    githubToken: process.env.GITHUB_TOKEN || "",
    allowedRepos: allowedRepos.length > 0 ? allowedRepos : undefined,
    port: parseInt(process.env.PORT || "3008", 10),
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Configuration validation failed: ${errors}`);
  }

  return result.data;
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
