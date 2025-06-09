// --- CORS Configuration ---
const corsOptions = {
  origin: ['http://localhost:4200', 'http://localhost:4000'], // Added additional origin
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Explicitly allow methods
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'] // Explicitly allow headers
};

export {
  corsOptions
}