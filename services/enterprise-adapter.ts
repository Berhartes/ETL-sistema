/**
 * Enterprise Adapter - Bridge between Legacy and Enterprise Web Workers
 * 
 * Development Director Decision: Seamless migration path from Legacy to Enterprise
 * ROI: 10/10 - Backward compatibility + Enterprise performance + Zero breaking changes
 * Risk: LOW - Progressive enhancement with full fallback support
 * 
 * MIGRATION BRIDGE: Provides unified interface for both processing systems
 * - Legacy System: Direct service calls (blocking)
 * - Enterprise System: Web Workers orchestration (non-blocking)
 * - Intelligent Fallback: Auto-detects and switches modes
 * - Unified Progress: Common progress interface for both systems
 */

import { type ProcessingOptions as LegacyFornecedoresOptions } from '@/services/global-fornecedores-processor'
import { type ProcessingOptionsTransacoes as LegacyTransacoesOptions } from '@/services/global-transacoes-processor'
import { type ProcessingOptions as EnterpriseOptions } from '@/hooks/useOptimizedProcessador'
import { globalFornecedoresProcessor } from '@/services/global-fornecedores-processor'
import { globalTransacoesProcessor } from '@/services/global-transacoes-processor'
import { dataSyncEventBus } from '@/services/data-sync-event-bus'
import { fornecedoresGlobalCache } from '@/services/fornecedores-global-cache'
import { transacoesGlobalCache } from '@/services/transacoes-global-cache'
import { intelligentFallbackManager, type ProcessingTier } from '@/services/intelligent-fallback'
import { fornecedoresService } from './fornecedores-service.js'

// Unified progress interface
export interface UnifiedProgressCallback {
  (progress: number, message: string, stage?: string): void
}

// Unified processing options
export interface UnifiedProcessingOptions {
  ano?: number | 'todos'
  mes?: string | 'todos' | number
  forceRefresh?: boolean
  limite?: number
  enableAnalytics?: boolean
  mode?: 'auto' | 'enterprise' | 'legacy'
}

// Unified processing result
export interface UnifiedProcessingResult {
  success: boolean
  data: any
  metadata: {
    processedCount: number
    duration: number
    mode: 'enterprise' | 'fallback' | 'legacy'
    workersUsed?: number
    errors: string[]
    warnings: string[]
  }
  performance: {
    throughput: number
    memoryUsage?: number
    uiResponsive: boolean
  }
}

/**
 * Enterprise Adapter Class - Unified Processing Interface
 */
export class EnterpriseAdapter {
  private fallbackOnError = true
  
