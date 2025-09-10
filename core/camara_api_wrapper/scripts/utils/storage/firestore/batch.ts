/**
 * Gerenciador de Operações em Lote para Firestore
 * 
 * Este módulo oferece uma interface unificada para operações em lote,
 * funcionando tanto com implementação real quanto mock.
 */
import { logger } from '../../logging/index.js';

/**
 * Interface para operações em lote do Firestore
 */
import { BatchResult } from '../../../types/etl.types.js'; // Importar BatchResult

export interface BatchManager {
  set: (ref: string, data: any, options?: any) => void;
  update: (ref: string, data: any) => void;
  delete: (ref: string) => void;
  commit: () => Promise<BatchResult>;
}

/**
 * Configurações para o gerenciador de lotes
 */
export interface BatchConfig {
  maxOperations?: number;
  autoCommit?: boolean;
}

/**
 * Classe abstrata para gerenciadores de lote
 */
export abstract class AbstractBatchManager implements BatchManager {
  protected operationCount: number = 0;
  protected maxOperations: number;
  protected autoCommit: boolean;

  constructor(config: BatchConfig = {}) {
    this.maxOperations = config.maxOperations || 500;
    this.autoCommit = config.autoCommit !== false; // default true
  }

  abstract set(ref: string, data: any, options?: any): void;
  abstract update(ref: string, data: any): void;
  abstract delete(ref: string): void;
  abstract commit(): Promise<BatchResult>;

  /**
   * Verifica se deve fazer commit automático baseado no número de operações
   */
  protected async checkAutoCommit(): Promise<void> {
    if (this.autoCommit && this.operationCount >= this.maxOperations) {
      logger.info(`Limite de ${this.maxOperations} operações atingido. Realizando commit automático.`);
      await this.commit();
    }
  }

  /**
   * Incrementa o contador de operações e verifica se deve fazer commit automático
   */
  protected async incrementAndCheck(): Promise<void> {
    this.operationCount++;
    await this.checkAutoCommit();
  }

  /**
   * Reseta o contador de operações
   */
  protected resetCounter(): void {
    this.operationCount = 0;
  }

  /**
   * Retorna o número atual de operações pendentes
   */
  public getPendingOperations(): number {
    return this.operationCount;
  }
}

/**
 * Utilitários para criar referências de documentos
 */
export class DocumentRefHelper {
  /**
   * Valida um caminho de documento
   */
  static validatePath(path: string): void {
    const parts = path.split('/');
    if (parts.length < 2 || parts.length % 2 !== 0) {
      throw new Error(`Caminho inválido: ${path}. Deve ter um número par de segmentos (coleção/documento).`);
    }
  }

  /**
   * Extrai partes do caminho
   */
  static parsePath(path: string): { collection: string; document: string; subcollections?: string[] } {
    this.validatePath(path);
    const parts = path.split('/');
    
    if (parts.length === 2) {
      return {
        collection: parts[0],
        document: parts[1]
      };
    }

    // Para caminhos aninhados
    const subcollections: string[] = [];
    for (let i = 2; i < parts.length; i += 2) {
      subcollections.push(parts[i]);
    }

    return {
      collection: parts[0],
      document: parts[1],
      subcollections
    };
  }
}
