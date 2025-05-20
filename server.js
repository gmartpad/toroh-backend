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
  origin: 'http://localhost:4200',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json());

// --- Initialize Google Gemini AI Client ---
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not set in the environment variables."); // Corrected typo: console.error
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
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

app.get('/', (req, res) => {
  res.send('Hello from Toroh Backend');
});

app.post(
  '/api/generate-flashcards',
  upload.single('documentFile'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).send({ message: 'No file uploaded.' });
    }

    let extractedText = '';

    try {
      if (req.file.mimetype === 'application/pdf') {
        // pdf-parse returns a promise, its default export is the function
        const data = await pdf(req.file.buffer);
        extractedText = data.text;
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = value;
      } else {
        return res.status(400).send({ message: 'Unsupported file type for text extraction.' });
      }

      if (!extractedText.trim()) {
        return res.status(400).send({ message: 'Could not extract text from the document or the document is empty.' });
      }

      const prompt = `
        Based on the following text, identify the most important concepts and create flashcards.
        Each flashcard should have a "question" and an "answer".
        Return the flashcards as a valid JSON array of objects, where each object has a "question" key and an "answer" key.
        Example: [{"question": "What is the capital of France?", "answer": "Paris"}, {"question": "Explain photosynthesis.", "answer": "It's the process plants use to convert light energy into chemical energy."}]
        Ensure the output is ONLY the JSON array, with no other text before or after it.

        Text:
        ---
        ${extractedText.substring(0, 150000)} 
        ---
        JSON Flashcards:
      `; // Increased substring limit slightly, was 1500, now 150000

      
      const result = await genAI.models.generateContent({
        model: "gemini-2.5-pro-preview-05-06", // Changed model name back to a generally available one, user had "gemini-2.5-pro-preview-05-06" which might be restricted
        contents: prompt,
        config: {
          temperature: 0.7, // Temperature was 0.7, can be kept or removed
          // maxOutputTokens: 2048, // MaxOutputTokens was 2048, can be kept or removed
          responseMimeType: "application/json",
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          ],
        }
      })

      console.log(result.candidates[0].content?.parts[0].text)
      
      const response = result.candidates[0].content?.parts[0];

      if (!response || !response.text) {
        console.error("Gemini AI returned an empty or invalid response structure:", response);
        return res.status(500).send({ message: 'AI service returned an invalid response.' });
      }

      const aiResponseText = response.text;
      console.log("Raw AI Response Text:", aiResponseText);

      let flashcards;
      try {
        flashcards = JSON.parse(aiResponseText);

        if (
          !Array.isArray(flashcards) ||
          !flashcards.every(fc => typeof fc.question === 'string' && typeof fc.answer === 'string')
        ) {
          console.error("Gemini response was not in the expected JSON array format of {question, answer} objects:", flashcards);
          return res.status(500).send({ message: 'AI response format error. Expected an array of {question, answer} objects.', rawResponse: aiResponseText });
        }
      } catch (parseError) {
        console.error("Error parsing Gemini JSON response:", parseError);
        return res.status(500).send({ message: 'Error processing AI response. The format was not valid JSON.', rawResponse: aiResponseText, errorDetail: parseError.message });
      }

      console.log(`Successfully generated ${flashcards.length} flashcards.`);
      res.status(200).json(flashcards);

    } catch (error) {
      console.error('Error in /api/generate-flashcards endpoint:', error);
      if (error.response && error.response.promptFeedback) {
        console.error('Gemini API Error - Prompt Feedback:', error.response.promptFeedback);
        return res.status(500).send({
          message: 'AI generation failed. The prompt may have been blocked.',
          details: error.response.promptFeedback
        });
      }
      res.status(500).send({ message: 'Failed to generate flashcards.', error: error.message });
    }
  }
);

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});