  /**
   * Process Fornecedores with intelligent mode selection
   */
  async processFornecedores(
    options: UnifiedProcessingOptions = {},
    progressCallback?: UnifiedProgressCallback,
    enterpriseProcessor?: any
  ): Promise<UnifiedProcessingResult> {
    const startTime = performance.now()
    const dataSize = 2000 // Estimate - fornecedores can be large

    // Get intelligent tier recommendation
    const decision = intelligentFallbackManager.decideTier(
      'fornecedores',
      dataSize,
      options.mode as ProcessingTier
    )

    console.log(`[EnterpriseAdapter] Intelligent decision for fornecedores:`, {
      tier: decision.recommendedTier,
      reason: decision.reason,
      confidence: decision.confidence,
      expectedPerformance: decision.expectedPerformance
    })

    // Progress callback with tier info
    if (progressCallback) {
      progressCallback(0, `Iniciando processamento (${decision.recommendedTier})...`)
    }

    try {
      let result: UnifiedProcessingResult

      // Execute based on intelligent decision
      switch (decision.recommendedTier) {
        case 'enterprise':
          if (enterpriseProcessor?.isWorkerPoolReady) {
            console.log('[EnterpriseAdapter] Using Enterprise Web Workers for fornecedores')
            result = await this.processFornecedoresEnterprise(options, progressCallback, enterpriseProcessor)
          } else {
            // Fallback if enterprise not ready
            console.warn('[EnterpriseAdapter] Enterprise recommended but not ready, falling back')
            intelligentFallbackManager.recordFailure('enterprise', 'Web Workers not ready')
            result = await this.processFornecedoresLegacy(options, progressCallback)
            result.metadata.mode = 'legacy'
          }
          break

        case 'fallback':
          console.log('[EnterpriseAdapter] Using Fallback processing for fornecedores')
          // For now, fallback to legacy (could implement single worker later)
          result = await this.processFornecedoresLegacy(options, progressCallback)
          result.metadata.mode = 'fallback'
          break

        case 'legacy':
        default:
          console.log('[EnterpriseAdapter] Using Legacy processing for fornecedores')
          result = await this.processFornecedoresLegacy(options, progressCallback)
          break
      }

      // Record success
      const duration = performance.now() - startTime
      intelligentFallbackManager.recordSuccess(
        result.metadata.mode as ProcessingTier,
        duration,
        result.metadata.processedCount
      )

      return result

    } catch (error) {
      // Record failure and try fallback
      const errorMsg = error instanceof Error ? error.message : String(error)
      intelligentFallbackManager.recordFailure(decision.recommendedTier, errorMsg)

      // Try fallback if not already using legacy
      if (decision.recommendedTier !== 'legacy' && this.fallbackOnError) {
        console.warn(`[EnterpriseAdapter] ${decision.recommendedTier} failed, trying legacy fallback:`, errorMsg)
        try {
          const result = await this.processFornecedoresLegacy(options, progressCallback)
          result.metadata.warnings.push(`Fallback ativado: ${errorMsg}`)
          return result
        } catch (fallbackError) {
          console.error('[EnterpriseAdapter] Even legacy fallback failed:', fallbackError)
          throw fallbackError
        }
      }

      throw error
    }
  }
  
  /**
   * Process Transações with intelligent mode selection
   */
  async processTransacoes(
    options: UnifiedProcessingOptions = {},
    progressCallback?: UnifiedProgressCallback,
    enterpriseProcessor?: any
  ): Promise<UnifiedProcessingResult> {
    const startTime = performance.now()
    const dataSize = 5000 // Estimate - transações typically larger
    
    // Get intelligent tier recommendation
    const decision = intelligentFallbackManager.decideTier(
      'transacoes',
      dataSize,
      options.mode as ProcessingTier
    )
    
    console.log(`[EnterpriseAdapter] Intelligent decision for transacoes:`, {
      tier: decision.recommendedTier,
      reason: decision.reason,
      confidence: decision.confidence,
      expectedPerformance: decision.expectedPerformance
    })
    
    // Progress callback with tier info
    if (progressCallback) {
      progressCallback(0, `Iniciando processamento (${decision.recommendedTier})...`)
    }
    
    try {
      let result: UnifiedProcessingResult
      
      // Execute based on intelligent decision
      switch (decision.recommendedTier) {
        case 'enterprise':
          if (enterpriseProcessor?.isWorkerPoolReady) {
            console.log('[EnterpriseAdapter] Using Enterprise Web Workers for transacoes')
            result = await this.processTransacoesEnterprise(options, progressCallback, enterpriseProcessor)
          } else {
            // Fallback if enterprise not ready
            console.warn('[EnterpriseAdapter] Enterprise recommended but not ready, falling back')
            intelligentFallbackManager.recordFailure('enterprise', 'Web Workers not ready')
            result = await this.processTransacoesLegacy(options, progressCallback)
            result.metadata.mode = 'legacy'
          }
          break
          
        case 'fallback':
          console.log('[EnterpriseAdapter] Using Fallback processing for transacoes')
          // For now, fallback to legacy (could implement single worker later)
          result = await this.processTransacoesLegacy(options, progressCallback)
          result.metadata.mode = 'fallback'
          break
          
        case 'legacy':
        default:
          console.log('[EnterpriseAdapter] Using Legacy processing for transacoes')
          result = await this.processTransacoesLegacy(options, progressCallback)
          break
      }
      
      // Record success
      const duration = performance.now() - startTime
      intelligentFallbackManager.recordSuccess(
        result.metadata.mode as ProcessingTier,
        duration,
        result.metadata.processedCount
      )
      
      return result
      
    } catch (error) {
      // Record failure and try fallback
      const errorMsg = error instanceof Error ? error.message : String(error)
      intelligentFallbackManager.recordFailure(decision.recommendedTier, errorMsg)
      
      // Try fallback if not already using legacy
      if (decision.recommendedTier !== 'legacy' && this.fallbackOnError) {
        console.warn(`[EnterpriseAdapter] ${decision.recommendedTier} failed, trying legacy fallback:`, errorMsg)
        try {
          const result = await this.processTransacoesLegacy(options, progressCallback)
          result.metadata.warnings.push(`Fallback ativado: ${errorMsg}`)
          return result
        } catch (fallbackError) {
          console.error('[EnterpriseAdapter] Even legacy fallback failed:', fallbackError)
          throw fallbackError
        }
      }
      
      throw error
    }
  }
  
