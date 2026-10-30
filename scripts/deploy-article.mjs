
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const REPOSITORY = "divergentjournaler/divergentjournaler";
const EXPECTED_REMOTE =
  "https://github.com/divergentjournaler/divergentjournaler.git";

const articleName = process.argv[2];
const mode = process.argv[3];
const preflight = process.argv.includes("--preflight");

const vaultRoot = path.join(
  process.env.HOME ?? "",
  "Vaults", "Kaoverse", "KORE", "SITES", "DIVERGENTJOURNALER"
);

const sourceNote = path.join(
  vaultRoot,
  mode === "publish" ? "DRAFTS" : "PUBLISHED",
  articleName ?? ""
);

const destination = path.join(
  vaultRoot, "PUBLISHED", articleName ?? ""
);

const lockDirectory = path.join(
  ROOT, ".git", "dj-deploy-lock"
);

function run(command, args, cwd = ROOT, extra = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...extra
  }).trim();
}

function git(args) {
  return run("git", args);
}

function requireGitHubAccount() {
  let active;

  try {
    active = run("gh", ["api", "user", "--jq", ".login"]);
  } catch {
    throw new Error(
      "DJ Publish stopped. Could not verify the active GitHub account. " +
      "No changes made."
    );
  }

  if (active !== "divergentjournaler") {
    throw new Error(
      `DJ Publish stopped. Active GitHub account: ${active}. ` +
      "Required account: divergentjournaler. " +
      "Switch accounts and try again. No changes made."
    );
  }
}

function remoteHead() {
  const output = git([
    "ls-remote", "origin", "refs/heads/main"
  ]);

  const match = output.match(
    /^([0-9a-f]{40,64})\s+refs\/heads\/main$/
  );

  if (!match) {
    throw new Error("Could not verify GitHub main.");
  }

  return match[1];
}

function requireNote() {
  if (
    !fs.existsSync(sourceNote) ||
    !fs.lstatSync(sourceNote).isFile()
  ) {
    throw new Error(
      `Obsidian source note missing: ${sourceNote}`
    );
  }

  if (mode === "publish" && fs.existsSync(destination)) {
    throw new Error(
      "An article with this name already exists in PUBLISHED."
    );
  }

  if (!fs.existsSync(path.dirname(destination))) {
    throw new Error("Obsidian PUBLISHED folder is missing.");
  }
}

function inspect() {
  const actualRoot = fs.realpathSync(
    git(["rev-parse", "--show-toplevel"])
  );

  if (actualRoot !== fs.realpathSync(ROOT)) {
    throw new Error("Unexpected Git repository root.");
  }

  if (git(["symbolic-ref", "--short", "HEAD"]) !== "main") {
    throw new Error(
      "Switch the local website repository to main first."
    );
  }

  if (git(["remote", "get-url", "origin"]) !== EXPECTED_REMOTE) {
    throw new Error("Unexpected origin remote.");
  }

  const local = git(["rev-parse", "HEAD"]);
  const remote = remoteHead();
  const base = git(["merge-base", "HEAD", remote]);

  if (base !== remote) {
    throw new Error(
      "GitHub main has changes not incorporated locally. " +
      "Synchronize manually before publishing."
    );
  }

  const changed = git([
    "status", "--porcelain", "--untracked-files=all"
  ]);

  return {
    changed: Boolean(changed),
    ahead: local !== remote,
    local,
    remote
  };
}

function inside(directory, file) {
  return file.startsWith(directory + path.sep);
}

