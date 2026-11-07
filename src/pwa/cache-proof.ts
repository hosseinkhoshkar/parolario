/** The old worker's complete cache cannot certify the currently running build. */
export function isVerifiedCacheMessage(data: unknown, expectedBuild: string): boolean {
  return typeof data === 'object' && data !== null && 'ready' in data && data.ready === true
    && 'version' in data && data.version === `wortzeit-shell-${expectedBuild}`
}
