import express from 'express';
import { generateFlashcards, uploadDocument } from '../controllers/documentController.js';
import multer from 'multer';

const router = express.Router()

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

router.post('/upload-document', upload.single('documentFile'), uploadDocument);
router.get('/generate-flashcards', generateFlashcards)

export default router;