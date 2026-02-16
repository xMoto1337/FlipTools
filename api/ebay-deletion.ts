import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

// eBay Marketplace Account Deletion/Closure Notification endpoint
// Required by eBay for production API access compliance
// See: https://developer.ebay.com/marketplace-account-deletion

const VERIFICATION_TOKEN = process.env.EBAY_DELETION_VERIFICATION_TOKEN || 'fliptools_ebay_notify_2026';
const ENDPOINT_URL = 'https://fliptools.net/api/ebay-deletion';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // eBay sends a challenge code during endpoint validation (GET)
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code as string;
    if (challengeCode) {
      // eBay requires SHA256 hash of: challengeCode + verificationToken + endpoint
      const hash = crypto
        .createHash('sha256')
        .update(challengeCode + VERIFICATION_TOKEN + ENDPOINT_URL)
        .digest('hex');

      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({ challengeResponse: hash });
    }
    return res.status(200).json({ status: 'ok' });
  }

  // Handle actual deletion notifications (POST)
  if (req.method === 'POST') {
    const notification = req.body;
    console.log('eBay account deletion notification received:', JSON.stringify(notification));

    // Acknowledge receipt
    return res.status(200).json({ status: 'received' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
