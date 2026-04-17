import express from 'express';
import { Token } from '../models/Token.js';
import { Alert } from '../models/Alert.js';
import { fetchTokenData } from '../services/dexScreener.js';

const router = express.Router();

// GET /alerts - Fetch recent alert snapshots
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(100);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /tokens - Add token via API
router.post('/tokens', async (req, res) => {
  const { userId, chain, tokenAddress, marketCapThreshold, volumeThreshold } = req.body;

  if (!userId || !chain || !tokenAddress || !marketCapThreshold || !volumeThreshold) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const tokenId = `${chain}:${tokenAddress}`;

  try {
    const data = await fetchTokenData(chain, tokenAddress);
    if (!data.success) {
      return res.status(400).json({ error: 'Could not verify token on DexScreener' });
    }

    const token = new Token({
      userId,
      chain,
      tokenAddress,
      tokenId,
      marketCapThreshold,
      volumeThreshold,
      lastMarketCap: data.marketCap,
      lastVolumeM5: data.volumeM5,
      lastVolumeH1: data.volumeH1
    });

    await token.save();
    res.status(201).json(token);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /tokens/:id - Remove token via API
router.delete('/tokens/:id', async (req, res) => {
  try {
    const token = await Token.findByIdAndDelete(req.params.id);
    if (!token) return res.status(404).json({ error: 'Token not found' });
    res.json({ message: 'Token removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
