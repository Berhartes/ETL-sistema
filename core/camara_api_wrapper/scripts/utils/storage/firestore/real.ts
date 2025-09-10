/**
 * Configuração e utilitários para o Firestore
 * (Implementação real para produção usando Firebase Admin SDK)
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../logging/index.js';
import { getFirestoreDb, getFirebaseAdmin } from './config.js'; // Importar as funções
import { BatchResult } from '../../../types/etl.types.js'; // Importar BatchResult
import { BatchManager as AbstractBatchManagerInterface } from './batch.js'; // Importar a interface do batch.ts
// ✅ CONFIGURAÇÃO CENTRALIZADA: Importar da fonte única de verdade
import { etlConfig } from '../../../../../../../config/index.js';
import type { WriteBatch } from 'firebase-admin/firestore';

// Obter instâncias do Firestore e Admin SDK
const db = getFirestoreDb();
getFirebaseAdmin(); // Chamada para inicializar, mas o resultado não é usado aqui diretamente

// Verificar se está usando emulador ou produção
const isUsingEmulator = process.env.USE_FIRESTORE_EMULATOR === 'true' || (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST.trim() !== '');
if (isUsingEmulator) {
  logger.info(`Usando Firestore Emulator (${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8000'}) com Firebase Admin SDK`);
} else {
  logger.info('Usando Firestore real (produção) com Firebase Admin SDK');
}

// Classe real para o BatchManager usando Firebase Admin SDK
class RealBatchManager implements AbstractBatchManagerInterface { // Implementar a interface importada
  private batch: WriteBatch;
  private readonly configuredBatchSize: number; // Usará o valor de etlConfig
  private readonly fallbackDir: string;

  // Rastreamento de todas as operações desde o último commit público
  private allOperationsLog: Array<{
    type: string;
    ref: string;
    data?: any;
    options?: any;
    status?: 'sucesso' | 'falha' | 'pendente'; // Adicionado 'pendente'
    errorMsg?: string;
  }> = [];

  // Contagem de operações no batch SDK atual
  private operationCountInSdkBatch: number = 0;

  // Agregadores para o BatchResult final
  private totalCommittedOperationsInAllSubBatches: number = 0;
  private totalSuccessfulOperationsInAllSubBatches: number = 0;
  private totalFailedOperationsInAllSubBatches: number = 0;
  private totalDurationForAllSubBatches: number = 0;

  constructor() {
    this.batch = db.batch();
    this.configuredBatchSize = etlConfig.firestore.batchSize;
    // Define o diretório de fallback na raiz do projeto
    this.fallbackDir = path.resolve(process.cwd(), 'firestore_fallback');
    // Cria o diretório de fallback se não existir
    if (!fs.existsSync(this.fallbackDir)) {
      fs.mkdirSync(this.fallbackDir, { recursive: true });
      logger.info(`[RealBatchManager] Diretório de fallback criado em: ${this.fallbackDir}`);
    }
    logger.info(`[RealBatchManager] Configurado com batchSize: ${this.configuredBatchSize}`);
    logger.info(`[RealBatchManager] Dados de fallback serão salvos em: ${this.fallbackDir}`);
  }

  private async checkAndCommitBatchIfNeeded(): Promise<void> {
    if (this.operationCountInSdkBatch >= this.configuredBatchSize) { // Usar configuredBatchSize
      await this.commitCurrentSdkBatch();
    }
  }

  async set(ref: string, data: any, options?: any): Promise<void> {
    const docRef = this.getDocRef(ref);

    // Log adicional para depuração do tamanho do payload
    try {
      const jsonData = JSON.stringify(data);
      const payloadSize = jsonData.length;
      logger.debug(`[RealBatchManager SET] Ref: ${ref}, Tamanho Estimado do Payload: ${payloadSize} bytes`);
      if (payloadSize > 1048576) { // Limite do Firestore: 1 MiB = 1.048.576 bytes
        logger.warn(`[RealBatchManager SET] ATENÇÃO: Payload para ${ref} (tamanho: ${payloadSize} bytes) excede o limite de 1MB do Firestore ANTES de adicionar ao batch.`);
      }
    } catch (e: any) {
      logger.error(`[RealBatchManager SET] Erro ao serializar payload para ${ref} para verificação de tamanho: ${e.message}`);
    }

    this.batch.set(docRef, data, options || {});
    this.operationCountInSdkBatch++;
    // Mantendo 'data' em allOperationsLog para a lógica de fallback, mas ciente do consumo de memória se os payloads forem grandes.
    this.allOperationsLog.push({ type: 'set', ref, data, options, status: 'pendente' });
    await this.checkAndCommitBatchIfNeeded();
  }

  async update(ref: string, data: any): Promise<void> {
    const docRef = this.getDocRef(ref);

    // Log adicional para depuração do tamanho do payload
    try {
      const jsonData = JSON.stringify(data);
      const payloadSize = jsonData.length;
      logger.debug(`[RealBatchManager UPDATE] Ref: ${ref}, Tamanho Estimado do Payload: ${payloadSize} bytes`);
      if (payloadSize > 1048576) {
        logger.warn(`[RealBatchManager UPDATE] ATENÇÃO: Payload para ${ref} (tamanho: ${payloadSize} bytes) excede o limite de 1MB do Firestore ANTES de adicionar ao batch.`);
      }
    } catch (e: any) {
      logger.error(`[RealBatchManager UPDATE] Erro ao serializar payload para ${ref} para verificação de tamanho: ${e.message}`);
    }

    this.batch.update(docRef, data);
    this.operationCountInSdkBatch++;
    this.allOperationsLog.push({ type: 'update', ref, data, status: 'pendente' });
    await this.checkAndCommitBatchIfNeeded();
  }

  async delete(ref: string): Promise<void> {
    const docRef = this.getDocRef(ref);
    this.batch.delete(docRef);
    this.operationCountInSdkBatch++;
    this.allOperationsLog.push({ type: 'delete', ref, status: 'pendente' });
    await this.checkAndCommitBatchIfNeeded();
  }

  private async commitCurrentSdkBatch(): Promise<void> {
    if (this.operationCountInSdkBatch === 0) {
      return; // Nada a commitar
    }

    const startTime = Date.now();
    const opsInThisBatchCount = this.operationCountInSdkBatch;
    // Marcar as operações que estão neste batch para atualização de status
    const startIndexForThisBatch = this.allOperationsLog.length - opsInThisBatchCount;

    logger.info(`Realizando commit de sub-batch com ${opsInThisBatchCount} operações`);

    try {
      await this.batch.commit();
      const duration = Date.now() - startTime;
      logger.info(`Sub-batch commitado com sucesso em ${duration}ms`);

      this.totalSuccessfulOperationsInAllSubBatches += opsInThisBatchCount;
      for (let i = 0; i < opsInThisBatchCount; i++) {
        this.allOperationsLog[startIndexForThisBatch + i].status = 'sucesso';
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error(`Erro ao commitar sub-batch em ${duration}ms:`, error);

      this.totalFailedOperationsInAllSubBatches += opsInThisBatchCount;
      for (let i = 0; i < opsInThisBatchCount; i++) {
        const opLog = this.allOperationsLog[startIndexForThisBatch + i];
        opLog.status = 'falha';
        opLog.errorMsg = error.message || 'Erro desconhecido no sub-batch';

        // Lógica de Fallback para salvar dados localmente
        if ((opLog.type === 'set' || opLog.type === 'update') && opLog.data) {
          try {
            const fileName = `${opLog.ref.replace(/\//g, '_')}_${Date.now()}.json`;
            const filePath = path.join(this.fallbackDir, fileName);
            fs.writeFileSync(filePath, JSON.stringify(opLog.data, null, 2));
            logger.warn(`[RealBatchManager] Dados da operação falha (${opLog.type} em ${opLog.ref}) salvos em fallback: ${filePath}`);
          } catch (fallbackError: any) {
            logger.error(`[RealBatchManager] Erro ao salvar dados de fallback para ${opLog.ref}:`, fallbackError);
          }
        }
      }
      // Decidimos não relançar o erro aqui para permitir que outros batches tentem,
      // o erro geral será refletido no BatchResult final.
    } finally {
      const duration = Date.now() - startTime;
      this.totalCommittedOperationsInAllSubBatches += opsInThisBatchCount;
      this.totalDurationForAllSubBatches += duration;

      // Reinicializar para o próximo batch SDK
      this.batch = db.batch();
      this.operationCountInSdkBatch = 0;
    }
  }

  async commit(): Promise<BatchResult> {
    // Commitar quaisquer operações restantes no batch SDK atual
    if (this.operationCountInSdkBatch > 0) {
      await this.commitCurrentSdkBatch();
    }

    logger.info(`Finalizando processo de commit em lote. Total de operações processadas em sub-batches: ${this.totalCommittedOperationsInAllSubBatches}`);

    const finalResult: BatchResult = {
      total: this.allOperationsLog.length, // Total de operações que o usuário tentou adicionar
      processados: this.totalCommittedOperationsInAllSubBatches, // Total efetivamente enviado em sub-batches
      sucessos: this.totalSuccessfulOperationsInAllSubBatches,
      falhas: this.totalFailedOperationsInAllSubBatches,
      tempoOperacao: this.totalDurationForAllSubBatches,
      detalhes: this.allOperationsLog.map(op => ({
        id: op.ref,
        status: op.status || 'desconhecido', // Se algo der muito errado e o status não for definido
        erro: op.errorMsg
      }))
    };

    // Limpar logs e acumuladores para a próxima vez que o BatchManager for usado
    this.allOperationsLog = [];
    this.totalCommittedOperationsInAllSubBatches = 0;
    this.totalSuccessfulOperationsInAllSubBatches = 0;
    this.totalFailedOperationsInAllSubBatches = 0;
    this.totalDurationForAllSubBatches = 0;
    // O batch SDK já é reiniciado em commitCurrentSdkBatch

    if (finalResult.falhas > 0) {
      logger.error(`Commit em lote finalizado com ${finalResult.falhas} falhas.`);
      throw finalResult; // Lançar o BatchResult como erro, conforme comportamento original
    }

    logger.info(`Commit em lote finalizado com sucesso. ${finalResult.sucessos} operações bem-sucedidas.`);
    return finalResult;
  }

  private getDocRef(path: string): import('firebase-admin').firestore.DocumentReference {
    const parts = path.split('/');
    if (parts.length < 2 || parts.length % 2 !== 0) {
      throw new Error(`Caminho inválido: ${path}. Deve ter um número par de segmentos.`);
    }

    // Para caminhos simples como "colecao/documento"
    if (parts.length === 2) {
      return db.collection(parts[0]).doc(parts[1]);
    }

    // Para caminhos aninhados como "colecao/documento/subcolecao/subdocumento"
    let currentRef: any = db;
    for (let i = 0; i < parts.length; i += 2) {
      const collectionName = parts[i];
      const docId = parts[i + 1];

      if (i === 0) {
        currentRef = currentRef.collection(collectionName).doc(docId);
      } else {
        currentRef = currentRef.collection(collectionName).doc(docId);
      }
    }

    return currentRef;
  }
}

/**
 * Cria um novo gerenciador de lote para operações no Firestore
 */
export function createBatchManager(): AbstractBatchManagerInterface {
  return new RealBatchManager();
}

/**
 * Função helper para salvar dados no Firestore de forma organizada
 */
export async function saveToFirestore(
  collectionPath: string,
  documentId: string | null,
  data: any,
  options: { merge?: boolean } = {}
): Promise<void> {
  const collectionRef = db.collection(collectionPath);
  const docRef = documentId ? collectionRef.doc(documentId) : collectionRef.doc();

  logger.info(`Salvando dados em ${collectionPath}/${documentId || docRef.id}`);

  try {
    await docRef.set(data, options);
    logger.info(`Dados salvos com sucesso em ${collectionPath}/${documentId || docRef.id}`);
  } catch (error) {
    logger.error(`Erro ao salvar dados em ${collectionPath}/${documentId || docRef.id}:`, error);
    throw error;
  }
}
