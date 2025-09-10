/**
 * Configuração do Firebase Admin SDK para acesso ao Firestore
 * Este arquivo configura o Firebase Admin SDK usando as credenciais de serviço
 */
import { logger } from '../../logging/index.js';
import admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
// import { getFirestoreConfig, getDestinoConfig } from '../../config/environment.config.js'; // Comentado para usar require dinâmico

let db: admin.firestore.Firestore;
let firebaseAdminInstance: admin.app.App; // Renomeado para evitar conflito com a função exportada

/**
 * Inicializa o Firebase Admin SDK e configura o Firestore
 * Deve ser chamado APÓS a configuração das variáveis de ambiente
 */
export async function initializeFirestore(): Promise<void> {
  if (firebaseAdminInstance && admin.apps.length > 0) {
    logger.info('Firebase Admin SDK já inicializado.');
    return;
  }

  // Usar configuração canônica centralizada
  const { getDestinoConfig } = await import('../../../../../../../config/etl.config.js');
  const destinoConfig = getDestinoConfig();

  // Caminho para o arquivo de credenciais de serviço
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?
    path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS) :
    path.resolve(process.cwd(), 'src', 'core', 'functions', 'camara_api_wrapper', 'config', 'serviceAccountKey.json');

  // Verificar se o arquivo de credenciais existe (apenas se não for salvar no PC)
  // destinoConfig.useMock foi removido e será sempre falso/undefined.
  if (!destinoConfig.saveToPC && !fs.existsSync(serviceAccountPath)) {
    logger.error(`Arquivo de credenciais não encontrado: ${serviceAccountPath}`);
    throw new Error(`Arquivo de credenciais não encontrado: ${serviceAccountPath}`);
  }

  try {
    // Carregar o arquivo de credenciais
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
    // Inicializar o Firebase Admin SDK
    firebaseAdminInstance = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIRESTORE_PROJECT_ID // Usar projectId da variável de ambiente
    });
    logger.info('Firebase Admin SDK inicializado com sucesso');
  } catch (error) {
    logger.error('Erro ao inicializar Firebase Admin SDK:', error);
    throw error;
  }

  // Obter instância do Firestore e configurar para ignorar propriedades indefinidas
  db = firebaseAdminInstance.firestore();

  // 🚀 ENHANCED FIRESTORE CONFIGURATION: Configuração robusta com timeouts otimizados
  if (destinoConfig.useEmulator) {
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    db.settings({
      host: emulatorHost,
      ssl: false,
      ignoreUndefinedProperties: true,
      // ✅ TIMEOUT FIX: Configurações otimizadas para emulador
      backoffFactor: 2.0,
      initialBackoffMillis: 2000,
      maxIdleChannels: 10,
      keepAliveTimeout: 30000
    });
    logger.info(`🔌 Conexão com Firestore EMULADOR estabelecida em: ${emulatorHost}`);
  } else if (destinoConfig.useRealFirestore) {
    db.settings({
      ignoreUndefinedProperties: true,
      // 🚨 CRITICAL FIX: Configurações robustas para resolver DEADLINE_EXCEEDED
      backoffFactor: 2.0,           // Aumentado de 1.5 para 2.0 - backoff mais agressivo
      initialBackoffMillis: 2000,   // Aumentado de 1000 para 2000ms - mais tempo entre tentativas
      maxIdleChannels: 15,          // Controla pool de conexões
      keepAliveTimeout: 60000,      // 60s para manter conexões vivas
      // ✅ NETWORK OPTIMIZATION: Configurações para infraestrutura brasileira
      host: 'firestore.googleapis.com:443',  // Endpoint explícito
      preferRest: false             // Usa gRPC para melhor performance
    });
    logger.info('☁️  Conexão com Firestore REAL (Produção) estabelecida com configurações otimizadas');
  // } else if (destinoConfig.useMock) { // Bloco do useMock removido
  //   logger.info('Usando Firestore Mock (nenhuma conexão real estabelecida)');
  } else if (destinoConfig.saveToPC) {
    logger.info('Salvando dados localmente no PC (nenhuma conexão Firestore estabelecida)');
  }
}

/**
 * Retorna a instância inicializada do Firebase Admin SDK.
 * Lança um erro se o SDK não foi inicializado.
 */
export function getFirebaseAdmin(): admin.app.App {
  if (!firebaseAdminInstance) {
    throw new Error('Firebase Admin SDK não inicializado. Chame initializeFirestore() primeiro.');
  }
  return firebaseAdminInstance;
}

/**
 * Retorna a instância inicializada do Firestore Database.
 * Lança um erro se o Firestore não foi inicializado.
 */
export function getFirestoreDb(): admin.firestore.Firestore {
  if (!db) {
    throw new Error('Firestore DB não inicializado. Chame initializeFirestore() primeiro.');
  }
  return db;
}

/**
 * Função para salvar um documento no Firestore
 * @param collectionPath Caminho da coleção
 * @param documentId ID do documento (opcional, se não fornecido, será gerado automaticamente)
 * @param data Dados a serem salvos
 * @param options Opções adicionais (como merge)
 */
export async function saveDocument(
  collectionPath: string,
  documentId: string | null,
  data: any,
  options: { merge?: boolean } = {}
): Promise<string> {
  try {
    // Adicionar timestamps
    const dataWithTimestamps = {
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Se não for uma atualização (merge), adicionar createdAt
    if (!options.merge) {
      dataWithTimestamps.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    // Salvar o documento
    if (documentId) {
      // Documento com ID específico
      const docRef = db.collection(collectionPath).doc(documentId);
      await docRef.set(dataWithTimestamps, options);
      logger.info(`Documento salvo com sucesso: ${collectionPath}/${documentId}`);
      return documentId;
    } else {
      // Documento com ID automático
      const docRef = await db.collection(collectionPath).add(dataWithTimestamps);
      logger.info(`Documento salvo com sucesso: ${collectionPath}/${docRef.id}`);
      return docRef.id;
    }
  } catch (error) {
    logger.error(`Erro ao salvar documento em ${collectionPath}:`, error);
    throw error;
  }
}

// A classe FirestoreBatchManager e a função createBatchManager abaixo
// foram identificadas como não utilizadas e foram removidas.
// O sistema utiliza o BatchManager de utils/storage/index.ts,
// que é baseado na interface de utils/storage/firestore/batch.ts
// e implementado em utils/storage/firestore/real.ts.