function verifyResult(result) {
  if (
    !result ||
    !Array.isArray(result.images) ||
    typeof result.articleFile !== "string" ||
    typeof result.trackedMarkdown !== "string" ||
    typeof result.sourceNote !== "string"
  ) {
    throw new Error(
      "Converter returned incomplete publishing results."
    );
  }

  if (path.resolve(result.sourceNote) !== sourceNote) {
    throw new Error(
      "Converter returned an unexpected Obsidian source note."
    );
  }

  const articleDir = path.join(
    ROOT, "src", "content", "markdown"
  );

  const imageDir = path.join(
    ROOT, "public", "uploads", "images"
  );

  const paths = [
    result.articleFile,
    ...result.images,
    ...(result.previousArticleFile
      ? [result.previousArticleFile]
      : [])
  ];

  for (const relative of paths) {
    if (
      typeof relative !== "string" ||
      !relative ||
      path.isAbsolute(relative) ||
      relative.includes("\0")
    ) {
      throw new Error("Converter returned an invalid file path.");
    }

    const absolute = path.resolve(ROOT, relative);

    if (
      !inside(articleDir, absolute) &&
      !inside(imageDir, absolute)
    ) {
      throw new Error(
        `Converter returned unsafe path: ${relative}`
      );
    }

    if (
      fs.existsSync(absolute) &&
      fs.lstatSync(absolute).isSymbolicLink()
    ) {
      throw new Error(
        `Converter returned a symbolic link: ${relative}`
      );
    }
  }

  if (!inside(articleDir, path.resolve(ROOT, result.articleFile))) {
    throw new Error(
      "Article is outside the Markdown directory."
    );
  }

  return paths;
}

// Update Obsidian's YAML date only after deployment succeeds.
function addLastUpdate(markdown) {
  const now = new Date();

  const dottedDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join(".");

  const frontmatter = markdown.match(
    /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?=\r?\n|$))/
  );

  if (!frontmatter) {
    throw new Error(
      "Obsidian article has no YAML frontmatter. " +
      "Cannot set last-update."
    );
  }

  let yaml = frontmatter[2];

  if (/^last-update\s*:/m.test(yaml)) {
    yaml = yaml.replace(
      /^last-update\s*:.*$/m,
      `last-update: ${dottedDate}`
    );
  } else {
    yaml += `\nlast-update: ${dottedDate}`;
  }

  return markdown.replace(
    frontmatter[0],
    frontmatter[1] + yaml + frontmatter[3]
  );
}

function waitForDeployment(commit) {
  let runId;

  for (let attempt = 0; attempt < 12; attempt++) {
    const runs = JSON.parse(
      run("gh", [
        "run", "list",
        "--repo", REPOSITORY,
        "--workflow", "deploy.yml",
        "--branch", "main",
        "--limit", "20",
        "--json", "databaseId,headSha"
      ])
    );

    const match = runs.find(
      item => item.headSha === commit
    );

    if (match) {
      runId = match.databaseId;
      break;
    }

    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0, 0, 5000
    );
  }

  if (!runId) {
    throw new Error(
      "GitHub accepted the push, but the deployment " +
      "workflow was not found."
    );
  }

  run("gh", [
    "run", "watch",
    String(runId),
    "--repo", REPOSITORY,
    "--exit-status"
  ]);
}

// Validate arguments.
if (
  !articleName ||
  articleName !== path.basename(articleName) ||
  !articleName.toLowerCase().endsWith(".md") ||
  articleName === ".md"
) {
  throw new Error(
    "Provide a valid Markdown article filename."
  );
}

if (!["publish", "update"].includes(mode)) {
  throw new Error(
    'Mode must be "publish" or "update".'
  );
}

if (
  !preflight &&
  process.env.DJ_ENABLE_DEPLOY !== "YES"
) {
  throw new Error(
    "Deployment disabled. DJ_ENABLE_DEPLOY=YES is required."
  );
}

