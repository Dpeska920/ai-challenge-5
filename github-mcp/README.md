# GitHub MCP Server

MCP (Model Context Protocol) server for GitHub API operations. Provides tools for working with issues, pull requests, and repository contents.

## Configuration

Environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub Personal Access Token with repo scope |
| `GITHUB_REPOS` | No | Comma-separated whitelist of allowed repos (format: `owner/repo`). If not set, all repos are allowed. |
| `PORT` | No | Server port (default: 3008) |

Example `.env`:
```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPOS=myorg/repo1,myorg/repo2
PORT=3008
```

## Running

### Local development
```bash
bun install
bun run dev
```

### Production
```bash
bun run start
```

### Docker
```bash
docker build -t github-mcp .
docker run -e GITHUB_TOKEN=ghp_xxx -p 3008:3008 github-mcp
```

## Endpoints

- `GET /health` - Health check (returns session count and allowed repos)
- `POST /mcp` - MCP protocol endpoint
- `GET /mcp` - SSE endpoint for MCP
- `DELETE /mcp` - Close MCP session

## Available Tools

### Issues

#### `get_issues`
Get list of issues from a repository.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `state` (enum, optional): "open" | "closed" | "all" (default: "open")
- `labels` (string[], optional): Filter by labels

Returns: Array of `{ number, title, state, labels, createdAt }`

#### `get_issue`
Get detailed information about a specific issue.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `issue_number` (number, required): Issue number

Returns: `{ number, title, body, state, labels, assignees, comments, createdAt, updatedAt }`

#### `create_issue`
Create a new issue.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `title` (string, required): Issue title
- `body` (string, optional): Issue body (markdown)
- `labels` (string[], optional): Labels to add

Returns: `{ number, url }`

#### `add_issue_comment`
Add a comment to an issue.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `issue_number` (number, required): Issue number
- `body` (string, required): Comment body (markdown)

Returns: `{ id, url }`

### Pull Requests

#### `get_pull_requests`
Get list of pull requests from a repository.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `state` (enum, optional): "open" | "closed" | "all" (default: "open")

Returns: Array of `{ number, title, state, author, createdAt }`

#### `get_pull_request`
Get detailed information about a specific pull request.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `pr_number` (number, required): Pull request number

Returns: `{ number, title, body, state, author, filesChanged, additions, deletions, createdAt, updatedAt, mergedAt }`

#### `get_pr_diff`
Get the diff for a pull request.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `pr_number` (number, required): Pull request number
- `file_path` (string, optional): Filter diff to specific file

Returns: Unified diff as string

#### `get_pr_files`
Get list of files changed in a pull request.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `pr_number` (number, required): Pull request number

Returns: Array of `{ filename, status, additions, deletions, changes }`

#### `create_review_comment`
Create a comment on a pull request.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `pr_number` (number, required): Pull request number
- `body` (string, required): Comment body (markdown)

Returns: `{ id, url }`

### Repository

#### `get_repo_structure`
Get directory structure of a repository path.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `path` (string, optional): Path in repository (default: root)
- `ref` (string, optional): Git ref (branch, tag, or commit SHA)

Returns: Array of `{ name, type, path }`

#### `get_file_content`
Get content of a file from repository.

Parameters:
- `repo` (string, required): Repository in format "owner/repo"
- `path` (string, required): File path in repository
- `ref` (string, optional): Git ref (branch, tag, or commit SHA)

Returns: File content as string

## Error Handling

All tools return errors in format:
```json
{
  "content": [{ "type": "text", "text": "Error: <message>" }],
  "isError": true
}
```

Error codes:
- **401**: Authentication failed (invalid token)
- **403**: Access denied or rate limit exceeded
- **404**: Resource not found
