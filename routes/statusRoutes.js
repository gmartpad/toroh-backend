import express from 'express';

const router = express.Router();

// API status endpoint
router.get('/status', (req, res) => {
  res.json({ status: 'online', version: '1.0.0' });
});

export default router