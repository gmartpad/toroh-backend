// ES Module Imports
import 'dotenv/config'; // Loads .env file automatically
import express from 'express';
import cors from 'cors';

import { corsOptions } from './config/cors.js';
import mainRoutes from './routes/index.js';

// For __dirname and __filename in ES Modules

const app = express();
const port = process.env.PORT || 3000;

app.use(cors(corsOptions));
// Increase payload size limit for larger documents
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- Initialize Google Gemini AI Client ---
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not set in the environment variables.");
  process.exit(1);
}

app.use('/api', mainRoutes)

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Toroh Backend API is running');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  console.log(`CORS enabled for origins: ${corsOptions.origin}`);
});