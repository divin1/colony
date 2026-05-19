import { defineConfig } from "vitepress";

// Set base to match your GitHub repo name, e.g. '/colony/'
// For a root user/org page (username.github.io), use '/'.
const base = process.env.VITEPRESS_BASE ?? "/colony/";

export default defineConfig({
  base,
  title: "Colony",
  description:
    "Open-source framework for deploying autonomous AI agents. Run Claude, Gemini, or any CLI agent as a supervised process. Kanban task management, resilient supervisor, web dashboard.",

  // Default to dark; user can toggle.
  appearance: "dark",

  // Remove .html from URLs.
  cleanUrls: true,

  // Show last-updated timestamp (requires full git history in CI).
  lastUpdated: true,

  // Syntax highlighting themes.
  markdown: {
    theme: {
      dark: "github-dark-dimmed",
      light: "github-light",
    },
  },

  ignoreDeadLinks: "localhostLinks",

  head: [
    ["link", { rel: "icon", href: `${base}favicon.svg`, type: "image/svg+xml" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Colony" }],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "twitter:title", content: "Colony — Autonomous AI Agent Framework" }],
    ["meta", { name: "twitter:description", content: "Deploy autonomous AI agents powered by Claude, Gemini, or any CLI tool. Kanban task management, resilient supervisor, web dashboard." }],
    ["meta", { name: "theme-color", content: "#0a0a0a" }],
  ],

  themeConfig: {
    // Top navigation bar.
    nav: [
      { text: "Docs", link: "/getting-started" },
      { text: "Configuration", link: "/configuration" },
      { text: "CLI", link: "/cli" },
      { text: "Docker", link: "/docker" },
      { text: "MCP", link: "/mcp" },
    ],

    // Sidebar.
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Introduction", link: "/getting-started" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Configuration", link: "/configuration" },
          { text: "CLI", link: "/cli" },
          { text: "Docker", link: "/docker" },
          { text: "MCP server", link: "/mcp" },
          { text: "Supervisor behavior", link: "/supervisor" },
        ],
      },
    ],

    // "Edit this page" links.
    editLink: {
      pattern: "https://github.com/divin1/colony/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    // GitHub link in top-right nav.
    socialLinks: [
      { icon: "github", link: "https://github.com/divin1/colony" },
    ],

    // Built-in local full-text search (no API key required).
    search: {
      provider: "local",
    },

    // Footer.
    footer: {
      message: "Released under the MIT License.",
      copyright: "Colony — autonomous agents for humans who stay in control",
    },

    // Last updated display.
    lastUpdated: {
      text: "Last updated",
      formatOptions: {
        dateStyle: "medium",
      },
    },

    // Remove the default "Powered by VitePress" in the footer.
    docFooter: {
      prev: "Previous",
      next: "Next",
    },

    outline: {
      level: [2, 3],
      label: "On this page",
    },
  },
});
