/**
 * Cliente HTTP para a API da Câmara dos Deputados
 *
 * Fornece uma interface unificada para fazer requisições à API
 * com retry automático, rate limiting e tratamento de erros.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from '../logging/index.js';
import { withRetry } from '../logging/error-handler.js';
import { apiConfig } from '../../../../../../config/etl.config.js';

/**
 * Configuração de requisição
 */
export interface RequestConfig extends AxiosRequestConfig {
  retries?: number;
  timeout?: number;
  context?: string;
  useCache?: boolean; // ✅ CACHE: Controle de uso do cache
}

/**
 * Interface para cache de requisições
 */
interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

/**
 * Cliente HTTP otimizado para API da Câmara com cache
 */
class CamaraAPIClient {
  private client: AxiosInstance;
  private requestCount = 0;
  private lastRequestTime = 0;
  
  // ✅ CACHE SIMPLES: Cache de requisições com TTL
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos em milissegundos
  private readonly MAX_CACHE_SIZE = 1000; // Máximo de entradas no cache
  
  // ✅ DEDUPLICAÇÃO: Mapa de requisições em andamento
  private pendingRequests = new Map<string, Promise<any>>();

  constructor() {
    this.client = axios.create({
      baseURL: environmentConfig.CAMARA_API_BASE_URL,
      timeout: environmentConfig.CAMARA_API_TIMEOUT,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ETL-Camara-v2.0/Node.js'
      }
    });

