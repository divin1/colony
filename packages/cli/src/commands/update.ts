import { Command } from "@commander-js/extra-typings";
import { version as currentVersion } from "../../../../package.json";
import { rename, chmod, unlink } from "fs/promises";
import { join, dirname } from "path";

interface GitHubRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

function parseVersion(tag: string): [number, number, number] {
  const clean = tag.replace(/^v/, "");
  const [major, minor, patch] = clean.split(".").map(Number);
  return [major ?? 0, minor ?? 0, patch ?? 0];
}

function isNewer(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseVersion(current);
  const [lMaj, lMin, lPat] = parseVersion(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

function getPlatformName(): string {
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${platform}-${arch}`;
}

export const updateCommand = new Command("update")
  .description("Update colony to the latest release")
  .action(async () => {
    const releaseUrl =
      "https://api.github.com/repos/divin1/colony/releases/latest";

    let release: GitHubRelease;
    try {
      const res = await fetch(releaseUrl, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        throw new Error(`GitHub API returned ${res.status}`);
      }
      release = (await res.json()) as GitHubRelease;
    } catch (err) {
      console.error(
        `Failed to check for updates: ${(err as Error).message}`
      );
      process.exit(1);
    }

    const latestTag = release.tag_name;
    const latestVersion = latestTag.replace(/^v/, "");

    if (!isNewer(currentVersion, latestVersion)) {
      console.log(`Already up to date (v${currentVersion})`);
      return;
    }

    console.log(`Updating colony v${currentVersion} → v${latestVersion}...`);

    const platformName = getPlatformName();
    const assetName = `colony-${platformName}`;
    const asset = release.assets.find((a) => a.name === assetName);

    if (!asset) {
      console.error(
        `No binary found for ${platformName}. Available assets: ${release.assets.map((a) => a.name).join(", ") || "none"}`
      );
      process.exit(1);
    }

    const execPath = process.execPath;
    const tmpPath = join(dirname(execPath), `.colony-update-${Date.now()}`);

    try {
      const res = await fetch(asset.browser_download_url);
      if (!res.ok) {
        throw new Error(`Download failed with status ${res.status}`);
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      await Bun.write(tmpPath, bytes);
      await chmod(tmpPath, 0o755);
      await rename(tmpPath, execPath);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("EACCES") || message.includes("permission")) {
        console.error(
          `Permission denied. Try running with sudo:\n  sudo colony update`
        );
      } else {
        console.error(`Update failed: ${message}`);
      }
      try {
        await unlink(tmpPath);
      } catch {
        // ignore cleanup errors
      }
      process.exit(1);
    }

    console.log(`Updated to v${latestVersion}`);
  });
