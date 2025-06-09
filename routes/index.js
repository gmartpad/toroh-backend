import express from 'express';
import statusRoutes from './statusRoutes.js'
import documentRoutes from './documentRoutes.js'

const router = express.Router();

router.use('/documents', documentRoutes)

router.use('', statusRoutes);

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Toroh API' })
})

export default router