  /**
   * Process Fornecedores using Enterprise Web Workers - REBUILT FROM SCRATCH
   * Based on the simple, working transações method
   */
  private async processFornecedoresEnterprise(
    options: UnifiedProcessingOptions,
    progressCallback?: UnifiedProgressCallback,
    enterpriseProcessor?: any
  ): Promise<UnifiedProcessingResult> {
    const startTime = performance.now()
    
    console.log('[EnterpriseAdapter] Starting OPTIMIZED Enterprise fornecedores processing...', options)
    
    // ✅ Get fornecedores data with improved method
    const fornecedoresData = await this.getFornecedoresDataSimple(options)
    
    // ✅ NEW: Validate data structure before sending to Web Workers
    this.validateFornecedoresDataForWorkers(fornecedoresData)
    
    // Convert to Enterprise format - ALIGNED WITH TRANSAÇÕES
    const enterpriseOptions: EnterpriseOptions = {
      fornecedores: fornecedoresData,
      options: {
        parallelWorkers: 2,
        enableAnalytics: options.enableAnalytics ?? true,
        priority: 'HIGH',
        useCache: !options.forceRefresh
      }
    }
    
    console.log(`[EnterpriseAdapter] Validated ${fornecedoresData.length} fornecedores for Web Workers processing`)
    
    // Setup progress bridge
    if (progressCallback) {
      this.bridgeEnterpriseProgress(enterpriseProcessor, progressCallback, 'fornecedores')
    }
    
    // Execute enterprise processing - ALIGNED WITH TRANSAÇÕES
    const result = await enterpriseProcessor.startProcessing(enterpriseOptions)
    
    if (!result) {
      throw new Error('Enterprise processing returned null result')
    }
    
    const duration = performance.now() - startTime
    
    const fornecedoresList = result.results.fornecedores || result.results.processedFornecedores || [];
    
    // Organizar fornecedores por categoria para a estrutura esperada pelo cache
    const categorias: Record<string, any[]> = {};
    fornecedoresList.forEach((fornecedor: any) => {
      // Se o fornecedor não tem categoria, usar 'Outros'
      const categoria = fornecedor.categoria || fornecedor.categorias?.[0] || 'Outros';
      if (!categorias[categoria]) {
        categorias[categoria] = [];
      }
      categorias[categoria].push(fornecedor);
    });

    const processedData = {
      lastProcessed: new Date().toISOString(),
      totalFornecedores: fornecedoresList.length,
      processingTime: Math.round(duration),
      categorias,
      estatisticas: this.calculateFornecedoresStats(fornecedoresList)
    }
    
    console.log(`[EnterpriseAdapter] Enterprise processing completed: ${processedData.totalFornecedores} fornecedores processed in ${Math.round(duration)}ms`)
    
    // Update cache with enterprise processed data - EXACTLY LIKE TRANSAÇÕES
    try {
      fornecedoresGlobalCache.setCache(processedData)
      console.log('[EnterpriseAdapter] Fornecedores cache updated with enterprise data')
      
      // Notify event bus
      dataSyncEventBus.notifyFornecedoresProcessingCompleted(
        'EnterpriseProcessor',
        result.metadata.processedItems
      )
    } catch (cacheError) {
      console.warn('[EnterpriseAdapter] Fornecedores cache update failed:', cacheError)
    }
    
    return {
      success: true,
      data: processedData,
      metadata: {
        processedCount: result.metadata.processedItems,
        duration,
        mode: 'enterprise',
        workersUsed: result.performance.workersUsed,
        errors: result.metadata.errors,
        warnings: result.metadata.warnings
      },
      performance: {
        throughput: result.performance.throughput,
        memoryUsage: result.performance.averageMemoryUsage,
        uiResponsive: true
      }
    }
  }
  
