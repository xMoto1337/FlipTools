import type { VercelRequest, VercelResponse } from '@vercel/node';

// Proxy for eBay API calls to avoid CORS issues
// The browser can't call api.ebay.com directly
// Supports both REST APIs and the legacy Trading API (XML)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST to proxy requests' });
  }

  const { endpoint, token, method, payload, tradingApiCall } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  // --- Trading API (XML-based legacy API) ---
  if (tradingApiCall) {
    return handleTradingApi(req, res, tradingApiCall, token, payload);
  }

  // --- REST API ---
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint' });
  }

  const ebayUrl = `https://api.ebay.com${endpoint}`;
  const ebayMethod = method || 'GET';

  try {
    const fetchOptions: RequestInit = {
      method: ebayMethod,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    };

    // Attach body for POST/PUT requests
    if ((ebayMethod === 'POST' || ebayMethod === 'PUT') && payload) {
      fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(ebayUrl, fetchOptions);

    // Some eBay responses may not be JSON (204 No Content, etc.)
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 204 || !contentType.includes('application/json')) {
      return res.status(response.status).json({ ok: response.ok });
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('eBay proxy error:', err);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
}

// Handle eBay Trading API calls (GetMyeBaySelling, etc.)
// Sends XML to api.ebay.com/ws/api.dll and parses the response to JSON
async function handleTradingApi(
  _req: VercelRequest,
  res: VercelResponse,
  callName: string,
  token: string,
  xmlBody: string
) {
  try {
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1271',
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-IAF-TOKEN': token,
        'Content-Type': 'text/xml',
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (!response.ok) {
      console.error(`Trading API ${callName} error:`, response.status, xmlText.substring(0, 500));
      return res.status(response.status).json({
        error: `Trading API error: ${response.status}`,
        xml: xmlText.substring(0, 1000),
      });
    }

    // Parse the XML response into JSON for the client
    if (callName === 'GetMyeBaySelling') {
      const items = parseGetMyeBaySelling(xmlText);
      return res.status(200).json({ items, totalItems: items.length });
    }

    // Default: return raw XML as text
    return res.status(200).json({ xml: xmlText });
  } catch (err) {
    console.error(`Trading API ${callName} error:`, err);
    return res.status(500).json({ error: 'Trading API request failed' });
  }
}

// Parse GetMyeBaySelling XML response into a clean JSON array
function parseGetMyeBaySelling(xml: string): Array<{
  itemId: string;
  title: string;
  currentPrice: number;
  imageUrl: string;
  viewItemUrl: string;
  listingType: string;
  quantity: number;
  quantityAvailable: number;
  status: string;
  startTime: string;
  conditionDisplayName: string;
}> {
  const items: Array<{
    itemId: string;
    title: string;
    currentPrice: number;
    imageUrl: string;
    viewItemUrl: string;
    listingType: string;
    quantity: number;
    quantityAvailable: number;
    status: string;
    startTime: string;
    conditionDisplayName: string;
  }> = [];

  // Extract all <Item> blocks from the ActiveList
  const activeListMatch = xml.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/);
  if (!activeListMatch) return items;

  const activeListXml = activeListMatch[1];
  const itemMatches = activeListXml.match(/<Item>([\s\S]*?)<\/Item>/g);
  if (!itemMatches) return items;

  for (const itemXml of itemMatches) {
    const get = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };

    // Get first PictureURL (there may be multiple)
    const picMatch = itemXml.match(/<PictureURL>([^<]+)<\/PictureURL>/);

    items.push({
      itemId: get('ItemID'),
      title: decodeXmlEntities(get('Title')),
      currentPrice: Number(get('CurrentPrice') || 0),
      imageUrl: picMatch ? picMatch[1] : '',
      viewItemUrl: get('ViewItemURL'),
      listingType: get('ListingType'),
      quantity: Number(get('Quantity') || 0),
      quantityAvailable: Number(get('QuantityAvailable') || 0),
      status: get('ListingStatus') || 'Active',
      startTime: get('StartTime'),
      conditionDisplayName: get('ConditionDisplayName'),
    });
  }

  return items;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
