import { describe, it, expect } from 'vitest'
import {
  AppError,
  NotFoundError,
  UnauthorisedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  PipelineError,
  CitationValidationError,
  IntakeError,
  UnsupportedFormatError,
  UnsupportedContractTypeError,
  FileTooLargeError,
  QualityTooLowError,
  CorpusError,
  EmbeddingError,
} from './index'

describe('AppError', () => {
  it('sets name, code, statusCode, message', () => {
    const err = new AppError('something broke', 'TEST_CODE', 503)
    expect(err.name).toBe('AppError')
    expect(err.code).toBe('TEST_CODE')
    expect(err.statusCode).toBe(503)
    expect(err.message).toBe('something broke')
    expect(err).toBeInstanceOf(Error)
  })

  it('defaults statusCode to 500', () => {
    const err = new AppError('oops', 'ERR')
    expect(err.statusCode).toBe(500)
  })

  it('serialises to JSON without stack trace', () => {
    const json = new AppError('msg', 'CODE').toJSON()
    expect(json).toEqual({ name: 'AppError', code: 'CODE', message: 'msg', statusCode: 500 })
    expect(json).not.toHaveProperty('stack')
  })
})

describe('HTTP-mapped errors', () => {
  it('NotFoundError has 404 and name', () => {
    const err = new NotFoundError()
    expect(err.statusCode).toBe(404)
    expect(err.name).toBe('NotFoundError')
    expect(err).toBeInstanceOf(AppError)
  })

  it('UnauthorisedError has 401', () => {
    expect(new UnauthorisedError().statusCode).toBe(401)
  })

  it('ForbiddenError has 403', () => {
    expect(new ForbiddenError().statusCode).toBe(403)
  })

  it('ValidationError carries optional field', () => {
    const err = new ValidationError('required', 'email')
    expect(err.statusCode).toBe(400)
    expect(err.field).toBe('email')
  })

  it('ValidationError without field is fine', () => {
    const err = new ValidationError('bad input')
    expect(err.field).toBeUndefined()
  })

  it('ConflictError has 409', () => {
    expect(new ConflictError('already exists').statusCode).toBe(409)
  })
})

describe('PipelineError', () => {
  it('carries stage name', () => {
    const err = new PipelineError('comparison failed', 'compare-playbook')
    expect(err.stage).toBe('compare-playbook')
    expect(err.statusCode).toBe(500)
  })

  it('works without stage', () => {
    const err = new PipelineError('pipeline broke')
    expect(err.stage).toBeUndefined()
  })
})

describe('CitationValidationError', () => {
  it('identifies citation and canonical id', () => {
    const err = new CitationValidationError('cit-123', 'dpa-2019-s49')
    expect(err.citationId).toBe('cit-123')
    expect(err.canonicalId).toBe('dpa-2019-s49')
    expect(err.code).toBe('CITATION_VALIDATION_FAILED')
    expect(err.message).toContain('dpa-2019-s49')
    expect(err).toBeInstanceOf(PipelineError)
  })

  it('accepts custom message', () => {
    const err = new CitationValidationError('id', 'canonical', 'custom msg')
    expect(err.message).toBe('custom msg')
  })
})

describe('Intake errors', () => {
  it('UnsupportedFormatError includes mime type', () => {
    const err = new UnsupportedFormatError('application/rtf')
    expect(err.mimeType).toBe('application/rtf')
    expect(err.code).toBe('UNSUPPORTED_FORMAT')
    expect(err).toBeInstanceOf(IntakeError)
  })

  it('UnsupportedFormatError without mime is fine', () => {
    const err = new UnsupportedFormatError()
    expect(err.mimeType).toBeUndefined()
  })

  it('UnsupportedContractTypeError includes detected type', () => {
    const err = new UnsupportedContractTypeError('employment')
    expect(err.detectedType).toBe('employment')
    expect(err.code).toBe('UNSUPPORTED_CONTRACT_TYPE')
  })

  it('FileTooLargeError carries size info', () => {
    const err = new FileTooLargeError(30_000_000, 20_000_000)
    expect(err.byteSize).toBe(30_000_000)
    expect(err.limitBytes).toBe(20_000_000)
    expect(err.code).toBe('FILE_TOO_LARGE')
  })

  it('QualityTooLowError has default message', () => {
    const err = new QualityTooLowError()
    expect(err.message).toContain('quality')
    expect(err.code).toBe('QUALITY_TOO_LOW')
  })
})

describe('Corpus errors', () => {
  it('CorpusError carries source slug', () => {
    const err = new CorpusError('scraper failed', 'kenya-acts')
    expect(err.sourceSlug).toBe('kenya-acts')
  })

  it('EmbeddingError is a CorpusError', () => {
    const err = new EmbeddingError()
    expect(err).toBeInstanceOf(CorpusError)
    expect(err.code).toBe('EMBEDDING_ERROR')
  })
})

describe('instanceof chain', () => {
  it('all errors are instanceof AppError and Error', () => {
    const errors = [
      new NotFoundError(),
      new UnauthorisedError(),
      new ForbiddenError(),
      new ValidationError('x'),
      new ConflictError('x'),
      new PipelineError('x'),
      new CitationValidationError('a', 'b'),
      new IntakeError('x'),
      new UnsupportedFormatError(),
      new UnsupportedContractTypeError(),
      new FileTooLargeError(1, 2),
      new QualityTooLowError(),
      new CorpusError('x'),
      new EmbeddingError(),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(AppError)
      expect(err).toBeInstanceOf(Error)
    }
  })
})
