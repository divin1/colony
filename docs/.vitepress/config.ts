import { defineConfig } from "vitepress";

// Set base to match your GitHub repo name, e.g. '/colony/'
// For a root user/org page (username.github.io), use '/'.
const base = process.env.VITEPRESS_BASE ?? "/colony/";

export default defineConfig({
  base,
  title: "Colony",
  description:
    "A framework for deploying autonomous LLM agents that work continuously and check in with you before taking irreversible actions.",

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

  // Don't emit dead link warnings as errors in CI.
  ignoreDeadLinks: false,

  head: [
    ["link", { rel: "icon", href: `${base}favicon.svg`, type: "image/svg+xml" }],
  ],

  themeConfig: {
    // Top navigation bar.
    nav: [
      { text: "Docs", link: "/getting-started" },
      { text: "Configuration", link: "/configuration" },
      { text: "CLI", link: "/cli" },
      { text: "Docker", link: "/docker" },
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
