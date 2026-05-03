// AppError hierarchy for Parasol.
// Server actions return discriminated unions for expected failures.
// AppError subclasses are thrown for unexpected/unrecoverable errors.
// Never throw strings — always throw an AppError subclass.

export class AppError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(message: string, code: string, statusCode = 500) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    // Restore prototype chain (required for instanceof checks after transpilation)
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    }
  }
}

// ─── HTTP-mapped errors ───────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resourceOrMessage = 'Not found', id?: string) {
    const message = id !== undefined
      ? `${resourceOrMessage} not found: ${id}`
      : resourceOrMessage
    super(message, 'NOT_FOUND', 404)
  }
}

export class UnauthorisedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHORISED', 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class ValidationError extends AppError {
  readonly field?: string

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400)
    this.field = field
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409)
  }
}

// ─── Pipeline errors ──────────────────────────────────────────────────────────

export class PipelineError extends AppError {
  readonly stage?: string

  // code is threaded through so subclasses can supply their own code without
  // assigning to the readonly property after super() returns
  constructor(message: string, stage?: string, code = 'PIPELINE_ERROR') {
    super(message, code, 500)
    this.stage = stage
  }
}

export class CitationValidationError extends PipelineError {
  readonly citationId: string
  readonly canonicalId: string

  constructor(citationId: string, canonicalId: string, message?: string) {
    super(
      message ?? `Citation '${canonicalId}' did not resolve in corpus`,
      'verify-citations',
      'CITATION_VALIDATION_FAILED',
    )
    this.citationId = citationId
    this.canonicalId = canonicalId
  }
}

// ─── Intake errors ────────────────────────────────────────────────────────────

export class IntakeError extends AppError {
  constructor(message: string, code = 'INTAKE_ERROR') {
    super(message, code, 422)
  }
}

export class UnsupportedFormatError extends IntakeError {
  readonly mimeType?: string

  constructor(mimeType?: string) {
    super(
      mimeType
        ? `Unsupported file format: ${mimeType}`
        : 'Unsupported file format',
      'UNSUPPORTED_FORMAT',
    )
    this.mimeType = mimeType
  }
}

export class UnsupportedContractTypeError extends IntakeError {
  readonly detectedType?: string

  constructor(detectedType?: string) {
    super(
      detectedType
        ? `Contract type '${detectedType}' is not yet supported`
        : 'Contract type not supported',
      'UNSUPPORTED_CONTRACT_TYPE',
    )
    this.detectedType = detectedType
  }
}

export class FileTooLargeError extends IntakeError {
  readonly byteSize: number
  readonly limitBytes: number

  constructor(byteSize: number, limitBytes: number) {
    super(
      `File size ${byteSize} bytes exceeds the ${limitBytes} byte limit`,
      'FILE_TOO_LARGE',
    )
    this.byteSize = byteSize
    this.limitBytes = limitBytes
  }
}

export class QualityTooLowError extends IntakeError {
  constructor(message = 'Document quality is too low to read reliably') {
    super(message, 'QUALITY_TOO_LOW')
  }
}

// ─── Corpus errors ────────────────────────────────────────────────────────────

export class CorpusError extends AppError {
  readonly sourceSlug?: string

  // code is threaded through so subclasses can supply EMBEDDING_ERROR without
  // assigning to the readonly property after super() returns
  constructor(message: string, sourceSlug?: string, code = 'CORPUS_ERROR') {
    super(message, code, 500)
    this.sourceSlug = sourceSlug
  }
}

export class EmbeddingError extends CorpusError {
  constructor(message = 'Failed to generate embeddings') {
    super(message, undefined, 'EMBEDDING_ERROR')
  }
}