    this.setupInterceptors();
  }

  /**
   * Configura interceptors do axios
   */
  private setupInterceptors(): void {
    // Request interceptor - removido rate limiting (agora é feito no método get)
    this.client.interceptors.request.use(
      (config) => {
        // Log da requisição
        const fullUrl = `${config.baseURL}${config.url}`;
        console.log(`🌐 API Request: ${config.method?.toUpperCase() || 'GET'} ${fullUrl}`);
        console.log(`📋 Params:`, config.params);

        return config;
      },
      (error) => {
        logger.error(`❌ Erro na configuração da requisição: ${error.message}`);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const duration = Date.now() - this.lastRequestTime;

        if (environmentConfig.LOG_API_RESPONSES) {
          logger.apiResponse(
            response.config.url || '',
            response.status,
            duration
          );
        }

        return response;
      },
      (error) => {
        const duration = Date.now() - this.lastRequestTime;

        if (error.response) {
          logger.apiResponse(
            error.config?.url || '',
            error.response.status,
            duration
          );
        } else {
          logger.error(`❌ Erro de rede: ${error.message}`);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Aplica rate limiting de forma assíncrona
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / apiConfig.rateLimit.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      // ✅ OTIMIZAÇÃO: Rate limiting assíncrono em vez de busy wait
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * ✅ CACHE: Gera chave de cache baseada na URL e parâmetros
   */
  private generateCacheKey(url: string, params?: any): string {
    const paramString = params ? JSON.stringify(params, Object.keys(params).sort()) : '';
    return `${url}${paramString}`;
  }

  /**
   * ✅ CACHE: Verifica se entrada do cache é válida
   */
  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() < entry.expiresAt;
  }

  /**
   * ✅ CACHE: Obtém dados do cache se válidos
   */
  private getCachedData(cacheKey: string): any | null {
    const entry = this.cache.get(cacheKey);
    if (entry && this.isCacheValid(entry)) {
      return entry.data;
    }
    
    // Remover entrada expirada
    if (entry) {
      this.cache.delete(cacheKey);
    }
    
    return null;
  }

  /**
   * ✅ CACHE: Salva dados no cache
   */
  private setCachedData(cacheKey: string, data: any): void {
    // Limpar cache se estiver muito grande
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const now = Date.now();
    this.cache.set(cacheKey, {
      data,
      timestamp: now,
      expiresAt: now + this.CACHE_TTL
    });
  }

  /**
   * ✅ CACHE: Limpa entradas expiradas do cache
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Requisição GET otimizada com cache e deduplicação
   */
  async get(url: string, params?: any, config?: RequestConfig): Promise<any> {
    // ✅ CACHE: Verificar se deve usar cache (default: true para GET)
    const useCache = config?.useCache !== false;
    const cacheKey = this.generateCacheKey(url, params);
    
    // ✅ CACHE: Tentar obter do cache primeiro
    if (useCache) {
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        logger.debug(`📦 Cache hit para ${url}`);
        return cachedData;
      }
    }
    
    // ✅ DEDUPLICAÇÃO: Verificar se já há uma requisição pendente para os mesmos dados
    if (useCache && this.pendingRequests.has(cacheKey)) {
      logger.debug(`🔄 Aguardando requisição em andamento para ${url}`);
      return await this.pendingRequests.get(cacheKey)!;
    }

    const requestConfig: AxiosRequestConfig = {
      method: 'GET',
      url,
      params,
      timeout: config?.timeout || apiConfig.timeouts.default,
      ...config
    };

    const context = config?.context || `GET ${url}`;
    const retries = config?.retries || apiConfig.retryConfig.attempts;

    // ✅ DEDUPLICAÇÃO: Criar promise e armazenar para outras requisições idênticas
    const requestPromise = withRetry(
      async () => {
        // ✅ RATE LIMITING: Aplicar rate limiting assíncrono
        await this.enforceRateLimit();
        
        const response = await this.client.request(requestConfig);
        const processedData = this.processResponse(response);
        
        // ✅ CACHE: Salvar no cache se bem-sucedido
        if (useCache) {
          this.setCachedData(cacheKey, processedData);
        }
        
        return processedData;
      },
      retries,
      apiConfig.retryConfig.delay,
      context
    );

    // ✅ DEDUPLICAÇÃO: Armazenar promise para evitar requisições duplicadas
    if (useCache) {
      this.pendingRequests.set(cacheKey, requestPromise);
    }
    
    try {
      const result = await requestPromise;
      return result;
    } finally {
      // ✅ LIMPEZA: Remover da lista de pendentes após conclusão
      if (useCache) {
        this.pendingRequests.delete(cacheKey);
      }
      
      // ✅ MANUTENÇÃO: Limpar cache expirado periodicamente
      if (Math.random() < 0.1) { // 10% de chance de limpeza
        this.cleanExpiredCache();
      }
    }
  }

  /**
   * Requisição POST com retry
   */
  async post(url: string, data?: any, config?: RequestConfig): Promise<any> {
    const requestConfig: AxiosRequestConfig = {
      method: 'POST',
      url,
      data,
      timeout: config?.timeout || apiConfig.timeouts.default,
      ...config
    };

    const context = config?.context || `POST ${url}`;
    const retries = config?.retries || apiConfig.retryConfig.attempts;

    return withRetry(
      async () => {
        const response = await this.client.request(requestConfig);
        return this.processResponse(response);
      },
      retries,
      apiConfig.retryConfig.delay,
      context
    );
  }

  /**
   * Processa resposta da API
   */
  private processResponse(response: AxiosResponse): any {
    if (!response.data) {
      throw new Error('Resposta vazia da API');
    }

    // A API da Câmara retorna dados em diferentes formatos
    // Padronizar resposta
    if (typeof response.data === 'object') {
      return response.data;
    }

    // Se for string, tentar fazer parse JSON
    if (typeof response.data === 'string') {
      try {
        return JSON.parse(response.data);
      } catch (error) {
        throw new Error('Resposta da API não é um JSON válido');
      }
    }

    return response.data;
  }

  /**
   * Requisição com paginação automática
   */
  async getAllPages(
    url: string,
    params: any = {},
    config?: RequestConfig & {
      maxPages?: number;
      pageParam?: string;
      itemsParam?: string;
    }
  ): Promise<any[]> {
    const results: any[] = [];
    let currentPage = 1;
    const maxPages = config?.maxPages || Number.MAX_SAFE_INTEGER; // Sem limite - vai até o final real
    const pageParam = config?.pageParam || 'pagina';
    const itemsParam = config?.itemsParam || 'itens';

    logger.info(`📄 Iniciando extração paginada de ${url}`);

    while (currentPage <= maxPages) {
      try {
        const pageParams = {
          ...params,
          [pageParam]: currentPage,
          [itemsParam]: params[itemsParam] || 100
        };

        const response = await this.get(url, pageParams, {
          ...config,
          context: `${config?.context || url} - página ${currentPage}`
        });

        if (!response.dados || !Array.isArray(response.dados)) {
          break;
        }

        const items = response.dados;
        if (items.length === 0) {
          break;
        }

        results.push(...items);
        logger.debug(`📄 Página ${currentPage}: ${items.length} itens (total: ${results.length})`);

        // Verificar se há próxima página usando múltiplos critérios
        const itemsPerPage = parseInt(pageParams[itemsParam]) || 100;
        const hasNextLink = !!response.links?.next;
        const isFullPage = items.length === itemsPerPage;
        
        logger.debug(`📄 Página ${currentPage}: ${items.length}/${itemsPerPage} itens | hasNext: ${hasNextLink} | isFullPage: ${isFullPage}`);

        // Critério robusto de parada: 
        // 1. Se não há próxima página E página não está completa, parar
        // 2. Se página está vazia, parar
        // 3. Se página não está completa (menos itens que solicitado), parar
        if (!hasNextLink && !isFullPage) {
          logger.debug(`📄 Última página alcançada (sem next + página incompleta)`);
          break;
        }
        
        if (items.length < itemsPerPage) {
          logger.debug(`📄 Última página alcançada (página incompleta: ${items.length}/${itemsPerPage})`);
          break;
        }

        currentPage++;

        // Pausa entre páginas
        await new Promise(resolve => setTimeout(resolve, apiConfig.retryConfig.delay));

      } catch (error: any) {
        logger.error(`❌ Erro na página ${currentPage}: ${error.message}`);
        break;
      }
    }

    if (currentPage > maxPages) {
      logger.warn(`⚠️ Limite de páginas (${maxPages}) atingido! Pode haver mais dados disponíveis.`);
    }

    logger.info(`✅ Extração paginada concluída: ${results.length} itens em ${currentPage - 1} páginas`);
    return results;
  }

  /**
   * Verifica conectividade com a API
   */
  async checkConnectivity(): Promise<boolean> {
    try {
      // Fazer uma requisição simples para testar conectividade
      await this.get('/referencias/partidos', {}, {
        timeout: 5000,
        retries: 1,
        context: 'Teste de conectividade'
      });

      return true;
    } catch (error: any) { // Explicitly type error as any
      logger.error(`❌ Falha na conectividade com a API: ${error.message}`);
      return false;
    }
  }

  /**
   * Obtém estatísticas do cliente
   */
  getStats(): {
    requestCount: number;
    lastRequestTime: number;
    baseURL: string;
  } {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      baseURL: this.client.defaults.baseURL || ''
    };
  }

  /**
   * Reset das estatísticas
   */
  resetStats(): void {
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }
}

