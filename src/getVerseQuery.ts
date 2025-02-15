import { QueryTypes } from "sequelize";
import { sequelize } from "./sequelize";

export async function getVerseQuery(version: string, book: string, chapter: number, startVerse: number, endVerse: number = startVerse) {

  version = version.trim().toLowerCase()

  const results = await sequelize.query(
    `
    SELECT book, chapter, verse, text 
    FROM ${sequelize.literal(version)}
    WHERE book = :book AND chapter = :chapter AND verse BETWEEN :startVerse AND :endVerse
  `,
    {
      replacements: {
        book: book,
        chapter: chapter,
        startVerse: startVerse,
        endVerse: endVerse,
      },
      type: QueryTypes.SELECT,
    }
  )
  return results as unknown as GetVerseQueryResponse[]

}


export type GetVerseQueryResponse = {
  book: string
  version: string
  chapter: number
  startVerse: number
  endVerse: number
  text: string
}