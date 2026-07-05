import QRCode from 'qrcode';

// Server-side QR generation — no client JS, no external service (keeps us
// self-contained). Encodes the professional's booking page with a ?src=qr
// marker so scans are attributable. GET ?format=svg for vector, default PNG.
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL ?? 'http://localhost:3002';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get('format') ?? 'png';
  const target = `${PUBLIC_WEB_URL}/professionals/${id}?src=qr`;

  if (format === 'svg') {
    const svg = await QRCode.toString(target, { type: 'svg', margin: 1, width: 600 });
    return new Response(svg, {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
    });
  }

  const png = await QRCode.toBuffer(target, { type: 'png', margin: 1, width: 600 });
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-disposition': `inline; filename="booking-qr-${id}.png"`,
      'cache-control': 'public, max-age=3600',
    },
  });
}