  /**
   * Process Transações using Enterprise Web Workers
   */
  private async processTransacoesEnterprise(
    options: UnifiedProcessingOptions,
    progressCallback?: UnifiedProgressCallback,
    enterpriseProcessor?: any
  ): Promise<UnifiedProcessingResult> {
    const startTime = performance.now()
    
    // Convert to Enterprise format
    const enterpriseOptions: EnterpriseOptions = {
      // Get transações data from Firestore
      transacoes: await this.getTransacoesData(options),
      options: {
        parallelWorkers: 2,
        enableAnalytics: options.enableAnalytics ?? true,
        priority: 'HIGH',
        useCache: !options.forceRefresh
      }
    }
    
    // Setup progress bridge
    if (progressCallback) {
      this.bridgeEnterpriseProgress(enterpriseProcessor, progressCallback, 'transacoes')
    }
    
    // Execute enterprise processing
    const result = await enterpriseProcessor.startProcessing(enterpriseOptions)
    
    if (!result) {
      throw new Error('Enterprise processing returned null result')
    }
    
    const duration = performance.now() - startTime
    
    const processedData = {
      transacoes: result.results.transacoes,
      estatisticas: this.calculateTransacoesStats(result.results.transacoes)
    }
    
    // Update cache with enterprise processed data
    try {
      await transacoesGlobalCache.set(processedData, {
        metadata: {
          processedBy: 'EnterpriseWebWorkers',
          workersUsed: result.performance.workersUsed,
          throughput: result.performance.throughput
        }
      })
      console.log('[EnterpriseAdapter] Transacoes cache updated with enterprise data')
      
      // Notify event bus
      dataSyncEventBus.notifyTransacoesProcessingCompleted(
        'EnterpriseProcessor',
        result.metadata.processedItems
      )
    } catch (cacheError) {
      console.warn('[EnterpriseAdapter] Transacoes cache update failed:', cacheError)
    }
    
    return {
      success: true,
      data: processedData,
      metadata: {
        processedCount: result.metadata.processedItems,
        duration,
        mode: 'enterprise',
        workersUsed: result.performance.workersUsed,
        errors: result.metadata.errors,
        warnings: result.metadata.warnings
      },
      performance: {
        throughput: result.performance.throughput,
        memoryUsage: result.performance.averageMemoryUsage,
        uiResponsive: true
      }
    }
  }
  
