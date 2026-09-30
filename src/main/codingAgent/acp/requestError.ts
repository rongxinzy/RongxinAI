/** Preserve the protocol code so authentication failures do not depend on copy. */
export class AcpRequestError extends Error {
  constructor(
    message: string,
    readonly code: unknown,
  ) {
    super(message);
    this.name = 'AcpRequestError';
  }
}
