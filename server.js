// ES Module Imports
import 'dotenv/config'; // Loads .env file automatically
import express from 'express';
import multer from 'multer';
import pdf from 'pdf-parse/lib/pdf-parse.js'; // pdf-parse might still be default export
import mammoth from 'mammoth';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import cors from 'cors';
import path from 'path'; // For __dirname equivalent if needed
import { fileURLToPath } from 'url'; // For __dirname equivalent

// For __dirname and __filename in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// --- CORS Configuration ---
const corsOptions = {
  origin: ['http://localhost:4200', 'http://localhost:4000'], // Added additional origin
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Explicitly allow methods
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'] // Explicitly allow headers
};
app.use(cors(corsOptions));

// Increase payload size limit for larger documents
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- Initialize Google Gemini AI Client ---
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not set in the environment variables.");
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB file size limit
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF and DOCX are allowed."), false);
    }
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Toroh Backend API is running');
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', version: '1.0.0' });
});

app.post('/api/upload-document', upload.single('documentFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send({ message: 'No file uploaded.' });
  }

  try {
    // Generate a unique session ID
    const sessionId = Date.now().toString();
    
    // Store the file buffer in memory (or you could save to disk temporarily)
    // This is a simple in-memory storage - for production, consider using Redis or another solution
    if (!global.uploadedFiles) {
      global.uploadedFiles = {};
    }
    
    global.uploadedFiles[sessionId] = {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    };
    
    // Return the session ID to the client
    res.json({ sessionId });
    
    // Set a timeout to clean up the file after some time (e.g., 30 minutes)
    setTimeout(() => {
      if (global.uploadedFiles && global.uploadedFiles[sessionId]) {
        delete global.uploadedFiles[sessionId];
        console.log(`Cleaned up file for session ${sessionId}`);
      }
    }, 30 * 60 * 1000);
    
  } catch (error) {
    console.error('Error in /api/upload-document endpoint:', error);
    res.status(500).send({ message: 'Failed to process uploaded file.' });
  }
});

// Modify the existing endpoint to work with the session ID
app.get(
  '/api/generate-flashcards',
  async (req, res) => {
    const { sessionId } = req.query;
    
    if (!sessionId || !global.uploadedFiles || !global.uploadedFiles[sessionId]) {
      return res.status(400).send({ message: 'Invalid or expired session ID.' });
    }
    
    const fileData = global.uploadedFiles[sessionId];
    let extractedText = '';

    try {
      console.log(`Processing ${fileData.originalname} (${fileData.mimetype})`);
      
      if (fileData.mimetype === 'application/pdf') {
        // pdf-parse returns a promise, its default export is the function
        const data = await pdf(fileData.buffer);
        extractedText = data.text;
      } else if (fileData.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { value } = await mammoth.extractRawText({ buffer: fileData.buffer });
        extractedText = value;
      } else {
        return res.status(400).send({ message: 'Unsupported file type for text extraction.' });
      }

      if (!extractedText.trim()) {
        return res.status(400).send({ message: 'Could not extract text from the document or the document is empty.' });
      }

      console.log(`Extracted ${extractedText.length} characters of text`);

      const prompt = `
        Based on the following text, identify the most important concepts and create flashcards.
        Each flashcard should have a "question" and an "answer".
        Return the flashcards as a valid JSON array of objects, where each object has a "question" key and an "answer" key.
        Example: [{"question": "What is the capital of France?", "answer": "Paris"}, {"question": "Explain photosynthesis.", "answer": "It's the process plants use to convert light energy into chemical energy."}]
        Ensure the output is ONLY the JSON array, with no other text before or after it.
        And, independent of the analyzed text's language, ensure the flashcards are in English.
        If the text is in a language other than English, translate the flashcards to English.

        Text:
        ---
        ${extractedText.substring(0, 150000)} 
        ---
        JSON Flashcards:
      `;

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Send an initial event to establish connection
      res.write('event: connected\ndata: Connection established\n\n');

      // Initialize an array to collect all flashcards
      let allFlashcards = [];

      const responseStream = await genAI.models.generateContentStream({
        model: "gemini-2.5-pro-preview-05-06",
        contents: prompt,
        config: {
          temperature: 0.7,
          responseMimeType: "application/json",
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          ],
        }
      });

      let completeResponse = ``;
      let lastProcessedLength = 0; // Keep track of the last processed length of the response

      // Process each chunk as it arrives
      for await (const chunk of responseStream) {
        if (chunk.text) {
          completeResponse += chunk.text;
          // Look for individual flashcard objects in the response
          const flashcardRegex = /\{\s*"question"\s*:\s*"([^"\\]*(\\.[^"\\]*)*)"\s*,\s*"answer"\s*:\s*"([^"\\]*(\\.[^"\\]*)*)"\s*\}/g;
          
          // Find all matches in the new content (from where we last processed)
          const newContent = completeResponse.substring(lastProcessedLength);
          const matches = [...newContent.matchAll(flashcardRegex)];

          if (matches.length > 0) {
            // Process each new flashcard found
            for (const match of matches) {
              try {
                const flashcardJson = match[0];
                completeResponse = completeResponse.replaceAll(flashcardJson + ',', '');
                const flashcard = JSON.parse(flashcardJson);

                // Validate that it has the required fields
                if (flashcard.question && flashcard.answer) {
                  // Send this single flashcard to the client
                  res.write(`event: flashcard\ndata: ${JSON.stringify(flashcard)}\n\n`);
                  
                  // Add to our collection
                  allFlashcards.push(flashcard);
                }
              } catch (parseError) {
                console.log('Error parsing individual flashcard:', parseError);
              }
            }
          }
        }
      }

      // Final processing of the complete response
      try {
        // Send a completion event
        res.write(`event: complete\ndata: Event Stream Completed\n\n`);
        
        // Clean up the file data after processing
        delete global.uploadedFiles[sessionId];
        
      } catch (parseError) {
        console.error("Error parsing Gemini JSON response:", parseError);
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Error processing AI response. The format was not valid JSON.' })}\n\n`);
      }

      // Close the connection
      res.end();

    } catch (error) {
      console.error('Error in /api/generate-flashcards endpoint:', error);
      if (error.response && error.response.promptFeedback) {
        console.error('Gemini API Error - Prompt Feedback:', error.response.promptFeedback);
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'AI generation failed. The prompt may have been blocked.' })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Failed to generate flashcards.', error: error.message })}\n\n`);
      }
      res.end();
    }
  }
);

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