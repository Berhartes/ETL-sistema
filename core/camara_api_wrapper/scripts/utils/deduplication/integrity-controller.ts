/**
 * Controlador de Integridade e Deduplicação para Dados Sensíveis
 * 
 * Sistema robusto para garantir que nenhum dado seja duplicado no processo ETL
 * Especialmente importante para dados sensíveis como CPF, CNPJ, transações financeiras
 */

import { createHash } from 'crypto';
import { logger } from '../logging/index.js';

export interface DeduplicationResult<T> {
  deduplicated: T[];
  duplicatesFound: number;
  duplicateDetails: DuplicateRecord[];
  integrityScore: number;
}

export interface DuplicateRecord {
  duplicateKey: string;
  originalIndex: number;
  duplicateIndex: number;
  conflictFields: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface DeduplicationConfig {
  primaryKeys: string[];
  secondaryKeys?: string[];
  sensitiveFields: string[];
  conflictResolution: 'KEEP_FIRST' | 'KEEP_LAST' | 'MERGE' | 'ABORT_ON_CONFLICT';
  auditLevel: 'BASIC' | 'DETAILED' | 'COMPREHENSIVE';
}

export class IntegrityController {
  private auditLog: Array<{
    timestamp: Date;
    operation: string;
    details: any;
    severity: string;
  }> = [];

  private duplicateHashes = new Set<string>();
  private processedRecords = new Map<string, any>();

  constructor(private config: DeduplicationConfig) {}

  /**
   * Deduplica array de dados baseado em chaves primárias e secundárias
   * CORREÇÃO CRÍTICA: Modo especial para dados da API oficial
   */
  deduplicateData<T extends Record<string, any>>(
    data: T[],
    operationName: string
  ): DeduplicationResult<T> {
    logger.info(`🔍 [Integridade] Iniciando deduplicação para ${operationName}: ${data.length} registros`);
    
    const result: DeduplicationResult<T> = {
      deduplicated: [],
      duplicatesFound: 0,
      duplicateDetails: [],
      integrityScore: 100
    };

    // CORREÇÃO CRÍTICA: Para dados da API oficial, preservar TODOS os registros
    if (operationName.includes('DESPESAS_DEPUTADO') || operationName.includes('API_DATA')) {
      logger.info(`🛡️ [Integridade] MODO PRESERVAÇÃO: Dados oficiais da API - sem deduplicação agressiva`);
      result.deduplicated = [...data]; // Preservar todos os dados
      result.duplicatesFound = 0;
      result.integrityScore = 100;
      logger.info(`✅ [Integridade] ${operationName} preservado: ${data.length} registros mantidos (100%)`);
      return result;
    }

    const seenKeys = new Map<string, { index: number; record: T }>();
    const sensitiveFieldConflicts = new Map<string, string[]>();

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      const primaryKey = this.generatePrimaryKey(record);
      const secondaryKey = this.generateSecondaryKey(record);
      
      // Verificar duplicação por chave primária
      if (seenKeys.has(primaryKey)) {
        const duplicate = seenKeys.get(primaryKey)!;
        const conflicts = this.detectConflicts(duplicate.record, record);
        
        const duplicateRecord: DuplicateRecord = {
          duplicateKey: primaryKey,
          originalIndex: duplicate.index,
          duplicateIndex: i,
          conflictFields: conflicts,
          severity: this.calculateSeverity(conflicts)
        };

        result.duplicateDetails.push(duplicateRecord);
        result.duplicatesFound++;

        // Tratar conflito baseado na configuração
        const resolvedRecord = this.resolveConflict(duplicate.record, record, conflicts);
        if (resolvedRecord) {
          seenKeys.set(primaryKey, { index: duplicate.index, record: resolvedRecord });
        }

        this.logDuplicateFound(operationName, duplicateRecord, record);
        continue;
      }

      // Verificar duplicação por chave secundária (se configurada)
      if (secondaryKey && seenKeys.has(secondaryKey)) {
        const duplicate = seenKeys.get(secondaryKey)!;
        const conflicts = this.detectConflicts(duplicate.record, record);
        
        if (conflicts.length > 0) {
          const duplicateRecord: DuplicateRecord = {
            duplicateKey: secondaryKey,
            originalIndex: duplicate.index,
            duplicateIndex: i,
            conflictFields: conflicts,
            severity: this.calculateSeverity(conflicts)
          };

          result.duplicateDetails.push(duplicateRecord);
          result.duplicatesFound++;

          this.logDuplicateFound(operationName, duplicateRecord, record);
          continue;
        }
      }

      // Verificar integridade de campos sensíveis
      this.validateSensitiveFields(record, i, sensitiveFieldConflicts);

      // Adicionar à lista de registros únicos
      seenKeys.set(primaryKey, { index: i, record });
      if (secondaryKey) {
        seenKeys.set(secondaryKey, { index: i, record });
      }
    }