  /**
   * Process Fornecedores using Legacy system
   */
  private async processFornecedoresLegacy(
    options: UnifiedProcessingOptions,
    progressCallback?: UnifiedProgressCallback
  ): Promise<UnifiedProcessingResult> {
    const startTime = performance.now()
    
    // Convert to Legacy format
    const legacyOptions: LegacyFornecedoresOptions = {
      ano: options.ano,
      mes: options.mes as string,
      forceRefresh: options.forceRefresh,
      limite: options.limite
    }
    
    // Bridge progress callback
    const legacyProgressCallback = progressCallback ? 
      (progress: number, message: string) => progressCallback(progress, message, 'legacy') :
      undefined
    
    // Execute legacy processing
    const result = await globalFornecedoresProcessor.processarTodasFornecedoras(
      legacyProgressCallback,
      legacyOptions
    )
    
    // Cache update and event notification are handled by the legacy service
    // But we can add enterprise metadata
    try {
      dataSyncEventBus.notifyCustomEvent('EnterpriseAdapter', 'LEGACY_PROCESSING_COMPLETED', {
        type: 'fornecedores',
        count: result.totalFornecedores,
        duration: performance.now() - startTime,
        mode: 'legacy'
      })
    } catch (eventError) {
      console.warn('[EnterpriseAdapter] Event notification failed:', eventError)
    }
    
    const duration = performance.now() - startTime
    
    return {
      success: true,
      data: result,
      metadata: {
        processedCount: result.totalFornecedores,
        duration,
        mode: 'legacy',
        errors: [],
        warnings: ['Processamento síncrono - UI pode ficar menos responsiva']
      },
      performance: {
        throughput: result.totalFornecedores / (duration / 1000),
        uiResponsive: false
      }
    }
  }
  
  /**
   * Process Transações using Legacy system
   */
  private async processTransacoesLegacy(
    options: UnifiedProcessingOptions,
    progressCallback?: UnifiedProgressCallback
  ): Promise<UnifiedProcessingResult> {
    const startTime = performance.now()
    
    // Convert to Legacy format
    const legacyOptions: LegacyTransacoesOptions = {
      ano: options.ano,
      mes: options.mes as string | number,
      forceRefresh: options.forceRefresh,
      limite: options.limite
    }
    
    // Bridge progress callback
    const legacyProgressCallback = progressCallback ?
      (progress: number, message: string) => progressCallback(progress, message, 'legacy') :
      undefined
    
    // Execute legacy processing
    const result = await globalTransacoesProcessor.processTransacoes(legacyOptions)
    
    // Cache update and event notification are handled by the legacy service
    // But we can add enterprise metadata
    try {
      dataSyncEventBus.notifyCustomEvent('EnterpriseAdapter', 'LEGACY_PROCESSING_COMPLETED', {
        type: 'transacoes',
        count: result.estatisticas.totalTransacoes,
        duration: performance.now() - startTime,
        mode: 'legacy'
      })
    } catch (eventError) {
      console.warn('[EnterpriseAdapter] Event notification failed:', eventError)
    }
    
    const duration = performance.now() - startTime
    
    return {
      success: true,
      data: result,
      metadata: {
        processedCount: result.estatisticas.totalTransacoes,
        duration,
        mode: 'legacy',
        errors: [],
        warnings: ['Processamento síncrono - UI pode ficar menos responsiva']
      },
      performance: {
        throughput: result.estatisticas.totalTransacoes / (duration / 1000),
        uiResponsive: false
      }
    }
  }
  
  /**
   * Bridge Enterprise progress to unified callback
   */
  private bridgeEnterpriseProgress(
    enterpriseProcessor: any,
    callback: UnifiedProgressCallback,
    type: string
  ): void {
    // Monitor enterprise processor progress
    const checkProgress = () => {
      if (enterpriseProcessor.isProcessing) {
        const progress = enterpriseProcessor.progress
        callback(
          progress.overall,
          progress.stage,
          `enterprise-${type}`
        )
        setTimeout(checkProgress, 100) // Check every 100ms
      }
    }
    checkProgress()
  }
  
