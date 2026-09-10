const GITHUB_COMPARISON_BASE_BRANCH = 'main';

export const buildGitHubComparisonUrl = (repositoryUrl: string, branch: string): string =>
  `${repositoryUrl.replace(/\/+$/, '')}/compare/${GITHUB_COMPARISON_BASE_BRANCH}...${encodeURIComponent(branch)}`;
