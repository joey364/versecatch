import os from 'os'
import path from 'path'
import express from 'express'
import http from 'http'
import fs from 'fs/promises'
import { createReadStream } from 'fs'

import OpenAI from 'openai'
import { Server } from 'socket.io'
import { GoogleGenerativeAI } from "@google/generative-ai"
import 'dotenv/config'
import { getVerseQuery } from './getVerseQuery'


type VerseCaughtResponse = {
  "success": boolean,
  "version": string,
  "book": string,
  "chapter": number,
  "startVerse": number,
  "endVerse": number,
  "verses": { "verse": number, "quote": string }[],

} | {
  success: boolean
  message: string
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''

const app = express()
app.use(express.json())

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: '*'
  }
})

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('audioChunk', async (chunk) => {
    try {
      console.log('le chunk: ', chunk)
      const audioBuffer = Buffer.concat(chunk);

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-'));
      const tmpFile = path.join(tmpDir, 'audio.webm');

      await fs.writeFile(tmpFile, audioBuffer);

      const fileStream = createReadStream(tmpFile);

      const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1"
      });

      // 5. Clean up the temporary file (important!)
      await fs.unlink(tmpFile);
      await fs.rmdir(tmpDir);

      console.log(transcription)

      const prompt = `
Identify explicit and implied Bible verse references in the following transcribed speech.  Return explicit references in the format "Book Chapter:Verse (Version)" or "Book Chapter:Verse-Verse (Version)".  For implied references (e.g., "the verse about love"), return them in the format "Book Chapter:Verse (Version) (implied)". If multiple references are found, separate them with commas. If no Bible verses are mentioned or implied, return "none".

Transcribed Speech: ${transcription}
      `

      const verseReference = await gemini.generateContent(prompt)

      const extractedRefs = extractPartsFromReference(verseReference.response.text())

      if (extractedRefs) {
        const { book, chapter, version, startVerse, endVerse } = extractedRefs;
        const results = await getVerseQuery(version, book, chapter, startVerse, endVerse)

        const response: VerseCaughtResponse = {
          success: true,
          version,
          book,
          chapter,
          startVerse,
          endVerse,
          verses: results.reduce((acc: { verse: number, quote: string }[], curr, idx) => {
            const verse = { verse: curr.startVerse + idx, quote: curr.text }
            acc.push(verse)
            return acc
          }, [])
        }

        socket.emit('verseCaught', JSON.stringify(response))
      } else {
        const response: VerseCaughtResponse = { success: false, message: 'no verse found' }
        console.log("No valid verse reference found.");
        socket.emit('verseCaught', JSON.stringify(response))
      }

      socket.emit('verseCaught', verseReference)

    } catch (error) {
      console.error("Error processing audio:", error)
      socket.emit('error', 'Error processing audio.')
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected')
  });
});


server.listen(3001, () => {
  console.log('Listening on port 3001');
});

function extractPartsFromReference(reference: string) {
  if (reference === 'none') {
    console.warn('No reference found, returning undefined');
    return undefined;
  }

  const regex = /^(?<book>[A-Za-z]+)\s(?<chapter>\d+):(?<verseStart>\d+)(?:-(?<verseEnd>\d+))?\s\((?<version>[A-Za-z]+)\)$/;
  const match = reference.match(regex);

  if (!match) {
    console.error(`Invalid reference format: ${reference}`);
    return undefined;
  }
  if (!match.groups) {
    console.error(`Invalid reference format: ${reference}`);
    return undefined;
  }

  const { book, chapter, verseStart, verseEnd, version } = match.groups;

  const startVerse = parseInt(verseStart, 10);
  const endVerse = verseEnd ? parseInt(verseEnd, 10) : startVerse;

  return {
    book,
    chapter: parseInt(chapter, 10),
    startVerse,
    endVerse,
    version,
  };
}