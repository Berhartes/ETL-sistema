import { unifiedCacheService } from '../../unified-cache-service.js';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CacheOptions {
  duration: number;
  maxSize?: number;
  keyPrefix?: string;
}

export class FirestoreCache {
  private readonly DEFAULT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutos
  private readonly DEFAULT_MAX_SIZE = 1000;

  // Cache específico para diferentes tipos de dados
  private fornecedoresCache = new Map<string, CacheEntry<any>>();
  private deputadosCache = new Map<string, CacheEntry<any>>();
  private transacoesCache = new Map<string, CacheEntry<any>>();
  private rankingsCache = new Map<string, CacheEntry<any>>();
  private bancoVazioCache: CacheEntry<boolean> | null = null;

  private readonly cacheOptions: CacheOptions = {
    duration: this.DEFAULT_CACHE_DURATION,
    maxSize: this.DEFAULT_MAX_SIZE
  };

  /**
   * Buscar dados do cache ou executar função se não encontrado
   */
  async getOrSet<T>(
    key: string, 
    fetchFunction: () => Promise<T>, 
    cacheType: 'fornecedores' | 'deputados' | 'transacoes' | 'rankings' = 'fornecedores',
    customDuration?: number
  ): Promise<T> {
    const cache = this.getCacheByType(cacheType);
    const duration = customDuration || this.cacheOptions.duration;
    
    // Verificar se existe no cache e se ainda é válido
    const cached = cache.get(key);
    if (cached && this.isCacheValid(cached, duration)) {
      return cached.data;
    }

    // Buscar dados frescos
    try {
      const data = await fetchFunction();
      
      // Salvar no cache
      this.setCache(cacheType, key, data);
      
      return data;
    } catch (error) {
      // Se houver dados em cache (mesmo expirados), retornar como fallback
      if (cached) {
        console.warn(`[FirestoreCache] Usando dados expirados como fallback para: ${key}`);
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Definir dados no cache
   */
  set<T>(key: string, data: T, cacheType: 'fornecedores' | 'deputados' | 'transacoes' | 'rankings' = 'fornecedores'): void {
    this.setCache(cacheType, key, data);
  }

  /**
   * Buscar dados do cache
   */
  get<T>(key: string, cacheType: 'fornecedores' | 'deputados' | 'transacoes' | 'rankings' = 'fornecedores'): T | null {
    const cache = this.getCacheByType(cacheType);
    const cached = cache.get(key);
    
    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }
    
    return null;
  }

  /**
   * Cache específico para status de banco vazio
   */
  getBancoVazioCache(): boolean | null {
    if (this.bancoVazioCache && this.isCacheValid(this.bancoVazioCache, 5 * 60 * 1000)) {
      return this.bancoVazioCache.data;
    }
    return null;
  }

  setBancoVazioCache(isEmpty: boolean): void {
    this.bancoVazioCache = {
      data: isEmpty,
      timestamp: Date.now()
    };
  }

  clearBancoVazioCache(): void {
    this.bancoVazioCache = null;
  }

  /**
   * Verificar se entrada do cache é válida
   */
  private isCacheValid(entry: CacheEntry<any>, customDuration?: number): boolean {
    const duration = customDuration || this.cacheOptions.duration;
    return (Date.now() - entry.timestamp) < duration;
  }

  /**
   * Obter cache por tipo
   */
  private getCacheByType(cacheType: string): Map<string, CacheEntry<any>> {
    switch (cacheType) {
      case 'fornecedores':
        return this.fornecedoresCache;
      case 'deputados':
        return this.deputadosCache;
      case 'transacoes':
        return this.transacoesCache;
      case 'rankings':
        return this.rankingsCache;
      default:
        return this.fornecedoresCache;
    }
  }

  /**
   * Definir dados no cache com verificação de tamanho
   */
  private setCache<T>(cacheType: string, key: string, data: T): void {
    const cache = this.getCacheByType(cacheType);
    
    // Limpar cache se atingir o tamanho máximo
    if (cache.size >= this.cacheOptions.maxSize!) {
      this.clearOldestEntries(cache, Math.floor(this.cacheOptions.maxSize! * 0.2));
    }
    
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Limpar entradas mais antigas do cache
   */
  private clearOldestEntries(cache: Map<string, CacheEntry<any>>, count: number): void {
    const entries = Array.from(cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, count);
    
    entries.forEach(([key]) => cache.delete(key));
  }

  /**
   * Limpar cache por tipo
   */
  clearCache(cacheType?: 'fornecedores' | 'deputados' | 'transacoes' | 'rankings'): void {
    if (cacheType) {
      this.getCacheByType(cacheType).clear();
      console.log(`[FirestoreCache] Cache limpo: ${cacheType}`);
    } else {
      // Limpar todos os caches
      this.fornecedoresCache.clear();
      this.deputadosCache.clear();
      this.transacoesCache.clear();
      this.rankingsCache.clear();
      this.bancoVazioCache = null;
      console.log('[FirestoreCache] Todos os caches limpos');
    }
  }

  /**
   * Obter estatísticas do cache
   */
  getCacheStats(): {
    fornecedores: number;
    deputados: number;
    transacoes: number;
    rankings: number;
    bancoVazio: boolean;
  } {
    return {
      fornecedores: this.fornecedoresCache.size,
      deputados: this.deputadosCache.size,
      transacoes: this.transacoesCache.size,
      rankings: this.rankingsCache.size,
      bancoVazio: this.bancoVazioCache !== null
    };
  }

  /**
   * Integração com unified-cache-service existente
   */
  async getFromUnifiedCache<T>(key: string): Promise<T | null> {
    try {
      return await unifiedCacheService.get(key);
    } catch (error) {
      console.error('[FirestoreCache] Erro ao acessar unified-cache:', error);
      return null;
    }
  }

  async setToUnifiedCache<T>(key: string, data: T, duration?: number): Promise<void> {
    try {
      await unifiedCacheService.set(key, data, duration);
    } catch (error) {
      console.error('[FirestoreCache] Erro ao definir unified-cache:', error);
    }
  }
}

export const firestoreCache = new FirestoreCache();