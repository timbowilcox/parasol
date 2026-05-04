// Type augmentation for the deep import of pdf-parse.
//
// We import `pdf-parse/lib/pdf-parse.js` directly to skip the package's
// debug harness in `index.js` which executes at require-time and breaks in
// the Next.js bundle. @types/pdf-parse only declares the package entry, so
// we re-declare the same shape for the deep path here.

declare module 'pdf-parse/lib/pdf-parse.js' {
  export interface PdfParseResult {
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    version: string
    text: string
  }
  export interface PdfParseOptions {
    pagerender?: (pageData: unknown) => string | Promise<string>
    max?: number
    version?: string
  }
  function pdfParse(data: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>
  export default pdfParse
}
