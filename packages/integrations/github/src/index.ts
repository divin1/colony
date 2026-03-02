import { Octokit } from "@octokit/rest";

export interface GitHubConfig {
  token: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  state: "open" | "closed";
  url: string;
  createdAt: string;
}

export class GitHubIntegration {
  private octokit: Octokit;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({ auth: config.token });
  }

  async listIssues(
    owner: string,
    repo: string,
    opts?: { labels?: string[]; state?: "open" | "closed" | "all" }
  ): Promise<GitHubIssue[]> {
    const response = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: opts?.state ?? "open",
      labels: opts?.labels?.join(","),
    });

    return response.data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        labels: issue.labels
          .map((l) => (typeof l === "string" ? l : l.name ?? ""))
          .filter(Boolean),
        state: issue.state as "open" | "closed",
        url: issue.html_url,
        createdAt: issue.created_at,
      }));
  }

  async createIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }
}