  /**
   * Get fornecedores data for processing - OPTIMIZED VERSION ALIGNED WITH TRANSAÇÕES
   */
  private async getFornecedoresDataSimple(options: UnifiedProcessingOptions): Promise<any[]> {
    try {
      console.log('[EnterpriseAdapter] Fetching fornecedores data OPTIMIZED...', options)
      
      // 1. ✅ Try to get from cache first (if not forcing refresh) - EXACTLY LIKE TRANSAÇÕES
      if (!options.forceRefresh) {
        const cachedData = fornecedoresGlobalCache.getCache()
        if (cachedData?.categorias) {
          // ✅ Extract fornecedores from cache categories efficiently
          const allFornecedores = this.extractFornecedoresFromCategorias(cachedData.categorias)
          if (allFornecedores.length > 0) {
            console.log(`[EnterpriseAdapter] Using cached fornecedores: ${allFornecedores.length} items`)
            return allFornecedores
          }
        }
      }
      
      // 2. ✅ NEW: Fetch data directly via service (aligned with transações approach)
      console.log('[EnterpriseAdapter] Fetching fresh data via fornecedoresService...')
      const serviceResponse = await fornecedoresService.buscarFornecedoresUnificado({
        ano: options.ano,
        mes: options.mes as string,
        apenasComScore: false,
        scoreMinimo: 0,
        limite: options.limite
      })
      
      if (serviceResponse?.fornecedores?.length > 0) {
        console.log(`[EnterpriseAdapter] Fetched ${serviceResponse.fornecedores.length} fornecedores via direct service`)
        return serviceResponse.fornecedores
      }
      
      // 3. ✅ Fallback to legacy method if direct service fails
      console.warn('[EnterpriseAdapter] Direct service returned no data, falling back to legacy processor...')
      return await this.fallbackToLegacyFornecedores(options)
      
    } catch (error) {
      console.error('[EnterpriseAdapter] Error fetching fornecedores data:', error)
      // ✅ Try legacy fallback as last resort
      try {
        return await this.fallbackToLegacyFornecedores(options)
      } catch (fallbackError) {
        console.error('[EnterpriseAdapter] Legacy fallback also failed:', fallbackError)
        return []
      }
    }
  }
  
  /**
   * Get transações data for processing
   */
  private async getTransacoesData(options: UnifiedProcessingOptions): Promise<any[]> {
    try {
      // Try to get from cache first (if not forcing refresh)
      if (!options.forceRefresh) {
        const cachedData = transacoesGlobalCache.get()
        if (cachedData && cachedData.transacoes && cachedData.transacoes.length > 0) {
          console.log(`[EnterpriseAdapter] Using cached transacoes data: ${cachedData.transacoes.length} items`)
          return cachedData.transacoes
        }
      }
      
      // Fetch fresh data via service
      console.log('[EnterpriseAdapter] Fetching fresh transacoes data...')
      const result = await globalTransacoesProcessor.processTransacoes({
        ano: options.ano,
        mes: options.mes as string | number,
        forceRefresh: true,
        limite: options.limite
      })
      
      if (result && result.transacoes) {
        console.log(`[EnterpriseAdapter] Fetched ${result.transacoes.length} transacoes`)
        return result.transacoes
      }
      
      return []
    } catch (error) {
      console.error('[EnterpriseAdapter] Error fetching transacoes data:', error)
      return []
    }
  }
  
  /**
   * Organize fornecedores by categories
   */
  private organizeFornecedoresByCategorias(fornecedores: any[]): Record<string, any[]> {
    const categorias: Record<string, any[]> = {}
    
    fornecedores.forEach(f => {
      const categoria = f.categoriaNormalizada || 'OUTROS'
      if (!categorias[categoria]) {
        categorias[categoria] = []
      }
      categorias[categoria].push(f)
    })
    
    return categorias
  }
  
  /**
   * Calculate fornecedores statistics
   */
  private calculateFornecedoresStats(fornecedores: any[]): any {
    return {
      totalFornecedores: fornecedores.length,
      totalVolume: fornecedores.reduce((sum, f) => sum + (f.totalRecebido || 0), 0),
      // Add more stats as needed
    }
  }
  
  /**
   * Calculate transações statistics
   */
  private calculateTransacoesStats(transacoes: any[]): any {
    return {
      totalTransacoes: transacoes.length,
      valorTotal: transacoes.reduce((sum, t) => sum + (t.valorLiquido || 0), 0),
      // Add more stats as needed
    }
  }
  
