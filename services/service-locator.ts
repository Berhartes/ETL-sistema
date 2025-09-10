/**
 * Service Locator Pattern - Breaks Circular Dependencies
 * 
 * This pattern provides loose coupling between contexts and services
 * by using dynamic imports and lazy initialization.
 */

type ServiceFactory<T> = () => Promise<T>;
type ServiceInstance<T> = T | Promise<T>;

interface ServiceRegistry {
  [key: string]: {
    factory: ServiceFactory<any>;
    instance?: ServiceInstance<any>;
    loading?: boolean;
  }
}

class ServiceLocator {
  private registry: ServiceRegistry = {};
  private cache = new Map<string, any>();

  /**
   * Register a service with lazy loading factory
   */
  register<T>(name: string, factory: ServiceFactory<T>): void {
    this.registry[name] = {
      factory,
      instance: undefined,
      loading: false
    };
  }

  /**
   * Get service instance (async)
   */
  async get<T>(name: string): Promise<T> {
    console.log(`[ServiceLocator] 🔍 Buscando serviço: ${name}`);
    
    // Return cached instance if available
    if (this.cache.has(name)) {
      console.log(`[ServiceLocator] ✅ Cache hit para: ${name}`);
      return this.cache.get(name);
    }

    const service = this.registry[name];
    console.log(`[ServiceLocator] Registry status for ${name}:`, {
      exists: !!service,
      registeredServices: Object.keys(this.registry)
    });
    
    if (!service) {
      throw new Error(`Service '${name}' not registered`);
    }

    // Return existing instance or promise if loading
    if (service.instance) {
      const resolved = await service.instance;
      this.cache.set(name, resolved);
      return resolved;
    }

    // Prevent multiple concurrent loads
    if (service.loading) {
      // Wait for current loading to complete
      while (service.loading) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return this.get(name); // Retry after loading completes
    }

    // Load the service
    service.loading = true;
    try {
      service.instance = service.factory();
      const resolved = await service.instance;
      this.cache.set(name, resolved);
      service.loading = false;
      return resolved;
    } catch (error) {
      service.loading = false;
      throw error;
    }
  }

  /**
   * Get service synchronously if already loaded
   */
  getSync<T>(name: string): T | null {
    return this.cache.get(name) || null;
  }

  /**
   * Check if service is loaded
   */
  isLoaded(name: string): boolean {
    return this.cache.has(name);
  }

  /**
   * Preload service (useful for critical services)
   */
  async preload(name: string): Promise<void> {
    await this.get(name);
  }

  /**
   * Clear service cache (useful for testing)
   */
  clear(name?: string): void {
    if (name) {
      this.cache.delete(name);
      delete this.registry[name];
    } else {
      this.cache.clear();
      this.registry = {};
    }
  }
}

// Global service locator instance
export const serviceLocator = new ServiceLocator();

// Service registration helpers
export const registerServices = () => {
  console.log('[ServiceLocator] 📋 Registrando serviços...');
  
  // Register firestore service with dynamic import
  serviceLocator.register('firestoreService', async () => {
    console.log('[ServiceLocator] 🔄 Carregando firestoreService...');
    const { firestoreService } = await import('@/services/firestore-service');
    console.log('[ServiceLocator] ✅ firestoreService carregado:', !!firestoreService);
    return firestoreService;
  });

  // Register alertas service (with fallback)
  serviceLocator.register('alertasRobustosService', async () => {
    try {
      const { alertasRobustosService } = await import('@/services/alertas-robustos');
      return alertasRobustosService;
    } catch (error) {
      console.warn('⚠️ alertasRobustosService not available, using mock');
      return {
        gerarAlertasRobustos: async () => []
      };
    }
  });

  // Register fornecedores service (with fallback)
  serviceLocator.register('fornecedoresService', async () => {
    try {
      const { fornecedoresService } = await import('@/services/fornecedores-service');
      return fornecedoresService;
    } catch (error) {
      console.warn('⚠️ fornecedoresService not available, using mock');
      return {};
    }
  });

  // Register unified ranking service (with fallback)
  serviceLocator.register('unifiedRankingService', async () => {
    try {
      const { unifiedRankingService } = await import('@/services/unified-ranking-service');
      return unifiedRankingService;
    } catch (error) {
      console.warn('⚠️ unifiedRankingService not available, using mock');
      return {};
    }
  });

  // Add more services as needed...
};

// Helper hooks for React components
export const useService = <T>(serviceName: string) => {
  const [service, setService] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const loadService = async () => {
      try {
        setLoading(true);
        const serviceInstance = await serviceLocator.get<T>(serviceName);
        if (mounted) {
          setService(serviceInstance);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Service load failed'));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Check if already loaded
    const cached = serviceLocator.getSync<T>(serviceName);
    if (cached) {
      setService(cached);
      setLoading(false);
    } else {
      loadService();
    }

    return () => {
      mounted = false;
    };
  }, [serviceName]);

  return { service, loading, error };
};

// React import for useEffect and useState
import React from 'react';

// Export types for consumers
export type { ServiceFactory, ServiceInstance };