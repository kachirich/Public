// Adapters take fetch as a constructor arg so tests inject a fake and
// assert the exact requests; production passes globalThis.fetch.
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class AdapterHttpError extends Error {
  constructor(
    readonly adapter: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${adapter}: HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'AdapterHttpError';
  }
}

export async function expectOk(adapter: string, res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new AdapterHttpError(adapter, res.status, text);
  return text ? JSON.parse(text) : {};
}
