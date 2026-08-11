/** Authenticated minimal outbound client for a configured cc-connect sidecar. */
export class CcConnectDeliveryClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async send(input: { platform: string; sessionKey: string; content: string }): Promise<void> {
    const response = await fetch(new URL('/v1/cc-connect/deliver', this.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.status !== 204) {
      throw new Error(`cc-connect delivery control returned HTTP ${response.status}`);
    }
  }
}