// READ-ONLY PREFLIGHT
if (preflight) {
  requireGitHubAccount();
  requireNote();

  const local = git(["rev-parse", "HEAD"]);
  const remote = remoteHead();
  const branch = git([
    "symbolic-ref", "--short", "HEAD"
  ]);
  const origin = git([
    "remote", "get-url", "origin"
  ]);
  const root = fs.realpathSync(
    git(["rev-parse", "--show-toplevel"])
  );
  const base = git([
    "merge-base", "HEAD", remote
  ]);

  if (
    branch !== "main" ||
    origin !== EXPECTED_REMOTE ||
    root !== fs.realpathSync(ROOT) ||
    base !== remote
  ) {
    throw new Error(
      "Local main/remote configuration needs attention. " +
      "No changes made."
    );
  }

  const details = git([
    "status", "--porcelain", "--untracked-files=all"
  ]);

  console.log(JSON.stringify({
    outstanding: Boolean(details) || local !== remote,
    uncommitted: Boolean(details),
    unpushed: local !== remote
  }));

} else {
  // LIVE DEPLOYMENT
  let pushAccepted = false;
  let conversionStarted = false;
  let lockAcquired = false;

  try {
    requireGitHubAccount();
    requireNote();

    fs.mkdirSync(lockDirectory);
    lockAcquired = true;

    git(["fetch", "origin", "main"]);

    const state = inspect();

    const publishAll =
      process.env.DJ_PUBLISH_ALL === "YES";

    if (
      (state.changed || state.ahead) &&
      !publishAll
    ) {
      throw new Error(
        "Unpublished website changes exist. " +
        "No article was converted. " +
        "Use QuickAdd to authorize Publish All."
      );
    }

    if (publishAll) {
      console.log(
        "Publish All authorized: outstanding local " +
        "changes will be included."
      );
    }

    conversionStarted = true;

    const conversionOutput = run(
      process.execPath,
      [
        path.join(
          ROOT, "scripts", "publish-article.mjs"
        ),
        articleName,
        mode
      ],
      ROOT,
      {
        env: {
          ...process.env,
          DJ_PUBLISH_ROOT: ROOT
        }
      }
    );

    console.log(conversionOutput);

    const resultLine = conversionOutput
      .split(/\r?\n/)
      .find(line => line.startsWith("PUBLISH_RESULT="));

    if (!resultLine) {
      throw new Error(
        "Converter did not return publishing results."
      );
    }

    const result = JSON.parse(
      resultLine.slice("PUBLISH_RESULT=".length)
    );

    const filesToStage = verifyResult(result);

    requireNote();

    if (result.previousArticleFile) {
      const oldFile = path.resolve(
        ROOT,
        result.previousArticleFile
      );

      if (
        !fs.existsSync(oldFile) ||
        !fs.lstatSync(oldFile).isFile()
      ) {
        throw new Error(
          "Previous article file missing or not a regular file."
        );
      }

      fs.unlinkSync(oldFile);
    }

    if (publishAll) {
      git(["add", "-A"]);
    } else {
      git(["add", "--", ...filesToStage]);
    }

    const staged = git([
      "diff", "--cached", "--name-only"
    ]);

    if (!staged && !state.ahead) {
      throw new Error("No changes to publish.");
    }

    console.log("Validating Astro build...");

    run("npm", ["run", "build"]);

    if (staged) {
      git([
        "commit",
        "-m",
        `${mode === "publish" ? "Publish" : "Update"} ` +
        `article: ${articleName}` +
        (publishAll
          ? " (including site changes)"
          : "")
      ]);
    }

    const deployedCommit = git([
      "rev-parse", "HEAD"
    ]);

    if (remoteHead() !== state.remote) {
      throw new Error(
        "GitHub main changed during publishing. " +
        "Nothing pushed; local changes preserved."
      );
    }

    try {
      git([
        "push", "origin", "HEAD:main"
      ]);

      pushAccepted = true;

    } catch (error) {
      if (remoteHead() === deployedCommit) {
        pushAccepted = true;
      } else {
        throw error;
      }
    }

    console.log(
      `GitHub accepted ${deployedCommit}; ` +
      "waiting for deployment..."
    );

    waitForDeployment(deployedCommit);

    // UPDATE OBSIDIAN ONLY AFTER SUCCESSFUL DEPLOYMENT
    requireNote();

    let obsidianMarkdown = result.trackedMarkdown;

    if (mode === "update") {
      obsidianMarkdown = addLastUpdate(
        obsidianMarkdown
      );
    }

    fs.writeFileSync(
      sourceNote,
      obsidianMarkdown,
      "utf8"
    );

    if (mode === "publish") {
      fs.renameSync(sourceNote, destination);
    }

    console.log(
      "GitHub Pages deployment succeeded. " +
      "Obsidian article updated."
    );

  } catch (error) {
    console.error(error.message);

    if (pushAccepted) {
      console.error(
        "GitHub accepted the push. " +
        "Check deployment and Obsidian before retrying."
      );
    } else if (conversionStarted) {
      console.error(
        "Local files/commits may have changed. " +
        "Nothing was reset or deleted for recovery. " +
        "Inspect Git status before retrying."
      );
    }

    process.exitCode = 1;

  } finally {
    if (lockAcquired) {
      try {
        fs.rmdirSync(lockDirectory);
      } catch (error) {
        console.error(
          `Could not remove deployment lock: ${error.message}`
        );
        process.exitCode = 1;
      }
    }
  }
}
