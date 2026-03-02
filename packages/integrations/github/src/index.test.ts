import { describe, it, expect, mock } from "bun:test";
import { GitHubIntegration } from "./index";

const config = { token: "fake-token" };

describe("GitHubIntegration", () => {
  it("can be instantiated without calling the network", () => {
    const github = new GitHubIntegration(config);
    expect(github).toBeInstanceOf(GitHubIntegration);
  });

  it("listIssues maps response and filters out pull requests", async () => {
    const github = new GitHubIntegration(config);

    // Mock the underlying octokit call by replacing it on the instance.
    const fakeResponse = {
      data: [
        {
          id: 1,
          number: 42,
          title: "Fix the bug",
          body: "Description here",
          labels: [{ name: "bug" }, { name: "ant-ready" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/42",
          created_at: "2024-01-01T00:00:00Z",
          pull_request: undefined,
        },
        {
          id: 2,
          number: 43,
          title: "A pull request",
          body: null,
          labels: [],
          state: "open",
          html_url: "https://github.com/owner/repo/pull/43",
          created_at: "2024-01-02T00:00:00Z",
          pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/43" },
        },
      ],
    };

    // Access private octokit and mock its issues.listForRepo
    const octokit = (github as unknown as { octokit: { issues: { listForRepo: unknown } } }).octokit;
    octokit.issues.listForRepo = mock(() => Promise.resolve(fakeResponse));

    const issues = await github.listIssues("owner", "repo");

    // Should only return the non-PR issue
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      id: 1,
      number: 42,
      title: "Fix the bug",
      body: "Description here",
      labels: ["bug", "ant-ready"],
      state: "open",
      url: "https://github.com/owner/repo/issues/42",
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("listIssues handles string labels", async () => {
    const github = new GitHubIntegration(config);

    const fakeResponse = {
      data: [
        {
          id: 3,
          number: 10,
          title: "String label issue",
          body: null,
          labels: ["enhancement"],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/10",
          created_at: "2024-01-03T00:00:00Z",
          pull_request: undefined,
        },
      ],
    };

    const octokit = (github as unknown as { octokit: { issues: { listForRepo: unknown } } }).octokit;
    octokit.issues.listForRepo = mock(() => Promise.resolve(fakeResponse));

    const issues = await github.listIssues("owner", "repo");
    expect(issues[0].labels).toEqual(["enhancement"]);
  });

  it("listIssues passes state and labels options to octokit", async () => {
    const github = new GitHubIntegration(config);

    let capturedParams: Record<string, unknown> = {};
    const octokit = (github as unknown as { octokit: { issues: { listForRepo: unknown } } }).octokit;
    octokit.issues.listForRepo = mock((params: Record<string, unknown>) => {
      capturedParams = params;
      return Promise.resolve({ data: [] });
    });

    await github.listIssues("owner", "repo", { labels: ["bug", "ant-ready"], state: "all" });

    expect(capturedParams.state).toBe("all");
    expect(capturedParams.labels).toBe("bug,ant-ready");
  });
});