  /**
   * ✅ NEW: Extract fornecedores from categorias structure efficiently
   */
  private extractFornecedoresFromCategorias(categorias: Record<string, any[]>): any[] {
    const allFornecedores: any[] = []
    
    Object.values(categorias).forEach((categoryFornecedores) => {
      if (Array.isArray(categoryFornecedores)) {
        allFornecedores.push(...categoryFornecedores)
      }
    })
    
    console.log(`[EnterpriseAdapter] Extracted ${allFornecedores.length} fornecedores from ${Object.keys(categorias).length} categories`)
    return allFornecedores
  }
  
  /**
   * ✅ NEW: Fallback to legacy fornecedores processing method
   */
  private async fallbackToLegacyFornecedores(options: UnifiedProcessingOptions): Promise<any[]> {
    console.warn('[EnterpriseAdapter] Using legacy fornecedores fallback processing...')
    
    try {
      const result = await globalFornecedoresProcessor.processarTodasFornecedoras(
        undefined, // No progress callback for fallback
        {
          ano: options.ano,
          mes: options.mes as string,
          forceRefresh: true,
          limite: options.limite
        }
      )
      
      if (result?.categorias) {
        return this.extractFornecedoresFromCategorias(result.categorias)
      }
      
      return []
    } catch (error) {
      console.error('[EnterpriseAdapter] Legacy fornecedores fallback failed:', error)
      return []
    }
  }
  
  /**
   * ✅ NEW: Validate fornecedores data structure before sending to Web Workers
   */
  private validateFornecedoresDataForWorkers(fornecedoresData: any[]): void {
    console.log('[EnterpriseAdapter] Validating fornecedores data structure for Web Workers...')
    
    // 1. ✅ Check if data exists
    if (!fornecedoresData || !Array.isArray(fornecedoresData)) {
      throw new Error('Fornecedores data must be a valid array')
    }
    
    // 2. ✅ Check if array is not empty
    if (fornecedoresData.length === 0) {
      throw new Error('Nenhum fornecedor válido encontrado para processamento enterprise')
    }
    
    // 3. ✅ Validate data structure (each fornecedor should have basic fields)
    const isValidStructure = fornecedoresData.every((fornecedor, index) => {
      if (!fornecedor || typeof fornecedor !== 'object') {
        console.error(`[EnterpriseAdapter] Invalid fornecedor at index ${index}:`, fornecedor)
        return false
      }
      
      // Check for essential fields
      const hasName = fornecedor.nome || fornecedor.nomeFornecedor
      const hasIdentifier = fornecedor.cnpj || fornecedor.cpfCnpj || fornecedor.id
      
      if (!hasName || !hasIdentifier) {
        console.error(`[EnterpriseAdapter] Fornecedor missing essential fields at index ${index}:`, {
          hasName: !!hasName,
          hasIdentifier: !!hasIdentifier,
          fornecedor: fornecedor
        })
        return false
      }
      
      return true
    })
    
    if (!isValidStructure) {
      throw new Error('Estrutura de dados dos fornecedores incompatível com Web Workers')
    }
    
    // 4. ✅ Check data quality
    const validCount = fornecedoresData.length
    const minExpected = 100 // Minimum expected for a healthy dataset
    
    if (validCount < minExpected) {
      console.warn(`[EnterpriseAdapter] Low fornecedores count detected: ${validCount} (expected >= ${minExpected})`)
    }
    
    console.log(`[EnterpriseAdapter] ✅ Data validation passed: ${validCount} valid fornecedores ready for Web Workers`)
    
    // 5. ✅ Log sample data for debugging
    if (fornecedoresData.length > 0) {
      const sample = fornecedoresData[0]
      console.log('[EnterpriseAdapter] Sample fornecedor structure:', {
        nome: sample.nome || sample.nomeFornecedor,
        cnpj: sample.cnpj || sample.cpfCnpj || sample.id,
        totalRecebido: sample.totalRecebido || sample.totalTransacionado,
        hasValidStructure: true
      })
    }
  }
  
}

// Export singleton instance
export const enterpriseAdapter = new EnterpriseAdapter()