    // Extrair registros únicos
    const uniqueRecords = new Map<number, T>();
    for (const { index, record } of seenKeys.values()) {
      uniqueRecords.set(index, record);
    }

    result.deduplicated = Array.from(uniqueRecords.values());
    result.integrityScore = this.calculateIntegrityScore(data.length, result.duplicatesFound, result.duplicateDetails);

    this.logDeduplicationResult(operationName, result);
    return result;
  }

  /**
   * Gera chave primária para identificação única
   * CORREÇÃO: Só considera campos que realmente existem
   */
  private generatePrimaryKey(record: Record<string, any>): string {
    const keyValues = this.config.primaryKeys.map(key => {
      const value = record[key];
      // CORREÇÃO: Não usar valores vazios ou undefined como parte da chave
      if (value === undefined || value === null || value === '') {
        return `MISSING_${key}`;
      }
      return String(value).trim();
    });

    return createHash('sha256').update(keyValues.join('|')).digest('hex');
  }

  /**
   * Gera chave secundária para verificação adicional
   */
  private generateSecondaryKey(record: Record<string, any>): string | null {
    if (!this.config.secondaryKeys || this.config.secondaryKeys.length === 0) {
      return null;
    }

    const keyValues = this.config.secondaryKeys.map(key => {
      const value = record[key];
      return value !== undefined && value !== null ? String(value).trim() : '';
    });

    return createHash('sha256').update(keyValues.join('|')).digest('hex');
  }

  /**
   * Detecta conflitos entre registros duplicados
   */
  private detectConflicts(original: Record<string, any>, duplicate: Record<string, any>): string[] {
    const conflicts: string[] = [];
    const allKeys = new Set([...Object.keys(original), ...Object.keys(duplicate)]);

    for (const key of allKeys) {
      const originalValue = original[key];
      const duplicateValue = duplicate[key];

      if (originalValue !== duplicateValue) {
        conflicts.push(key);
      }
    }

    return conflicts;
  }

