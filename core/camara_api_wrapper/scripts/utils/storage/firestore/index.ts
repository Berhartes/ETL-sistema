/**
 * Sistema de Firestore Unificado
 *
 * Este módulo oferece uma interface unificada para o Firestore,
 * determinando automaticamente se deve usar a implementação real ou mock
 * baseado nas configurações de ambiente definidas pelas flags.
 *
 * @example
 * ```typescript
 * import { createBatchManager, saveToFirestore, BatchManager } from '../utils/storage/firestore/index.js';
 *
 * // Usar batch manager
 * const batch = createBatchManager();
 * batch.set('senadores/123', { nome: 'João Silva' });
 * await batch.commit();
 *
 * // Salvar documento único
 * await saveToFirestore('senadores', '123', { nome: 'João Silva' });
 * ```
 */
import { logger } from '../../logging/index.js';
import { getDestinoConfig } from '../../../../../../../config/etl.config.js';

// Obter configuração de destino
const destinoConfig = getDestinoConfig();

// Log da configuração detectada para debug
logger.info('🔧 Configuração do Sistema de Armazenamento:');
logger.info(`   • Firestore Real: ${destinoConfig.useRealFirestore}`);
logger.info(`   • Emulador: ${destinoConfig.useEmulator}`);
logger.info(`   • Salvar no PC: ${destinoConfig.saveToPC}`);
if (destinoConfig.pcSaveDir) {
  logger.info(`   • Diretório PC: ${destinoConfig.pcSaveDir}`);
}
if (destinoConfig.useEmulator && process.env.FIRESTORE_EMULATOR_HOST) {
  logger.info(`   • Host Emulador: ${process.env.FIRESTORE_EMULATOR_HOST}`);
}

// Log de confirmação da conexão ativa
if (destinoConfig.useRealFirestore && !destinoConfig.useEmulator) {
  logger.info('☁️  CONEXÃO ATIVA: Firestore Real (Produção)');
} else if (destinoConfig.useEmulator) {
  logger.info(`🔌 CONEXÃO ATIVA: Emulador Firestore (${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'})`);
} else if (destinoConfig.saveToPC && !destinoConfig.useRealFirestore && !destinoConfig.useEmulator) {
  logger.info(`💾 CONEXÃO ATIVA: Salvamento Local (${destinoConfig.pcSaveDir})`);
} else {
  logger.warn('⚠️  ATENÇÃO: Nenhuma conexão de armazenamento claramente definida');
}

// Exportar interfaces compartilhadas
export type { BatchManager } from './batch.js';

/**
 * Cria um novo gerenciador de lote para operações no Firestore
 * Determina automaticamente qual implementação usar baseado nas flags
 */
export async function createBatchManager() {
  const currentDestinoConfig = getDestinoConfig(); // Usar a função para obter a config atual

  if (currentDestinoConfig.useEmulator) {
    logger.info(`🔌 Usando Firestore EMULADOR em ${process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080'}`);
    const { createBatchManager: createRealBatchManager } = await import('./real.js');
    return createRealBatchManager(); // Real mas conectado ao emulador
  }

  if (currentDestinoConfig.useRealFirestore) {
    logger.info('☁️ Usando Firestore REAL (Produção)');
    const { createBatchManager: createRealBatchManager } = await import('./real.js');
    return createRealBatchManager();
  }

  // Se saveToPC for true, e NENHUMA outra opção de Firestore (Real/Emulador) estiver ativa
  if (currentDestinoConfig.saveToPC && !currentDestinoConfig.useRealFirestore && !currentDestinoConfig.useEmulator) {
    logger.info('💾 Modo PC ativo (exclusivo): Retornando um BatchManager no-op.');
    // Retornar um BatchManager "no-op" que não faz nada e não valida contra o Firestore.
    // Isso evita erros quando o processador chama createBatchManager() incondicionalmente.
    // A lógica de salvamento real para PC será tratada no processador.
    return {
      set: async (path: string, data: any) => { logger.debug(`[NoOpBatchManager] SET (ignorado para PC): ${path}`, data); },
      update: async (path: string, data: any) => { logger.debug(`[NoOpBatchManager] UPDATE (ignorado para PC): ${path}`, data); },
      delete: async (path: string) => { logger.debug(`[NoOpBatchManager] DELETE (ignorado para PC): ${path}`); },
      commit: async () => {
        logger.debug('[NoOpBatchManager] COMMIT (ignorado para PC)');
        return { total: 0, processados: 0, sucessos: 0, falhas: 0, tempoOperacao: 0, detalhes: null }; // Adicionado detalhes: null
      },
    };
  }
  
  // Se saveToPC é true, MAS useRealFirestore ou useEmulator também é true.
  // Isso significa que queremos salvar no PC E no Firestore.
  // O createBatchManager retornará o RealBatchManager para as operações do Firestore.
  // A lógica de salvamento no PC será tratada separadamente no processador.
  if (currentDestinoConfig.saveToPC && (currentDestinoConfig.useRealFirestore || currentDestinoConfig.useEmulator)) {
     logger.warn('💾 Modo PC ativo em conjunto com Firestore. createBatchManager retornará RealBatchManager para operações Firestore.');
     // A lógica anterior já cobre useEmulator e useRealFirestore, então eles teriam retornado.
     // Este bloco é mais para clareza ou se a ordem dos if's mudar.
     // Se chegou aqui, significa que useEmulator e useRealFirestore eram falsos, o que contradiz a condição.
     // A lógica correta é que os ifs de useEmulator e useRealFirestore já teriam retornado o RealBatchManager.
     // Portanto, se saveToPC está ativo e um dos outros também, o RealBatchManager já foi devolvido.
     // Este log pode ser redundante ou indicar um estado que não deveria ser alcançado se a lógica acima estiver correta.
     // A intenção é: se há um destino Firestore, use o RealBatchManager.
     // Se o único destino é PC, use o NoOp.
     // Se chegou aqui, é porque nem useEmulator nem useRealFirestore são true,
     // então o if anterior (saveToPC && !useRealFirestore && !useEmulator) já deveria ter pego.
     // Este log pode ser removido ou ajustado.
     // Por segurança, se chegarmos aqui e saveToPC é true, mas os outros não, algo está errado.
     // A lógica já está coberta.
  }

  // Se não for saveToPC (exclusivo) e nenhuma configuração de Firestore estiver ativa
  logger.error('❌ Nenhuma configuração de destino válida (Firestore Real/Emulador ou PC exclusivo) ativa. Não é possível criar BatchManager.');
  throw new Error('Configuração de destino inválida ou ausente para BatchManager.');
}

