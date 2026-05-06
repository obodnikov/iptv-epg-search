/**
 * Vercel Serverless Function - EPG Proxy
 * Proxies EPG requests to bypass CORS restrictions
 */

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get EPG URL from query parameter
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Only allow http and https protocols
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'Only HTTP(S) URLs are allowed' });
  }

  try {
    console.log('Proxying request to:', url);

    // Fetch the EPG data
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IPTV-EPG-Search/1.0)',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `EPG server returned ${response.status}`
      });
    }

    // Get the response as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Security: enforce content-type allowlist for untrusted upstream responses
    // Only allow safe, non-executable types through
    const rawType = (response.headers.get('content-type') || '').toLowerCase();
    // Extract base media type (strip parameters like charset)
    const mediaType = rawType.split(';')[0].trim();
    const ALLOWED_TYPES = [
      'application/gzip',
      'application/x-gzip',
      'application/octet-stream',
      'application/xml',
      'text/xml',
      'text/plain',
      'audio/x-mpegurl',
      'audio/mpegurl',
      'application/vnd.apple.mpegurl',
      'application/x-mpegurl'
    ];

    // Determine safe content-type to serve (exact match only)
    const isAllowed = ALLOWED_TYPES.includes(mediaType);
    const contentType = isAllowed ? rawType : 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    // Security: prevent MIME sniffing, force download for non-allowlisted types
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!isAllowed) {
      res.setHeader('Content-Disposition', 'attachment');
    }

    // Send the buffer
    return res.send(buffer);

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: 'Failed to fetch EPG data',
      message: error.message
    });
  }
}
