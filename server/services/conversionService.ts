import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type FormatStatus =
  | 'PENDING'
  | 'INPROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'READYFORREVIEW'
  | 'APPROVED';

export interface ConversionResult {
  format: string;
  status: FormatStatus;
  azureBlobPath: string | null;
  errorMessage?: string;
}

// ─── TEXT EXTRACTION ──────────────────────────────────────────────────────────

export async function extractText(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  try {
    if (mimeType === 'application/pdf') {
      const data = await pdfParse(fileBuffer);
      return data.text || '';
    }

    if (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filename.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value || '';
    }

    if (mimeType === 'text/plain' || filename.endsWith('.txt')) {
      return fileBuffer.toString('utf-8');
    }

    return '';
  } catch (err) {
    console.error('[ConversionService] Text extraction failed:', err);
    return '';
  }
}

// ─── SIMPLIFIED TEXT ──────────────────────────────────────────────────────────

export async function generateSimplifiedText(
  rawText: string
): Promise<string> {
  if (!rawText || rawText.trim().length === 0) {
    return 'No content available for simplification.';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[ConversionService] GEMINI_API_KEY not set, using fallback.');
    return rawText.trim();
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `You are an accessibility assistant. 
Rewrite the following document text in plain, simple English 
suitable for a reading level of Grade 6–8. 
Use short sentences. Avoid jargon. 
Preserve all factual information.
Divide output into clear sections with bold headers.
Do not add information that is not in the original text.

TEXT TO SIMPLIFY:
${rawText.slice(0, 8000)}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    return response || rawText.trim();
  } catch (err) {
    console.error('[ConversionService] Gemini simplification failed:', err);
    return rawText.trim();
  }
}

// ─── TRANSCRIPT ───────────────────────────────────────────────────────────────

export function generateTranscript(rawText: string, filename: string): string {
  if (!rawText || rawText.trim().length === 0) {
    return `Transcript for ${filename}\n\n[No text content could be extracted from this file.]`;
  }

  const cleaned = rawText
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\f/g, '\n\n--- Page Break ---\n\n')
    .trim();

  return `TRANSCRIPT\nSource: ${filename}\nGenerated: ${new Date().toISOString()}\n\n${'─'.repeat(50)}\n\n${cleaned}`;
}

// ─── BRAILLE GENERATION ───────────────────────────────────────────────────────

export function generateBraille(text: string): string {
  // Grade 1 Unicode Braille mapping (A-Z, 0-9, punctuation)
  const map: Record<string, string> = {
    'a':'⠁','b':'⠃','c':'⠉','d':'⠙','e':'⠑',
    'f':'⠋','g':'⠛','h':'⠓','i':'⠊','j':'⠚',
    'k':'⠅','l':'⠇','m':'⠍','n':'⠝','o':'⠕',
    'p':'⠏','q':'⠟','r':'⠗','s':'⠎','t':'⠞',
    'u':'⠥','v':'⠧','w':'⠺','x':'⠭','y':'⠽',
    'z':'⠵',
    '1':'⠂','2':'⠆','3':'⠒','4':'⠲','5':'⠢',
    '6':'⠖','7':'⠶','8':'⠦','9':'⠔','0':'⠴',
    '.':'⠲',',':'⠂','?':'⠦','!':'⠖',':':'⠒',
    ';':'⠆','-':'⠤','\'':'⠄','"':'⠄⠄',
    '(':'⠦',')':'⠴',' ':'⠀','\n':'\n',
  };

  const CELLS_PER_LINE = 40;

  // Convert to braille characters
  const converted = text
    .toLowerCase()
    .split('')
    .map(ch => map[ch] ?? '⠀')  // unknown chars → braille space
    .join('');

  // Wrap at 40 cells (standard braille line width)
  const lines: string[] = [];
  for (let i = 0; i < converted.length; i += CELLS_PER_LINE) {
    lines.push(converted.slice(i, i + CELLS_PER_LINE));
  }

  // Add BRF header
  const header = [
    '⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠',
    '⠠⠠⠠⠠⠠ ⠠⠠⠁⠉⠉⠑⠎⠎⠑⠙ ⠠⠠⠙⠕⠉⠥⠍⠑⠝⠞ ⠠⠠⠠⠠⠠',
    '⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠⠠',
    '',
  ].join('\n');

  return header + lines.join('\n');
}

// ─── HIGH CONTRAST PDF ────────────────────────────────────────────────────────

export async function generateHighContrastPdf(
  originalBuffer: Buffer
): Promise<Buffer | null> {
  try {
    const pdfDoc = await PDFDocument.load(originalBuffer);
    const pages = pdfDoc.getPages();

    // Embed a bold yellow border on each page as visual HC indicator
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    for (const page of pages) {
      const { width, height } = page.getSize();
      // Black border frame for high contrast framing
      page.drawRectangle({
        x: 4, y: 4,
        width: width - 8,
        height: height - 8,
        borderColor: rgb(1, 0.84, 0),   // #FFD700 gold
        borderWidth: 4,
        opacity: 0,                      // transparent fill, border only
      });
      // "HIGH CONTRAST VERSION" watermark at top
      page.drawText('HIGH CONTRAST VERSION', {
        x: 10,
        y: height - 20,
        size: 9,
        font,
        color: rgb(1, 0.84, 0),
        opacity: 0.85,
      });
    }

    // Embed metadata indicating high-contrast version
    pdfDoc.setTitle(
      `[HIGH CONTRAST] ${pdfDoc.getTitle() ?? 'Document'}`
    );
    pdfDoc.setSubject('High Contrast Accessible Version');
    pdfDoc.setKeywords(['accessible', 'high-contrast', 'WCAG']);

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (err) {
    console.error('[ConversionService] High contrast PDF generation failed:', err);
    return null;
  }
}

// ─── TTS AUDIO (Text-to-Speech) ───────────────────────────────────────────────
// Uses Web Speech API simulation via text file for now.
// Returns the transcript text as an .mp3-named .txt for audio player fallback.
// Replace this function body with a real TTS SDK call when API keys are available.

export async function generateAudioFile(
  rawText: string,
  filename: string
): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
  // PHASE 1: Create a structured audio script file (readable by TTS-capable browsers)
  // This is intentional scaffolding — real audio generation requires a TTS API key.
  // The content viewer will use the Web Speech API (window.speechSynthesis) to read
  // the transcript text client-side when no audio blob URL is available.

  const script = rawText
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\*\*/g, '')
    .trim();

  const audioScript = `AUDIO_SCRIPT\nSource: ${filename}\nDuration: ~${Math.ceil(
    script.split(' ').length / 130
  )} minutes at average reading speed\n\n${'─'.repeat(50)}\n\n${script}`;

  return {
    buffer: Buffer.from(audioScript, 'utf-8'),
    mimeType: 'text/plain',
    extension: 'txt',
  };
}
