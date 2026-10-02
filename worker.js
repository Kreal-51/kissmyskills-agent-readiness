/**
 * kissmyskills.com — agent-readiness worker
 *
 * Does three things and nothing else:
 *   1. Fixes the Content-Type bug: the origin echoes the request's Accept header
 *      back as Content-Type, so `Accept: text/markdown` yields
 *      `Content-Type: text/markdown` with an HTML body. Any agent asking for
 *      markdown gets HTML mislabelled as markdown and its parser breaks.
 *   2. Adds Link headers on the homepage pointing at the machine-readable files
 *      we actually have (RFC 8288 / RFC 9727 section 3).
 *   3. Serves /.well-known/api-catalog (RFC 9727).
 *
 * Deliberately NOT here: A2A agent card, auth.md, MCP server card, DNS-AID,
 * Web Bot Auth, ACP/AP2/MPP/x402. Each of those advertises an interface this
 * site does not have. An agent that trusts them lands on a 404. Agentic
 * commerce is already covered by /.well-known/ucp, which Shopify serves itself.
 *
 * Routes: attach ONLY to `kissmyskills.com/` and `kissmyskills.com/.well-known/*`.
 * Do not attach to `/*` — the whole storefront would then depend on this worker.
 */

const ORIGIN = 'https://kissmyskills.com';

const API_CATALOG = {
  linkset: [
    {
      anchor: `${ORIGIN}/`,
      'service-doc': [
        { href: `${ORIGIN}/llms.txt`, type: 'text/markdown',
          title: 'Agent instructions and site index' },
        { href: `${ORIGIN}/llms-full.txt`, type: 'text/markdown',
          title: 'Full agent-readable catalogue index' },
        { href: `${ORIGIN}/agents.md`, type: 'text/markdown',
          title: 'How agents should interact with this store' },
      ],
      describedby: [
        { href: `${ORIGIN}/sitemap.xml`, type: 'application/xml',
          title: 'Sitemap index' },
        { href: `${ORIGIN}/.well-known/ucp`, type: 'application/json',
          title: 'Universal Commerce Protocol descriptor' },
      ],
    },
  ],
};

// Relations must be IANA-registered ones, otherwise scanners ignore them.
const LINK_HEADER = [
  `<${ORIGIN}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
  `<${ORIGIN}/llms.txt>; rel="service-doc"; type="text/markdown"`,
  `<${ORIGIN}/sitemap.xml>; rel="describedby"; type="application/xml"`,
].join(', ');

function looksLikeHtml(text) {
  const head = text.slice(0, 400).trimStart().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml-stylesheet');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- 2. /.well-known/api-catalog -------------------------------------
    if (url.pathname === '/.well-known/api-catalog') {
      return new Response(JSON.stringify(API_CATALOG, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/linkset+json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const response = await fetch(request);

    // Only touch HTML-ish document responses. Assets, JSON and redirects pass through.
    const status = response.status;
    if (status >= 300 || request.method !== 'GET') return response;

    const ct = response.headers.get('Content-Type') || '';
    const isDocument = ct.startsWith('text/') || ct === '';

    if (!isDocument) return response;

    const body = await response.text();
    const headers = new Headers(response.headers);

    // --- 1. Content-Type correction --------------------------------------
    // The origin mirrors Accept into Content-Type. If the body is HTML but the
    // header claims markdown or plain text, the header is wrong — fix it.
    if (looksLikeHtml(body) && !ct.startsWith('text/html')) {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('X-Content-Type-Corrected', '1'); // remove once the origin rule is found
    }

    // --- 3. Link headers on the homepage only ----------------------------
    if (url.pathname === '/' || url.pathname === '') {
      const existing = headers.get('Link');
      headers.set('Link', existing ? `${existing}, ${LINK_HEADER}` : LINK_HEADER);
    }

    return new Response(body, { status, statusText: response.statusText, headers });
  },
};
