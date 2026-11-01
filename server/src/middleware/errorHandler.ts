import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import multer from 'multer';

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const occurrenceId = randomUUID();
  console.error(`[${occurrenceId}] Unhandled request error`, {
    method: req.method,
    path: req.path,
    error: error instanceof Error ? { name: error.name, message: error.message, code: (error as any).code } : 'unknown',
  });

  if (error.code === 'P2002') {
    return res.status(409).json({ error: 'Record already exists' });
  }

  if (error.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }

  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;

  if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
    return res.status(statusCode).json({
      error: 'Erro interno do servidor',
      occurrenceId,
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', error: 'Não foi possível processar a solicitação. Verifique os dados informados.', details: error.issues.map(issue => ({ field: issue.path.join('.'), message: 'O valor informado é inválido.' })) });
  }

  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({ code: error.code, error: tooLarge ? 'O arquivo excede o tamanho máximo permitido.' : 'Não foi possível receber o arquivo enviado.' });
  }

  const message = error?.message || 'Erro interno do servidor';

  res.status(statusCode).json({
    ...(error?.code && { code: error.code }),
    error: message,
    ...(error?.details && { details: error.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};
