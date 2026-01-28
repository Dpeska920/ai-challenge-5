import { Octokit } from "@octokit/rest";
import { getConfig } from "./config.js";

export interface IssueInfo {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  comments: number;
  createdAt: string;
  updatedAt: string;
}

export interface IssueListItem {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  createdAt: string;
}

export interface PullRequestListItem {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  author: string;
  createdAt: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed" | "merged";
  author: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface RepoItem {
  name: string;
  type: "file" | "dir";
  path: string;
}

export interface CreatedIssue {
  number: number;
  url: string;
}

export interface CreatedComment {
  id: number;
  url: string;
}

class GitHubServiceClass {
  private client: Octokit | null = null;

  private getClient(): Octokit {
    if (!this.client) {
      const config = getConfig();
      this.client = new Octokit({ auth: config.githubToken });
    }
    return this.client;
  }

  private parseRepo(repo: string): { owner: string; repo: string } {
    const parts = repo.split("/");
    if (parts.length !== 2) {
      throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo"`);
    }
    return { owner: parts[0], repo: parts[1] };
  }

  private checkRepoAllowed(repo: string): void {
    const config = getConfig();
    if (config.allowedRepos && config.allowedRepos.length > 0) {
      if (!config.allowedRepos.includes(repo)) {
        throw new Error(
          `Repository ${repo} is not in the allowed list. Allowed: ${config.allowedRepos.join(", ")}`
        );
      }
    }
  }

  async getIssues(
    repo: string,
    state: "open" | "closed" | "all" = "open",
    labels?: string[]
  ): Promise<IssueListItem[]> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.issues.listForRepo({
        owner,
        repo: repoName,
        state,
        labels: labels?.join(","),
        per_page: 100,
      });

      return data
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state as "open" | "closed",
          labels: issue.labels
            .map((l) => (typeof l === "string" ? l : l.name))
            .filter((n): n is string => n !== undefined),
          createdAt: issue.created_at,
        }));
    } catch (error) {
      this.handleError(error, `Failed to get issues for ${repo}`);
    }
  }

  async getIssue(repo: string, issueNumber: number): Promise<IssueInfo> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.issues.get({
        owner,
        repo: repoName,
        issue_number: issueNumber,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        state: data.state as "open" | "closed",
        labels: data.labels
          .map((l) => (typeof l === "string" ? l : l.name))
          .filter((n): n is string => n !== undefined),
        assignees: (data.assignees ?? []).map((a) => a.login),
        comments: data.comments,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      this.handleError(error, `Failed to get issue #${issueNumber} from ${repo}`);
    }
  }

  async createIssue(
    repo: string,
    title: string,
    body?: string,
    labels?: string[]
  ): Promise<CreatedIssue> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.issues.create({
        owner,
        repo: repoName,
        title,
        body,
        labels,
      });

      return {
        number: data.number,
        url: data.html_url,
      };
    } catch (error) {
      this.handleError(error, `Failed to create issue in ${repo}`);
    }
  }

  async addIssueComment(
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<CreatedComment> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.issues.createComment({
        owner,
        repo: repoName,
        issue_number: issueNumber,
        body,
      });

      return {
        id: data.id,
        url: data.html_url,
      };
    } catch (error) {
      this.handleError(error, `Failed to add comment to issue #${issueNumber} in ${repo}`);
    }
  }

  async getPullRequests(
    repo: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<PullRequestListItem[]> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.pulls.list({
        owner,
        repo: repoName,
        state,
        per_page: 100,
      });

      return data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
        author: pr.user?.login ?? "unknown",
        createdAt: pr.created_at,
      }));
    } catch (error) {
      this.handleError(error, `Failed to get pull requests for ${repo}`);
    }
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PullRequestInfo> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        state: data.merged_at ? "merged" : (data.state as "open" | "closed"),
        author: data.user?.login ?? "unknown",
        filesChanged: data.changed_files,
        additions: data.additions,
        deletions: data.deletions,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        mergedAt: data.merged_at ?? null,
      };
    } catch (error) {
      this.handleError(error, `Failed to get PR #${prNumber} from ${repo}`);
    }
  }

  async getPRDiff(repo: string, prNumber: number, filePath?: string): Promise<string> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      });

      const diff = data as unknown as string;

      if (!filePath) {
        return diff;
      }

      const lines = diff.split("\n");
      const result: string[] = [];
      let inTargetFile = false;

      for (const line of lines) {
        if (line.startsWith("diff --git")) {
          inTargetFile = line.includes(filePath);
        }
        if (inTargetFile) {
          result.push(line);
        }
      }

      return result.join("\n");
    } catch (error) {
      this.handleError(error, `Failed to get diff for PR #${prNumber} from ${repo}`);
    }
  }

  async getPRFiles(repo: string, prNumber: number): Promise<PullRequestFile[]> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.pulls.listFiles({
        owner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100,
      });

      return data.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
      }));
    } catch (error) {
      this.handleError(error, `Failed to get files for PR #${prNumber} from ${repo}`);
    }
  }

  async getRepoStructure(
    repo: string,
    path: string = "",
    ref?: string
  ): Promise<RepoItem[]> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.repos.getContent({
        owner,
        repo: repoName,
        path,
        ref,
      });

      if (Array.isArray(data)) {
        return data.map((item) => ({
          name: item.name,
          type: (item.type as string) === "dir" ? "dir" as const : "file" as const,
          path: item.path,
        }));
      }

      return [
        {
          name: data.name,
          type: (data.type as string) === "dir" ? "dir" as const : "file" as const,
          path: data.path,
        },
      ];
    } catch (error) {
      this.handleError(error, `Failed to get structure for ${repo}/${path}`);
    }
  }

  async getFileContent(repo: string, path: string, ref?: string): Promise<string> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.repos.getContent({
        owner,
        repo: repoName,
        path,
        ref,
      });

      if ("content" in data && data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }

      throw new Error(`Unexpected response format for file ${path}`);
    } catch (error) {
      this.handleError(error, `Failed to get file content for ${repo}/${path}`);
    }
  }

  async createReviewComment(
    repo: string,
    prNumber: number,
    body: string
  ): Promise<CreatedComment> {
    this.checkRepoAllowed(repo);
    const { owner, repo: repoName } = this.parseRepo(repo);
    const client = this.getClient();

    try {
      const { data } = await client.issues.createComment({
        owner,
        repo: repoName,
        issue_number: prNumber,
        body,
      });

      return {
        id: data.id,
        url: data.html_url,
      };
    } catch (error) {
      this.handleError(error, `Failed to create review comment on PR #${prNumber} in ${repo}`);
    }
  }

  private handleError(error: unknown, message: string): never {
    const err = error as { status?: number; message?: string };

    if (err.status === 401) {
      throw new Error(`Authentication failed: Invalid or expired GitHub token`);
    }

    if (err.status === 403) {
      throw new Error(`Access denied or rate limit exceeded: ${err.message}`);
    }

    if (err.status === 404) {
      throw new Error(`Resource not found: ${message}`);
    }

    throw new Error(`${message}: ${err.message || "Unknown error"}`);
  }
}

export const GitHubService = new GitHubServiceClass();