/**
 * Função helper para salvar dados no Firestore de forma organizada
 * Determina automaticamente qual implementação usar baseado nas flags
 */
export async function saveToFirestore(
  collectionPath: string,
  documentId: string | null,
  data: any,
  options: { merge?: boolean } = {}
): Promise<void> {
  // Se estiver no modo PC, não salvar no Firestore
  if (destinoConfig.saveToPC) {
    logger.debug(`Modo PC ativo - ignorando salvamento no Firestore de ${collectionPath}/${documentId || 'auto'}`);
    return;
  }

  // Usar implementação real para emulador e produção
  if (destinoConfig.useEmulator || destinoConfig.useRealFirestore) {
    const firestoreReal = await import('./real.js');
    await firestoreReal.saveToFirestore(collectionPath, documentId, data, options);
  } else {
    // Se não for PC, nem Emulador, nem Real, é uma configuração inesperada.
    logger.warn(`   Operação saveToFirestore para ${collectionPath}/${documentId || 'auto'} não será executada devido à ausência de configuração de Firestore (Real/Emulador).`);
  }
}

/**
 * Obtém a configuração atual do Firestore
 */
export function getFirestoreConfig() {
  const config = {
    ...destinoConfig,
    environment: process.env.NODE_ENV || 'development',
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    description: getConfigDescription()
  };

  return config;
}

/**
 * Retorna uma descrição legível da configuração atual
 */
function getConfigDescription(): string {
  if (destinoConfig.saveToPC) {
    return `Salvando no PC em: ${destinoConfig.pcSaveDir}`;
  }
  if (destinoConfig.useEmulator) {
    return `Firestore Emulador (${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8000'})`;
  }
  if (destinoConfig.useRealFirestore) {
    return 'Firestore Real (Produção)';
  }
  // Mock foi removido, então este estado não deveria ocorrer se saveToPC, useEmulator ou useRealFirestore for true.
  // Se todos forem falsos, é uma configuração não especificada.
  return 'Configuração de destino não especificada ou inválida';
}

// Reexportar utilitários específicos se necessário
export { DocumentRefHelper, AbstractBatchManager } from './batch.js';

// Reexportar funcionalidades da implementação real (para uso direto quando necessário)
export { getFirestoreDb as firestoreDb } from './config.js';

export { getFirebaseAdmin as firebaseAdmin } from './config.js';

/**
 * Verifica se o sistema está configurado para salvar no PC
 */
export function isSavingToPC(): boolean {
  return destinoConfig.saveToPC;
}

/**
 * Obtém o diretório configurado para salvar no PC
 */
export function getPCSaveDirectory(): string | undefined {
  return destinoConfig.pcSaveDir;
}
