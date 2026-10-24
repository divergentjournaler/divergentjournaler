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

if (process.env.DJ_ENABLE_DEPLOY !== "YES") {
  throw new Error(
    "Deployment disabled. DJ_ENABLE_DEPLOY=YES is required."
  );
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

const conversionOutput = execFileSync(
  "node",
  [
    path.join(PROJECT_ROOT, "scripts", "publish-article.mjs"),
    articleName,
    mode,
  ],
  {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DJ_PUBLISH_ROOT: PUBLISHING_ROOT,
    },
    encoding: "utf8",
  }
);

console.log(conversionOutput);

const resultLine = conversionOutput
  .split(/\r?\n/)
  .find((line) => line.startsWith("PUBLISH_RESULT="));

if (!resultLine) {
  throw new Error("Converter did not return publishing results.");
}

const result = JSON.parse(
  resultLine.slice("PUBLISH_RESULT=".length)
);

if (result.previousArticleFile) {
  const oldArticle = path.resolve(
    PUBLISHING_ROOT,
    result.previousArticleFile
  );

  if (
    !oldArticle.startsWith(
      path.join(PUBLISHING_ROOT, "src", "content", "markdown") +
        path.sep
    )
  ) {
    throw new Error("Unsafe previous article path. Cancelled.");
  }

  fs.unlinkSync(oldArticle);
  console.log("Removed previous article filename from publishing workspace.");
}

const filesToStage = [
  result.articleFile,
  ...result.images,
];

const allowedArticleDirectory = path.join(
  PUBLISHING_ROOT, "src", "content", "markdown"
);

const allowedImageDirectory = path.join(
  PUBLISHING_ROOT, "public", "uploads", "images"
);

for (const file of filesToStage) {
  const absolutePath = path.resolve(PUBLISHING_ROOT, file);

  const allowed =
    absolutePath.startsWith(allowedArticleDirectory + path.sep) ||
    absolutePath.startsWith(allowedImageDirectory + path.sep);

  if (!allowed) {
    throw new Error(`Unsafe publishing file path: ${file}`);
  }
}

if (result.previousArticleFile) {
  filesToStage.push(result.previousArticleFile);
}

run(
  "git",
  ["add", "--", ...filesToStage],
  PUBLISHING_ROOT
);

console.log("Article and associated images staged.");

const stagedFiles = run(
  "git",
  ["diff", "--cached", "--name-only"],
  PUBLISHING_ROOT
);

if (!stagedFiles) {
  throw new Error(
    "No article changes to publish. Deployment cancelled."
  );
}

console.log("Staged files:\n" + stagedFiles);

const commitMessage =
  `${mode === "publish" ? "Publish" : "Update"} article: ${articleName}`;

run(
  "git",
  ["commit", "-m", commitMessage],
  PUBLISHING_ROOT
);

const deployedCommit = run(
  "git",
  ["rev-parse", "HEAD"],
  PUBLISHING_ROOT
);

console.log("Publishing commit prepared:", deployedCommit);

run(
  "git",
  ["push", "origin", "HEAD:main"],
  PUBLISHING_ROOT
);

console.log("Publishing commit pushed to GitHub:", deployedCommit);

let deploymentRun = null;

for (let attempt = 1; attempt <= 12; attempt++) {
  const workflowRuns = JSON.parse(
    run(
      "gh",
      [
        "run", "list",
        "--repo", REPOSITORY,
        "--workflow", "deploy.yml",
        "--branch", "main",
        "--limit", "20",
        "--json", "databaseId,headSha"
      ],
      PUBLISHING_ROOT
    )
  );

  deploymentRun = workflowRuns.find(
    (workflow) => workflow.headSha === deployedCommit
  );

  if (deploymentRun) break;

  console.log(`Waiting for workflow registration (${attempt}/12)...`);

  await new Promise((resolve) => setTimeout(resolve, 5000));
}

if (!deploymentRun) {
  throw new Error(
    "Commit pushed, but GitHub did not register its deployment within 60 seconds."
  );
}

console.log("Waiting for GitHub Pages deployment...");

run(
  "gh",
  [
    "run", "watch",
    String(deploymentRun.databaseId),
    "--repo", REPOSITORY,
    "--exit-status"
  ],
  PUBLISHING_ROOT
);

console.log("GitHub Pages deployment succeeded.");

const sourceNote = path.resolve(result.sourceNote);
const vaultRoot = path.join(
  process.env.HOME,
  "Vaults",
  "Kaoverse",
  "KORE",
  "SITES",
  "DIVERGENTJOURNALER"
);

const expectedSourceDirectory = path.join(
  vaultRoot,
  mode === "publish" ? "DRAFTS" : "PUBLISHED"
);

if (path.dirname(sourceNote) !== expectedSourceDirectory) {
  throw new Error(
    "Website deployed, but the Obsidian source path was unexpected. Note unchanged."
  );
}

try {
  if (mode === "publish") {
    const destination = path.join(
      vaultRoot,
      "PUBLISHED",
      articleName
    );

    if (fs.existsSync(destination)) {
      throw new Error("A note with this filename already exists in PUBLISHED.");
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(sourceNote, result.trackedMarkdown, "utf8");
    fs.renameSync(sourceNote, destination);
  } else {
    fs.writeFileSync(sourceNote, result.trackedMarkdown, "utf8");
  }

  console.log("Obsidian publication metadata updated successfully.");
} catch (error) {
  throw new Error(
    `Website deployed successfully, but Obsidian could not be updated: ${error.message}`
  );
}
