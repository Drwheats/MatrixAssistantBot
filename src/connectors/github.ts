import { env } from "../config/env";

export interface GithubRepoSummary {
  fullName: string;
  description: string;
  defaultBranch: string;
  openIssuesCount: number;
  stargazersCount: number;
  pushedAt?: string;
  htmlUrl: string;
}

export interface GithubCommitSummary {
  sha: string;
  message: string;
  authorName: string;
  authoredAt?: string;
  htmlUrl: string;
}

export interface GithubIssueSummary {
  number: number;
  title: string;
  state: string;
  updatedAt?: string;
  htmlUrl: string;
}

export interface GithubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  updatedAt?: string;
  htmlUrl: string;
}

export interface GithubWorkflowRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion?: string;
  branch?: string;
  createdAt?: string;
  htmlUrl: string;
}

interface GithubRepoResponse {
  full_name?: string;
  description?: string | null;
  default_branch?: string;
  open_issues_count?: number;
  stargazers_count?: number;
  pushed_at?: string;
  html_url?: string;
}

interface GithubCommitResponse {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

interface GithubIssueResponse {
  number?: number;
  title?: string;
  state?: string;
  updated_at?: string;
  html_url?: string;
  pull_request?: Record<string, unknown>;
}

interface GithubPullRequestResponse {
  number?: number;
  title?: string;
  state?: string;
  updated_at?: string;
  html_url?: string;
}

interface GithubWorkflowRunsResponse {
  workflow_runs?: Array<{
    id?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    head_branch?: string;
    created_at?: string;
    html_url?: string;
  }>;
}

export class GithubConnector {
  async getRepoSummary(): Promise<GithubRepoSummary> {
    const payload = await this.request<GithubRepoResponse>(`/repos/${this.repoPath()}`);
    return {
      fullName: payload.full_name ?? this.repoPath(),
      description: payload.description ?? "",
      defaultBranch: payload.default_branch ?? "unknown",
      openIssuesCount: payload.open_issues_count ?? 0,
      stargazersCount: payload.stargazers_count ?? 0,
      pushedAt: payload.pushed_at,
      htmlUrl: payload.html_url ?? `https://github.com/${this.repoPath()}`
    };
  }

  async getRecentCommits(limit = 5): Promise<GithubCommitSummary[]> {
    const payload = await this.request<GithubCommitResponse[]>(
      `/repos/${this.repoPath()}/commits?per_page=${Math.max(1, Math.min(limit, 20))}`
    );
    return payload.map((entry) => ({
      sha: (entry.sha ?? "").slice(0, 7),
      message: entry.commit?.message?.split("\n")[0]?.trim() ?? "(no message)",
      authorName: entry.commit?.author?.name ?? "unknown",
      authoredAt: entry.commit?.author?.date,
      htmlUrl: entry.html_url ?? `https://github.com/${this.repoPath()}/commit/${entry.sha ?? ""}`
    }));
  }

  async getOpenIssues(limit = 5): Promise<GithubIssueSummary[]> {
    const payload = await this.request<GithubIssueResponse[]>(
      `/repos/${this.repoPath()}/issues?state=open&per_page=${Math.max(1, Math.min(limit, 20))}`
    );
    return payload
      .filter((entry) => !entry.pull_request)
      .map((entry) => ({
        number: entry.number ?? 0,
        title: entry.title ?? "(no title)",
        state: entry.state ?? "unknown",
        updatedAt: entry.updated_at,
        htmlUrl: entry.html_url ?? `https://github.com/${this.repoPath()}/issues/${entry.number ?? ""}`
      }));
  }

  async getPullRequests(limit = 5): Promise<GithubPullRequestSummary[]> {
    const payload = await this.request<GithubPullRequestResponse[]>(
      `/repos/${this.repoPath()}/pulls?state=open&per_page=${Math.max(1, Math.min(limit, 20))}`
    );
    return payload.map((entry) => ({
      number: entry.number ?? 0,
      title: entry.title ?? "(no title)",
      state: entry.state ?? "unknown",
      updatedAt: entry.updated_at,
      htmlUrl: entry.html_url ?? `https://github.com/${this.repoPath()}/pull/${entry.number ?? ""}`
    }));
  }

  async getWorkflowRuns(limit = 5): Promise<GithubWorkflowRunSummary[]> {
    const payload = await this.request<GithubWorkflowRunsResponse>(
      `/repos/${this.repoPath()}/actions/runs?per_page=${Math.max(1, Math.min(limit, 20))}`
    );
    const runs = payload.workflow_runs ?? [];
    return runs.map((run) => ({
      id: run.id ?? 0,
      name: run.name ?? "workflow",
      status: run.status ?? "unknown",
      conclusion: run.conclusion ?? undefined,
      branch: run.head_branch,
      createdAt: run.created_at,
      htmlUrl: run.html_url ?? `https://github.com/${this.repoPath()}/actions`
    }));
  }

  private repoPath(): string {
    const owner = env.GITHUB_OWNER?.trim();
    const repo = env.GITHUB_REPO?.trim();
    if (!owner || !repo) {
      throw new Error("GitHub is not configured.");
    }
    return `${owner}/${repo}`;
  }

  private async request<T>(path: string): Promise<T> {
    if (!env.hasGithubCredentials) {
      throw new Error("GitHub is not configured.");
    }

    const base = (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
    const response = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN!}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
    }

    return (await response.json()) as T;
  }
}
