/** ACP connections reuse existing credentials and never start interactive sign-in. */
export function passiveAgentEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...environment, NO_BROWSER: 'true', BROWSER: 'www-browser' };
}

/** Ignore JSON-RPC content: an assistant quoting a login prompt is not a login flow. */
export function isInteractiveAuthenticationPrompt(output: string): boolean {
  return output.split('\n').some(line => {
    const text = line.slice(0, 2048).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
    return (
      !text.startsWith('{') &&
      /opening (?:an? )?authentication page|please visit.*(?:authorize|authenticate)|enter (?:the )?(?:authorization|authentication) code|https:\/\/accounts\.google\.com\/o\/oauth2/i.test(
        text,
      )
    );
  });
}
