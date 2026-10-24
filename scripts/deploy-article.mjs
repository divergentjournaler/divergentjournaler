import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHING_ROOT = path.resolve(PROJECT_ROOT, "../DivergentJournaler-Publishing");
const REPOSITORY = "divergentjournaler/divergentjournaler";
const EXPECTED_REMOTE = "https://github.com/divergentjournaler/divergentjournaler.git";
const articleName = process.argv[2];
const mode = process.argv[3];
const vaultRoot = path.join(process.env.HOME ?? "", "Vaults", "Kaoverse", "KORE", "SITES", "DIVERGENTJOURNALER");
const sourceNote = path.join(vaultRoot, mode === "publish" ? "DRAFTS" : "PUBLISHED", articleName ?? "");
const destination = path.join(vaultRoot, "PUBLISHED", articleName ?? "");
const lockDirectory = `${PUBLISHING_ROOT}.deploy-lock`;

function run(command, args, cwd = PROJECT_ROOT) {
  return execFileSync(command, args, {
    cwd, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"],
  }).trim();
}

function git(args) {
  return run("git", args, PUBLISHING_ROOT);
}

function remoteHead() {
  const output = git(["ls-remote", "origin", "refs/heads/main"]);
  const match = output.match(/^([0-9a-f]{40,64})\s+refs\/heads\/main$/);
  if (!match) throw new Error("Could not verify GitHub main commit.");
  return match[1];
}

function verifyPublishingWorktree() {
  const actual = fs.realpathSync(git(["rev-parse", "--show-toplevel"]));
  const expected = fs.realpathSync(PUBLISHING_ROOT);
  if (actual !== expected) {
    throw new Error("Unexpected publishing Git worktree. Cancelled.");
  }
  if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    throw new Error("Publishing directory is not a Git worktree.");
  }
}

function untrackedContentFiles() {
  return git([
    "ls-files", "--others", "--exclude-standard", "--",
    "src/content/markdown", "public/uploads/images"
  ]).split("\n").filter(Boolean);
}

function inside(directory, file) {
  return file.startsWith(directory + path.sep) && file !== directory;
}

function requireRegularNote(file) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    throw new Error(
      `Obsidian source note is missing or is not a regular file: ${file}`
    );
  }
}

function verifyResult(result) {
  if (
    !result ||
    typeof result !== "object" ||
    !Array.isArray(result.images) ||
    typeof result.articleFile !== "string" ||
    typeof result.trackedMarkdown !== "string" ||
    typeof result.sourceNote !== "string"
  ) {
    throw new Error("Converter returned incomplete publishing results.");
  }

  if (path.resolve(result.sourceNote) !== sourceNote) {
    throw new Error("Converter returned an unexpected Obsidian source note.");
  }

  const articleDir = path.join(
    PUBLISHING_ROOT, "src", "content", "markdown"
  );
  const imageDir = path.join(
    PUBLISHING_ROOT, "public", "uploads", "images"
  );

  const paths = [
    result.articleFile,
    ...result.images,
    ...(result.previousArticleFile ? [result.previousArticleFile] : [])
  ];

  for (const relative of paths) {
    if (
      typeof relative !== "string" ||
      path.isAbsolute(relative) ||
      relative.includes("\0")
    ) {
      throw new Error("Converter returned an invalid publishing path.");
    }

    const absolute = path.resolve(PUBLISHING_ROOT, relative);

    if (
      fs.existsSync(absolute) &&
      fs.lstatSync(absolute).isSymbolicLink()
    ) {
      throw new Error(`Publishing path is a symbolic link: ${relative}`);
    }

    if (
      !inside(articleDir, absolute) &&
      !inside(imageDir, absolute)
    ) {
      throw new Error(`Unsafe publishing file path: ${relative}`);
    }
  }

  if (
    !inside(
      articleDir,
      path.resolve(PUBLISHING_ROOT, result.articleFile)
    )
  ) {
    throw new Error(
      "Article file must be in the Markdown content directory."
    );
  }

  if (
    result.previousArticleFile &&
    !inside(
      articleDir,
      path.resolve(PUBLISHING_ROOT, result.previousArticleFile)
    )
  ) {
    throw new Error(
      "Previous article file must be in the Markdown content directory."
    );
  }

  for (const relative of result.images) {
    if (
      !inside(imageDir, path.resolve(PUBLISHING_ROOT, relative))
    ) {
      throw new Error(
        "Image file must be in the image upload directory."
      );
    }
  }

  return paths;
}