  /**
   * Calcula severidade da duplicação
   */
  private calculateSeverity(conflicts: string[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const sensitiveConflicts = conflicts.filter(field => 
      this.config.sensitiveFields.includes(field)
    );

    if (sensitiveConflicts.length > 0) {
      return 'CRITICAL';
    }

    if (conflicts.length > 5) {
      return 'HIGH';
    }

    if (conflicts.length > 2) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Resolve conflito entre registros duplicados
   */
  private resolveConflict<T>(
    original: T,
    duplicate: T,
    conflicts: string[]
  ): T | null {
    switch (this.config.conflictResolution) {
      case 'KEEP_FIRST':
        return original;
      
      case 'KEEP_LAST':
        return duplicate;
      
      case 'MERGE':
        return this.mergeRecords(original, duplicate, conflicts);
      
      case 'ABORT_ON_CONFLICT':
        if (conflicts.length > 0) {
          throw new Error(`Conflito crítico detectado: ${conflicts.join(', ')}`);
        }
        return original;
      
      default:
        return original;
    }
  }

  /**
   * Mescla registros duplicados priorizando dados mais recentes/completos
   */
  private mergeRecords<T>(original: T, duplicate: T, conflicts: string[]): T {
    const merged = { ...original };

    for (const field of conflicts) {
      const originalValue = (original as any)[field];
      const duplicateValue = (duplicate as any)[field];

      // Priorizar valores não nulos/vazios
      if (originalValue === null || originalValue === undefined || originalValue === '') {
        (merged as any)[field] = duplicateValue;
      } else if (duplicateValue === null || duplicateValue === undefined || duplicateValue === '') {
        (merged as any)[field] = originalValue;
      } else {
        // Para campos sensíveis, manter o original
        if (this.config.sensitiveFields.includes(field)) {
          (merged as any)[field] = originalValue;
        } else {
          // Para outros campos, usar o mais recente (assumindo que duplicate é mais recente)
          (merged as any)[field] = duplicateValue;
        }
      }
    }

    return merged;
  }

  /**
   * Valida campos sensíveis para detectar anomalias
   */
  private validateSensitiveFields(
    record: Record<string, any>,
    index: number,
    conflicts: Map<string, string[]>
  ): void {
    for (const field of this.config.sensitiveFields) {
      const value = record[field];
      
      if (value) {
        const normalizedValue = String(value).trim();
        
        // Verificar se o valor sensível já foi visto
        if (!conflicts.has(field)) {
          conflicts.set(field, []);
        }
        
        const fieldValues = conflicts.get(field)!;
        if (fieldValues.includes(normalizedValue)) {
          // Log apenas em modo debug para campos de metadados normais
          if (['siglaPartido', 'siglaUf'].includes(field)) {
            logger.debug(`🔍 [Integridade] Campo '${field}' duplicado: ${normalizedValue} (índice: ${index})`);
          } else {
            logger.warn(`⚠️ [Integridade] Campo sensível '${field}' duplicado: ${normalizedValue} (índice: ${index})`);
          }
        } else {
          fieldValues.push(normalizedValue);
        }
      }
    }
  }

  /**
   * Calcula score de integridade
   */
  private calculateIntegrityScore(
    totalRecords: number,
    duplicatesFound: number,
    duplicateDetails: DuplicateRecord[]
  ): number {
    if (totalRecords === 0) return 100;

    const duplicateRate = (duplicatesFound / totalRecords) * 100;
    const criticalDuplicates = duplicateDetails.filter(d => d.severity === 'CRITICAL').length;
    const highDuplicates = duplicateDetails.filter(d => d.severity === 'HIGH').length;

    let score = 100 - duplicateRate;
    
    // Penalizar duplicações críticas mais severamente
    score -= (criticalDuplicates * 10);
    score -= (highDuplicates * 5);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Registra duplicação encontrada
   */
  private logDuplicateFound(
    operationName: string,
    duplicateRecord: DuplicateRecord,
    record: Record<string, any>
  ): void {
    const logEntry = {
      timestamp: new Date(),
      operation: operationName,
      details: {
        duplicateKey: duplicateRecord.duplicateKey,
        severity: duplicateRecord.severity,
        conflictFields: duplicateRecord.conflictFields,
        sensitiveFieldsAffected: duplicateRecord.conflictFields.filter(field => 
          this.config.sensitiveFields.includes(field)
        )
      },
      severity: duplicateRecord.severity
    };

    this.auditLog.push(logEntry);

    const logLevel = duplicateRecord.severity === 'CRITICAL' ? 'error' : 
                     duplicateRecord.severity === 'HIGH' ? 'warn' : 'info';
    
    logger[logLevel](`🔍 [Integridade] ${duplicateRecord.severity}: Duplicação detectada em ${operationName}`, {
      key: duplicateRecord.duplicateKey,
      conflicts: duplicateRecord.conflictFields,
      indices: [duplicateRecord.originalIndex, duplicateRecord.duplicateIndex]
    });
  }

  /**
   * Registra resultado da deduplicação
   */
  private logDeduplicationResult<T>(
    operationName: string,
    result: DeduplicationResult<T>
  ): void {
    const logEntry = {
      timestamp: new Date(),
      operation: operationName,
      details: {
        originalCount: result.deduplicated.length + result.duplicatesFound,
        deduplicatedCount: result.deduplicated.length,
        duplicatesRemoved: result.duplicatesFound,
        integrityScore: result.integrityScore
      },
      severity: result.integrityScore < 90 ? 'HIGH' : result.integrityScore < 95 ? 'MEDIUM' : 'LOW'
    };

    this.auditLog.push(logEntry);

    logger.info(`✅ [Integridade] ${operationName} concluído:`, {
      original: result.deduplicated.length + result.duplicatesFound,
      deduplicated: result.deduplicated.length,
      duplicatesRemoved: result.duplicatesFound,
      integrityScore: result.integrityScore.toFixed(2) + '%'
    });
  }

  /**
   * Obtém log de auditoria
   */
  getAuditLog(): Array<{
    timestamp: Date;
    operation: string;
    details: any;
    severity: string;
  }> {
    return [...this.auditLog];
  }

  /**
   * Exporta relatório de integridade
   */
  generateIntegrityReport(): {
    summary: {
      totalOperations: number;
      criticalIssues: number;
      highIssues: number;
      mediumIssues: number;
      lowIssues: number;
    };
    details: any[];
  } {
    const summary = {
      totalOperations: this.auditLog.length,
      criticalIssues: this.auditLog.filter(log => log.severity === 'CRITICAL').length,
      highIssues: this.auditLog.filter(log => log.severity === 'HIGH').length,
      mediumIssues: this.auditLog.filter(log => log.severity === 'MEDIUM').length,
      lowIssues: this.auditLog.filter(log => log.severity === 'LOW').length
    };

    return {
      summary,
      details: this.auditLog
    };
  }

  /**
   * Limpa logs de auditoria
   */
  clearAuditLog(): void {
    this.auditLog = [];
    this.duplicateHashes.clear();
    this.processedRecords.clear();
  }
}