/**
 * 🎯 CONFIGURAÇÃO CENTRALIZADA CANÔNICA DO SISTEMA ETL
 * 
 * ✅ SINGLE SOURCE OF TRUTH para todas as configurações ETL
 * ✅ CONSOLIDAÇÃO: Este arquivo substitui múltiplas cópias duplicadas
 * ✅ MANUTENABILIDADE: Mudanças aqui se refletem em todo o sistema
 * 
 * Este arquivo centraliza TODAS as configurações do sistema ETL,
 * permitindo fácil manutenção e configuração via variáveis de ambiente.
 * 
 * LOCALIZAÇÃO CANÔNICA: config/etl.config.js
 * IMPORTS: Todos os arquivos devem importar desta localização
 */

// Interfaces removidas - este é um arquivo JS puro

/**
 * 🎯 CONFIGURAÇÃO CANÔNICA DO SISTEMA ETL
 * 
 * Esta é a única fonte de verdade para configurações ETL.
 * Pode ser sobrescrita por variáveis de ambiente para diferentes ambientes.
 */
export const etlConfig = {
  senado: {
    concurrency: parseInt(process.env.SENADO_CONCURRENCY || '3', 10),
    maxRetries: parseInt(process.env.SENADO_MAX_RETRIES || '5', 10),
    timeout: parseInt(process.env.SENADO_TIMEOUT || '30000', 10),
    pauseBetweenRequests: parseInt(process.env.SENADO_PAUSE_BETWEEN_REQUESTS || '3000', 10),
    legislatura: {
      min: 1,
      max: 58,
      atual: process.env.LEGISLATURA_ATUAL ? parseInt(process.env.LEGISLATURA_ATUAL, 10) : undefined
    }
  },
  camara: {
    // ✅ PERFORMANCE: Configurações otimizadas baseadas em análise de performance
    concurrency: parseInt(process.env.CAMARA_CONCURRENCY || '5', 10), // Otimizado para throughput
    maxRetries: parseInt(process.env.CAMARA_MAX_RETRIES || '4', 10), // Backoff exponencial compensa
    timeout: parseInt(process.env.CAMARA_TIMEOUT || '15000', 10), // Detecta problemas mais rápido
    pauseBetweenRequests: parseInt(process.env.CAMARA_PAUSE_BETWEEN_REQUESTS || '800', 10), // Otimizado para velocidade
    itemsPerPage: parseInt(process.env.CAMARA_ITEMS_PER_PAGE || '100', 10),
    concorrenciaDiscursos: parseInt(process.env.CAMARA_CONCORRENCIA_DISCURSOS || '3', 10),
    concorrenciaEventos: parseInt(process.env.CAMARA_CONCORRENCIA_EVENTOS || '3', 10),
    itemsPerPageEventos: parseInt(process.env.CAMARA_ITEMS_PER_PAGE_EVENTOS || '100', 10),
    diasAtualizacaoIncrementalEventos: parseInt(process.env.CAMARA_DIAS_ATUALIZACAO_EVENTOS || '60', 10),
    legislatura: {
      min: 50,
      max: 57, // Atualizar conforme novas legislaturas
      atual: process.env.LEGISLATURA_ATUAL ? parseInt(process.env.LEGISLATURA_ATUAL, 10) : undefined
    }
  },
  firestore: {
    batchSize: parseInt(process.env.FIRESTORE_BATCH_SIZE || '5', 10),
    pauseBetweenBatches: parseInt(process.env.FIRESTORE_PAUSE_BETWEEN_BATCHES || '7000', 10),
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8000'
  },
  export: {
    baseDir: process.env.EXPORT_BASE_DIR || 'dados_extraidos',
    formats: (process.env.EXPORT_FORMATS || 'json').split(','),
    comprimir: process.env.EXPORT_COMPRIMIR === 'true'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    showTimestamp: process.env.LOG_TIMESTAMP !== 'false'
  }
};

/**
 * 🚀 CONFIGURAÇÃO OTIMIZADA DA API DA CÂMARA
 * 
 * Configurações específicas para interação com a API da Câmara dos Deputados.
 * Valores otimizados baseados em análise de performance e limites da API.
 */
