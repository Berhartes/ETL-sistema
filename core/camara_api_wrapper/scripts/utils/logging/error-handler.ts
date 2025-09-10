/**
 * Sistema de tratamento de erros para o ETL de dados da Câmara dos Deputados
 */
import { logger } from './logger.js';

export class WrapperError extends Error {
  constructor(message: string, public readonly cause?: any) {
    super(message);
    this.name = 'WrapperError';
    Object.setPrototypeOf(this, WrapperError.prototype);
  }
}

export class ApiError extends WrapperError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    cause?: any
  ) {
    super(message, cause);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export class NotFoundError extends ApiError {
  constructor(endpoint: string, message: string = 'Recurso não encontrado') {
    super(message, 404, endpoint);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Registra um erro no sistema de log e opcionalmente no armazenamento
 */
export function handleError(error: any, context: string): void {
  if (error instanceof WrapperError) {
    logger.error(`[${context}] ${error.message}`, error.cause);
  } else if (error instanceof Error) {
    logger.error(`[${context}] ${error.message}`, error);
  } else {
    logger.error(`[${context}] Erro desconhecido`, error);
  }

  // Aqui poderíamos adicionar código para salvar o erro no Firestore
  // quando estiver configurado
}

/**
 * Configuração de retry com backoff exponencial
 */
export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitterRange?: number;
  backoffMultiplier?: number;
}

/**
 * Calcula delay com backoff exponencial e jitter aleatório
 */
function calculateRetryDelay(
  attempt: number, 
  baseDelay: number = 500,
  maxDelay: number = 4000,
  jitterRange: number = 0.1,
  backoffMultiplier: number = 2
): number {
  // Backoff exponencial: baseDelay * (multiplier ^ attempt)
  const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
  
  // Aplicar limite máximo
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  
  // Adicionar jitter aleatório para evitar thundering herd
  const jitterAmount = cappedDelay * jitterRange;
  const jitter = (Math.random() - 0.5) * 2 * jitterAmount;
  
  return Math.max(0, cappedDelay + jitter);
}

/**
 * Determina se o erro é retryable baseado no tipo e status code
 */
function isRetryableError(error: any): boolean {
  // Não retry para erros de configuração ou recursos não encontrados
  if (error instanceof NotFoundError || 
      (error instanceof ApiError && error.statusCode === 400)) {
    return false;
  }
  
  // Não retry para erros de autenticação
  if (error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)) {
    return false;
  }
  
  // Retry para erros de rede, timeout e rate limiting
  if (error instanceof ApiError) {
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    return retryableStatusCodes.includes(error.statusCode || 0);
  }
  
  // Retry para outros erros de rede (timeout, connection refused, etc.)
  if (error.code === 'ECONNRESET' || 
      error.code === 'ECONNREFUSED' || 
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('timeout')) {
    return true;
  }
  
  // Default: tentar retry para erros desconhecidos
  return true;
}

/**
 * Função melhorada para tentar executar uma operação com backoff exponencial
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 500, // Base delay reduzido para 500ms
  context: string = 'unknown',
  config?: RetryConfig
): Promise<T> {
  const finalConfig: Required<RetryConfig> = {
    maxRetries: config?.maxRetries ?? maxRetries,
    baseDelay: config?.baseDelay ?? retryDelay,
    maxDelay: config?.maxDelay ?? 4000,
    jitterRange: config?.jitterRange ?? 0.1,
    backoffMultiplier: config?.backoffMultiplier ?? 2
  };
  
  let lastError: any;
  
  for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt < finalConfig.maxRetries) {
        // ✅ VERIFICAR SE O ERRO É RETRYABLE
        if (!isRetryableError(error)) {
          const errorType = error instanceof NotFoundError ? '404 (Not Found)' :
                           error instanceof ApiError ? `${error.statusCode} (${error.message})` :
                           'Non-retryable error';
          
          logger.warn(`[${context}] Erro ${errorType}, não tentando novamente.`);
          if (error instanceof ApiError && error.statusCode === 400) {
            logger.warn(`Possível problema de configuração de API ou parâmetros inválidos para ${context}`);
          }
          throw error;
        }
        
        // ✅ CALCULAR DELAY COM BACKOFF EXPONENCIAL
        const delay = calculateRetryDelay(
          attempt,
          finalConfig.baseDelay,
          finalConfig.maxDelay,
          finalConfig.jitterRange,
          finalConfig.backoffMultiplier
        );
        
        // ✅ LOG MELHORADO COM INFORMAÇÕES DO BACKOFF
        const errorInfo = error instanceof ApiError ? 
          `[${error.statusCode}] ${error.message}` : 
          (error instanceof Error ? error.message : String(error)) || 'Erro desconhecido';
        
        logger.warn(`[${context}] Tentativa ${attempt}/${finalConfig.maxRetries} falhou: ${errorInfo}. Retry em ${Math.round(delay)}ms (backoff exponencial)`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error(`[${context}] Todas as ${finalConfig.maxRetries} tentativas falharam após backoff exponencial`, error);
      }
    }
  }
  
  throw lastError;
}
