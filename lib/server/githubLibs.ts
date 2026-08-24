import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function githubLibConfig() {
  return {
    owner: required("PARADE_LIB_GITHUB_OWNER"),
    repo: required("PARADE_LIB_GITHUB_REPO"),
    token: required("PARADE_LIB_GITHUB_TOKEN"),
    branch: process.env.PARADE_LIB_GITHUB_BRANCH?.trim() || "main",
    folder:
      (process.env.PARADE_LIB_GITHUB_FOLDER?.trim() || "")
        .replace(/^\/+|\/+$/g, ""),
  };
}

function githubHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Parade-Suite-Web",
  };
}

export async function listPrivateLIBFiles(): Promise<
  Array<{ name: string; path: string }>
> {
  const { owner, repo, token, branch, folder } = githubLibConfig();
  const encodedFolder = folder
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  const contentsPath = encodedFolder ? `/contents/${encodedFolder}` : `/contents`;

  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}${contentsPath}` +
    `?ref=${encodeURIComponent(branch)}`;

  const response = await fetch(url, {
    headers: githubHeaders(token),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GitHub LIB listing failed (${response.status}). ${detail}`.trim()
    );
  }

  const payload = (await response.json()) as Array<{
    type?: string;
    name?: string;
    path?: string;
  }>;

  if (!Array.isArray(payload)) {
    throw new Error(
      `PARADE_LIB_GITHUB_FOLDER must point to a folder. Received non-list response.`
    );
  }

  return payload
    .filter(
      (item) =>
        item.type === "file" &&
        typeof item.name === "string" &&
        typeof item.path === "string" &&
        item.name.toLowerCase().endsWith(".lib")
    )
    .map((item) => ({ name: item.name!, path: item.path! }));
}

export async function readPrivateLIBFile(path: string): Promise<string> {
  const { owner, repo, token, branch, folder } = githubLibConfig();

  const normalizedPath = path.replace(/^\/+/, "");
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, "");

  const outsideConfiguredFolder =
    normalizedFolder &&
    !normalizedPath.startsWith(`${normalizedFolder}/`);

  if (
    !normalizedPath.toLowerCase().endsWith(".lib") ||
    outsideConfiguredFolder
  ) {
    throw new Error("Invalid LIB path.");
  }

  const encodedPath = normalizedPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/contents/${encodedPath}` +
    `?ref=${encodeURIComponent(branch)}`;

  const response = await fetch(url, {
    headers: githubHeaders(token, "application/vnd.github.raw+json"),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GitHub LIB fetch failed (${response.status}). ${detail}`.trim()
    );
  }

  return await response.text();
}
