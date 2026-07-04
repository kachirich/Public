import type { FetchLike } from './http.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

// Records every request and replays queued responses in order.
export function fakeFetch(responses: { status?: number; body: unknown }[]): {
  fetchFn: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (!res) throw new Error('fakeFetch: no response queued');
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchFn, calls };
}
