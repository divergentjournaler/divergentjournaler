import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const PUBLISHING_ROOT = path.resolve(
  PROJECT_ROOT,
  "../DivergentJournaler-Publishing"
);

const REPOSITORY = "divergentjournaler/divergentjournaler";
const articleName = process.argv[2];
const mode = process.argv[3];

if (
  !articleName ||
  articleName !== path.basename(articleName) ||
  !articleName.toLowerCase().endsWith(".md")
) {
  throw new Error("Provide a valid Markdown article filename.");
}

if (!["publish", "update"].includes(mode)) {
  throw new Error('Mode must be "publish" or "update".');
}

function run(command, args, cwd = PROJECT_ROOT) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  }).trim();
}

if (!fs.existsSync(PUBLISHING_ROOT)) {
  throw new Error("Publishing workspace not found.");
}

const publishingStatus = run(
  "git",
  ["status", "--porcelain"],
  PUBLISHING_ROOT
);

if (publishingStatus) {
  throw new Error(
    "Publishing workspace has uncommitted changes. Deployment cancelled."
  );
}

const remoteUrl = run(
  "git",
  ["remote", "get-url", "origin"],
  PUBLISHING_ROOT
);

const expectedRemote =
  "https://github.com/divergentjournaler/divergentjournaler.git";

if (remoteUrl !== expectedRemote) {
  throw new Error(
    `Unexpected publishing repository: ${remoteUrl}`
  );
}

run(
  "git",
  ["fetch", "origin", "main"],
  PUBLISHING_ROOT
);

const publishingCommit = run(
  "git",
  ["rev-parse", "HEAD"],
  PUBLISHING_ROOT
);

const remoteMainCommit = run(
  "git",
  ["rev-parse", "refs/remotes/origin/main"],
  PUBLISHING_ROOT
);

if (publishingCommit !== remoteMainCommit) {
  throw new Error(
    "Publishing workspace is not synchronized with origin/main. Deployment cancelled."
  );
}

console.log("Publishing workspace verified and clean.");