if (
  !articleName ||
  articleName !== path.basename(articleName) ||
  !articleName.toLowerCase().endsWith(".md") ||
  articleName === ".md"
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

if (!fs.existsSync(PUBLISHING_ROOT)) {
  throw new Error("Publishing workspace not found.");
}

// Preflight checks before conversion or deployment.
requireRegularNote(sourceNote);

if (mode === "publish" && fs.existsSync(destination)) {
  throw new Error(
    "A note with this filename already exists in PUBLISHED."
  );
}

if (!fs.existsSync(path.dirname(destination))) {
  throw new Error("Obsidian PUBLISHED folder is missing.");
}

// Prevent simultaneous publishing runs.
try {
  fs.mkdirSync(lockDirectory);
} catch (error) {
  if (error.code === "EEXIST") {
    throw new Error(
      `Another publishing run may be active. Check lock: ${lockDirectory}`
    );
  }
  throw error;
}

let startingCommit = null;
let deployedCommit = null;
let result = null;
let pushAccepted = false;
let conversionStarted = false;
let initiallyUntracked = [];

try {
  verifyPublishingWorktree();

  if (git(["status", "--porcelain"])) {
    throw new Error(
      "Publishing workspace has uncommitted changes. Deployment cancelled."
    );
  }

  if (git(["remote", "get-url", "origin"]) !== EXPECTED_REMOTE) {
    throw new Error(
      "Unexpected publishing repository. Deployment cancelled."
    );
  }

  git(["fetch", "origin", "main"]);

  startingCommit = git(["rev-parse", "HEAD"]);

  if (
    startingCommit !==
    git(["rev-parse", "refs/remotes/origin/main"])
  ) {
    throw new Error(
      "Publishing workspace is not synchronized with origin/main."
    );
  }

  initiallyUntracked = untrackedContentFiles();

  console.log("Publishing workspace verified and clean.");

  conversionStarted = true;

  const conversionOutput = execFileSync(
    "node",
    [
      path.join(PROJECT_ROOT, "scripts", "publish-article.mjs"),
      articleName,
      mode
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DJ_PUBLISH_ROOT: PUBLISHING_ROOT
      }
    }
  );

  console.log(conversionOutput);

  const resultLine = conversionOutput
    .split(/\r?\n/)
    .find(line => line.startsWith("PUBLISH_RESULT="));

  if (!resultLine) {
    throw new Error("Converter did not return publishing results.");
  }

  result = JSON.parse(
    resultLine.slice("PUBLISH_RESULT=".length)
  );

  const filesToStage = verifyResult(result);

  requireRegularNote(sourceNote);

  if (mode === "publish" && fs.existsSync(destination)) {
    throw new Error(
      "Destination Obsidian note appeared during conversion; cancelled."
    );
  }

  if (result.previousArticleFile) {
    const oldArticle = path.resolve(
      PUBLISHING_ROOT,
      result.previousArticleFile
    );

    if (
      !fs.existsSync(oldArticle) ||
      !fs.lstatSync(oldArticle).isFile()
    ) {
      throw new Error(
        "Previous article file does not exist or is not a regular file."
      );
    }

    fs.unlinkSync(oldArticle);
  }

  git(["add", "--", ...filesToStage]);

  const stagedFiles = git([
    "diff", "--cached", "--name-only"
  ]);

  if (!stagedFiles) {
    throw new Error("No article changes to publish.");
  }

  console.log("Staged files:\n" + stagedFiles);

  git([
    "commit",
    "-m",
    `${mode === "publish" ? "Publish" : "Update"} article: ${articleName}`
  ]);

  deployedCommit = git(["rev-parse", "HEAD"]);

  console.log(
    "Publishing commit prepared:",
    deployedCommit
  );

  try {
    git(["push", "origin", "HEAD:main"]);
    pushAccepted = true;
  } catch (pushError) {
    // A network failure may occur after GitHub accepts the push.
    const actualRemote = remoteHead();

    if (actualRemote === deployedCommit) {
      pushAccepted = true;
      console.warn(
        "Push reported an error, but GitHub confirms the commit was accepted."
      );
    } else {
      throw pushError;
    }
  }

  console.log(
    "Publishing commit pushed to GitHub:",
    deployedCommit
  );

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
      workflow => workflow.headSha === deployedCommit
    );

    if (deploymentRun) break;

    console.log(
      `Waiting for workflow registration (${attempt}/12)...`
    );

    await new Promise(resolve => setTimeout(resolve, 5000));
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

  // Preserve the source if the Obsidian update fails.
  try {
    requireRegularNote(sourceNote);

    if (mode === "publish" && fs.existsSync(destination)) {
      throw new Error(
        "A note with this filename already exists in PUBLISHED."
      );
    }

    fs.writeFileSync(
      sourceNote,
      result.trackedMarkdown,
      "utf8"
    );

    if (mode === "publish") {
      fs.renameSync(sourceNote, destination);
    }

    console.log(
      "Obsidian publication metadata updated successfully."
    );
  } catch (error) {
    throw new Error(
      `Website deployed successfully, but Obsidian could not be updated: ${error.message}`
    );
  }

} catch (error) {
  if (conversionStarted && !pushAccepted && startingCommit) {
    // Never reset if GitHub might have accepted the commit.
    let actualRemote;

    try {
      actualRemote = remoteHead();
    } catch {
      console.error(
        "Cannot verify GitHub main. Leaving publishing workspace untouched for manual recovery."
      );
    }

    if (actualRemote === startingCommit) {
      try {
        verifyPublishingWorktree();

        const newlyUntracked = untrackedContentFiles().filter(
          file => !initiallyUntracked.includes(file)
        );

        if (remoteHead() !== startingCommit) {
          throw new Error(
            "GitHub main changed during recovery; refusing rollback."
          );
        }

        git(["reset", "--hard", startingCommit]);

        for (const relative of newlyUntracked) {
          const absolute = path.resolve(
            PUBLISHING_ROOT,
            relative
          );

          const articleDir = path.join(
            PUBLISHING_ROOT,
            "src",
            "content",
            "markdown"
          );

          const imageDir = path.join(
            PUBLISHING_ROOT,
            "public",
            "uploads",
            "images"
          );

          if (
            !inside(articleDir, absolute) &&
            !inside(imageDir, absolute)
          ) {
            continue;
          }

          if (
            fs.existsSync(absolute) &&
            fs.lstatSync(absolute).isFile()
          ) {
            fs.unlinkSync(absolute);
          }
        }

        console.error(
          "Pre-push changes rolled back in verified publishing worktree."
        );
      } catch (recoveryError) {
        console.error(
          "Automatic rollback failed; manual recovery required:",
          recoveryError.message
        );
      }
    } else if (actualRemote) {
      console.error(
        "Remote main changed or accepted the push. No rollback performed."
      );
    }
  } else if (pushAccepted) {
    console.error(
      "GitHub accepted the commit. No rollback performed; check deployment and Obsidian state."
    );
  }

  throw error;

} finally {
  try {
    fs.rmdirSync(lockDirectory);
  } catch (lockError) {
    console.error(
      `Could not remove publishing lock ${lockDirectory}: ${lockError.message}`
    );
    console.error(
      "Remove the lock manually only after confirming no publishing run is active."
    );
  }
}