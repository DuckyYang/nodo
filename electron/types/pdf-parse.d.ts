declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number
    numrender: number
    info: Record<string, unknown>
    metadata: Record<string, unknown>
    text: string
    version: string
  }
  type PdfParse = (filePathOrBuffer: string | Buffer | Uint8Array) => Promise<PdfParseResult>
  const pdfParse: PdfParse & { default?: PdfParse }
  export = pdfParse
}