export const apiConfig = {
  rateLimit: {
    // ✅ RATE LIMIT: Agressivo mas respeitoso aos limites da API
    requestsPerSecond: parseInt(process.env.CAMARA_REQUESTS_PER_SECOND || '4', 10)
  },
  timeouts: {
    // ✅ TIMEOUTS: Reduzidos para detecção rápida de problemas
    default: parseInt(process.env.CAMARA_TIMEOUT_DEFAULT || '15000', 10),
    long: parseInt(process.env.CAMARA_TIMEOUT_LONG || '30000', 10)
  },
  retryConfig: {
    attempts: parseInt(process.env.CAMARA_RETRY_ATTEMPTS || '4', 10), // Com backoff exponencial
    delay: parseInt(process.env.CAMARA_RETRY_DELAY || '500', 10) // Base para backoff exponencial
  }
};

/**
 * 🔧 VALIDAÇÃO DE CONFIGURAÇÃO (Opcional)
 * 
 * Função utilitária para validar configurações em runtime se necessário.
 * Por enquanto, a validação via environment variables é suficiente.
 */
export function validateETLConfig(config) {
  // Validações básicas que podem ser expandidas conforme necessário
  if (config.camara.legislatura.min >= config.camara.legislatura.max) {
    throw new Error('Configuração inválida: legislatura.min deve ser menor que legislatura.max');
  }
  
  if (config.camara.concurrency <= 0) {
    throw new Error('Configuração inválida: concurrency deve ser maior que 0');
  }
  
  if (config.firestore.batchSize <= 0) {
    throw new Error('Configuração inválida: firestore.batchSize deve ser maior que 0');
  }
}

/**
 * 🚀 CONFIGURAÇÃO DE DESTINO DINÂMICA
 * 
 * Analisa os argumentos da linha de comando para determinar onde os dados do ETL devem ser salvos.
 * Esta função centraliza a lógica que antes estava espalhada, garantindo uma única fonte de verdade.
 * 
 * @returns Um objeto com flags booleanas para cada destino possível.
 */
export function getDestinoConfig() {
  const args = process.argv.slice(2);

  const hasFirestore = args.includes('--firestore');
  const hasEmulator = args.includes('--emulator');
  const hasPC = args.includes('--pc') || args.includes('--local');

  // Se nenhuma flag de destino for passada, o padrão é o Firestore real.
  const isDefault = !hasFirestore && !hasEmulator && !hasPC;

  const useRealFirestore = hasFirestore || isDefault;
  const useEmulator = hasEmulator;
  const saveToPC = hasPC;

  // Lógica de log para clareza na execução
  if (process.env.NODE_ENV !== 'test') { // Evita poluir logs de teste
    console.log('🔧 Analisando destino do ETL...');
    if (useRealFirestore) {
      console.log('   -> ☁️  Destino: Firestore Real (Produção)');
    }
    if (useEmulator) {
      console.log('   -> 🔌 Destino: Firestore Emulator');
    }
    if (saveToPC) {
      console.log('   -> 💾 Destino: Salvar no PC Local');
    }
    if (isDefault) {
      console.log('   -> (Nenhuma flag de destino especificada, usando --firestore por padrão)');
    }
    console.log('─'.repeat(60));
  }

  // Define variáveis de ambiente para compatibilidade com código legado, se necessário
  process.env.USE_REAL_FIRESTORE = String(useRealFirestore);
  process.env.USE_FIRESTORE_EMULATOR = String(useEmulator);
  process.env.SAVE_TO_PC = String(saveToPC);

  return {
    useRealFirestore,
    useEmulator,
    saveToPC,
    pcSaveDir: process.env.PC_SAVE_DIR || 'C:\\Users\\Kast Berhartes\\projetos-web-berhartes\\a-republica-brasileira\\src\\core\\output_pc'
  };
}

// 🎯 EXPORT DEFAULT para compatibilidade com imports diversos
export default {
  etlConfig,
  apiConfig,
  validateETLConfig,
  getDestinoConfig
};