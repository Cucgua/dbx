import { requestJson } from '@/lib/httpJson';

export type LatestReleaseInfo = {
  version: string;
  notes?: string;
  pub_date?: string;
};

type GitHubLatestRelease = {
  tag_name: string;
  body: string | null;
  published_at: string | null;
};

const LATEST_RELEASE_URL = 'https://dl.dbxio.com/releases/latest/latest.json';
const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/t8y2/dbx/releases/latest';

function normalizeVersion(version: string) {
  return version.replace(/^v/, '');
}

export async function fetchLatestReleaseInfo(): Promise<LatestReleaseInfo | null> {
  try {
    const release = await requestJson<LatestReleaseInfo>(LATEST_RELEASE_URL);
    return release.version ? { ...release, version: normalizeVersion(release.version) } : null;
  } catch {
    return fetchGitHubLatestReleaseInfo();
  }
}

export async function fetchGitHubLatestReleaseInfo(): Promise<LatestReleaseInfo | null> {
  try {
    const release = await requestJson<GitHubLatestRelease>(GITHUB_LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    return {
      version: normalizeVersion(release.tag_name),
      notes: release.body || undefined,
      pub_date: release.published_at || undefined,
    };
  } catch {
    return null;
  }
}
