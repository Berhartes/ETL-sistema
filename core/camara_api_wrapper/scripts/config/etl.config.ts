/**
 * Configuração centralizada do sistema ETL da Câmara dos Deputados
 *
 * Este arquivo centraliza todas as configurações do sistema ETL,
 * permitindo fácil manutenção e configuração via variáveis de ambiente.
 */

export interface ETLConfig {
  senado: {
    concurrency: number;
    maxRetries: number;
    timeout: number;
    pauseBetweenRequests: number;
    legislatura: {
      min: number;
      max: number;
      atual?: number;
    };
  };
  camara: {
    concurrency: number;
    maxRetries: number;
    timeout: number;
    pauseBetweenRequests: number;
    itemsPerPage?: number; // Adicionado para controlar o número de itens por página
    concorrenciaDiscursos?: number; // Concorrência específica para processamento de discursos
    concorrenciaEventos?: number; // Concorrência específica para processamento de eventos
    itemsPerPageEventos?: number; // Itens por página específico para eventos
    diasAtualizacaoIncrementalEventos?: number; // Dias para busca incremental de eventos
    legislatura: {
      min: number;
      max: number;
      atual?: number;
    };
  };
  firestore: {
    batchSize: number;
    pauseBetweenBatches: number;
    emulatorHost?: string;
  };
  export: {
    baseDir: string;
    formats: string[];
    comprimir: boolean;
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    showTimestamp: boolean;
  };
}

/**
 * Configuração da API da Câmara
 */
export interface APIConfig {
  rateLimit: {
    requestsPerSecond: number;
  };
  timeouts: {
    default: number;
    long: number;
  };
  retryConfig: {
    attempts: number;
    delay: number;
  };
}

/**
 * Configuração padrão do sistema ETL
 * Pode ser sobrescrita por variáveis de ambiente
 */
export const etlConfig: ETLConfig = {
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
    // ✅ OTIMIZAÇÃO: Concorrência aumentada para melhor throughput
    concurrency: parseInt(process.env.CAMARA_CONCURRENCY || '5', 10), // Aumentado de 3 para 5
    maxRetries: parseInt(process.env.CAMARA_MAX_RETRIES || '4', 10), // Reduzido de 5 para 4 (backoff exponencial compensa)
    // ✅ OTIMIZAÇÃO: Timeout reduzido para detectar problemas mais rápido
    timeout: parseInt(process.env.CAMARA_TIMEOUT || '15000', 10), // Reduzido de 30000ms para 15000ms
    // ✅ OTIMIZAÇÃO: Pausa entre requests drasticamente reduzida
    pauseBetweenRequests: parseInt(process.env.CAMARA_PAUSE_BETWEEN_REQUESTS || '800', 10), // Reduzido de 2000ms para 800ms
    itemsPerPage: parseInt(process.env.CAMARA_ITEMS_PER_PAGE || '100', 10), // Mantido em 100 (otimizado)
    concorrenciaDiscursos: parseInt(process.env.CAMARA_CONCORRENCIA_DISCURSOS || '3', 10), // Aumentado de 2 para 3
    concorrenciaEventos: parseInt(process.env.CAMARA_CONCORRENCIA_EVENTOS || '3', 10), // Aumentado de 2 para 3
    itemsPerPageEventos: parseInt(process.env.CAMARA_ITEMS_PER_PAGE_EVENTOS || '100', 10),
    diasAtualizacaoIncrementalEventos: parseInt(process.env.CAMARA_DIAS_ATUALIZACAO_EVENTOS || '60', 10),
    legislatura: {
      min: 50,
      max: 57, // Ajustar conforme a legislatura mais recente coberta pela API
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
    level: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
    showTimestamp: process.env.LOG_TIMESTAMP !== 'false'
  }
};

/**
 * Configuração otimizada da API da Câmara
 */
export const apiConfig: APIConfig = {
  rateLimit: {
    // ✅ OTIMIZAÇÃO: Rate limit mais agressivo mas respeitoso
    requestsPerSecond: parseInt(process.env.CAMARA_REQUESTS_PER_SECOND || '4', 10) // Aumentado de 2 para 4 req/s
  },
  timeouts: {
    // ✅ OTIMIZAÇÃO: Timeouts reduzidos para detectar problemas mais rápido
    default: parseInt(process.env.CAMARA_TIMEOUT_DEFAULT || '15000', 10), // Reduzido de 30000ms para 15000ms
    long: parseInt(process.env.CAMARA_TIMEOUT_LONG || '30000', 10) // Reduzido de 60000ms para 30000ms
  },
  retryConfig: {
    attempts: parseInt(process.env.CAMARA_RETRY_ATTEMPTS || '4', 10), // Aumentado de 3 para 4 (backoff exponencial)
    delay: parseInt(process.env.CAMARA_RETRY_DELAY || '500', 10) // Reduzido de 2000ms para 500ms (base para backoff exponencial)
  }
};

// A função validateConfig anterior validava apenas 'config.senado',
// o que não é relevante para o wrapper da Câmara.
// Se uma validação específica para 'config.camara' for necessária,
// ela deve ser implementada. Por ora, a validação foi removida.

// // Validar configuração na inicialização
// try {
//   // validateConfig(etlConfig); // Chamada removida
// } catch (error: any) {
//   console.error(`Erro na configuração: ${error.message}`);
//   process.exit(1);
// }