/**
 * Instância singleton do cliente
 */
export const apiClient = new CamaraAPIClient();

/**
 * Funções de conveniência
 */

/**
 * Requisição GET simples
 */
export async function get(url: string, params?: any, config?: RequestConfig): Promise<any> {
  return apiClient.get(url, params, config);
}

/**
 * Requisição POST simples
 */
export async function post(url: string, data?: any, config?: RequestConfig): Promise<any> {
  return apiClient.post(url, data, config);
}

/**
 * Substitui placeholders em URLs
 */
export function replacePath(pathTemplate: string, params: Record<string, string>): string {
  let path = pathTemplate;

  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }

  return path;
}

/**
 * Valida resposta da API
 */
export function validateResponse(response: any, expectedFields?: string[]): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  if (expectedFields) {
    for (const field of expectedFields) {
      if (!(field in response)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Utilitários de URL
 */
export const urlUtils = {
  /**
   * Constrói URL com parâmetros
   */
  buildUrl(path: string, params?: Record<string, any>): string {
    if (!params || Object.keys(params).length === 0) {
      return path;
    }

    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    return queryString ? `${path}?${queryString}` : path;
  },

  /**
   * Extrai parâmetros de URL
   */
  parseUrl(url: string): { path: string; params: Record<string, string> } {
    const [path, queryString] = url.split('?');
    const params: Record<string, string> = {};

    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      for (const [key, value] of searchParams.entries()) {
        params[key] = value;
      }
    }

    return { path, params };
  },

  /**
   * Valida URL
   */
  isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
};

/**
 * Utilitários de resposta
 */
export const responseUtils = {
  /**
   * Extrai dados de resposta paginada
   */
  extractPagedData(response: any): {
    dados: any[];
    links?: any;
    pagination?: any
  } {
    return {
      dados: response.dados || [],
      links: response.links,
      pagination: {
        currentPage: response.links?.self ? this.extractPageFromUrl(response.links.self) : 1,
        hasNext: !!response.links?.next,
        hasPrev: !!response.links?.prev
      }
    };
  },

  /**
   * Extrai número da página de URL
   */
  extractPageFromUrl(url: string): number {
    const match = url.match(/[?&]pagina=(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  },

  /**
   * Verifica se resposta tem mais páginas
   */
  hasMorePages(response: any): boolean {
    return !!(response.links && response.links.next);
  },

  /**
   * Conta total de itens estimado
   */
  estimateTotal(response: any, currentPage: number, itemsPerPage: number): number {
    if (response.dados && Array.isArray(response.dados)) {
      const currentCount = response.dados.length;

      // Se página não está cheia, é a última
      if (currentCount < itemsPerPage) {
        return ((currentPage - 1) * itemsPerPage) + currentCount;
      }

      // Estimativa baseada em links de paginação
      if (response.links && response.links.last) {
        const lastPage = this.extractPageFromUrl(response.links.last);
        return lastPage * itemsPerPage;
      }
    }

    return 0;
  }
};
