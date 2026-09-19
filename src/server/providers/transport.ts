// Node's HTTP transport has no implicit five-minute headers/body timeout. Cancellation
// remains wired through the socket, including while a local model is loading.
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

export function completionRequest(url: string, headers: Record<string, string>, body: string, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith('https:') ? https : http).request(url, {
      method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, signal,
    }, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode || 502, headers: responseHeaders }));
    });
    request.on('error', reject);
    request.end(body);
  });
}
