/**
 * 🔗 MÓDULO DE INTEGRAÇÃO COM SISTEMA V4 DE CATEGORIAS
 * 
 * Integra a ETL com o novo sistema unificado de categorias,
 * eliminando duplicação e garantindo consistência.
 */

import { categoryRegistry, CategoryDefinition, CategoryUtils } from '../../../../../categories/CategoryRegistry.js'

export interface CategoryMappingResult {
  /** Categoria encontrada no Sistema V4 */
  category: CategoryDefinition | null
  
  /** Nome original da API da Câmara */
  originalName: string
  
  /** ID único para usar nos rankings */
  id: number | null
  
  /** Código normalizado para IDs do Firestore */
  firestoreId: string
  
  /** Confiança do matching (0-1) */
  confidence: number
  
  /** Tipo de match encontrado */
  matchType: 'exact' | 'alias' | 'keyword' | 'fuzzy' | 'unmapped'
}

export interface CategoryStats {
  /** Total de categorias processadas */
  totalProcessed: number
  
  /** Categorias mapeadas com sucesso */
  mapped: number
  
  /** Categorias não mapeadas */
  unmapped: number
  
  /** Categorias com baixa confiança */
  lowConfidence: number
  
  /** Detalhes por categoria */
  details: Map<string, CategoryMappingResult>
}

/**
 * Módulo responsável por integrar categorias da ETL com Sistema V4
 */
export class CategoryIntegrationModule {
  private mappingCache = new Map<string, CategoryMappingResult>()
  private stats: CategoryStats = {
    totalProcessed: 0,
    mapped: 0,
    unmapped: 0,
    lowConfidence: 0,
    details: new Map()
  }
  
  constructor(
    private logger: any,
    private emitProgress?: (status: any, progress: number, message: string) => void
  ) {
    this.logger.info('🔗 [CategoryIntegration] Módulo de integração inicializado')
  }
  
  /**
   * Mapeia uma categoria da API da Câmara para o Sistema V4
   */
  mapCategory(originalName: string): CategoryMappingResult {
    // Verificar cache primeiro
    if (this.mappingCache.has(originalName)) {
      return this.mappingCache.get(originalName)!
    }
    
    this.stats.totalProcessed++
    
    // Tentar encontrar categoria no Sistema V4
    const findResult = categoryRegistry.findCategory(originalName)
    
    let result: CategoryMappingResult
    
    if (findResult && findResult.confidence >= 0.7) {
      // Categoria encontrada com boa confiança
      result = {
        category: findResult.category,
        originalName,
        id: findResult.category.id,
        firestoreId: `cat_${findResult.category.id}_${findResult.category.code}`,
        confidence: findResult.confidence,
        matchType: findResult.matchType
      }
      
      this.stats.mapped++
      if (findResult.confidence < 0.9) {
        this.stats.lowConfidence++
      }
      
      this.logger.debug(`✅ [CategoryIntegration] Mapeado: "${originalName}" → ${findResult.category.displayName} (${findResult.confidence.toFixed(2)})`)
      
    } else {
      // Categoria não encontrada - criar fallback
      result = {
        category: null,
        originalName,
        id: null,
        firestoreId: this.createFallbackId(originalName),
        confidence: 0,
        matchType: 'unmapped'
      }
      
      this.stats.unmapped++
      this.logger.warn(`⚠️ [CategoryIntegration] Não mapeado: "${originalName}" - usando fallback`)
    }
    
    // Cache e estatísticas
    this.mappingCache.set(originalName, result)
    this.stats.details.set(originalName, result)
    
    return result
  }
  
  /**
   * Mapeia múltiplas categorias de uma vez
   */
  mapCategories(originalNames: string[]): Map<string, CategoryMappingResult> {
    const results = new Map<string, CategoryMappingResult>()
    
    this.emitProgress?.('TRANSFORMANDO', 70, `Mapeando ${originalNames.length} categorias...`)
    
    for (let i = 0; i < originalNames.length; i++) {
      const name = originalNames[i]
      const result = this.mapCategory(name)
      results.set(name, result)
      
      // Progress update a cada 10 categorias
      if (i % 10 === 0) {
        const progress = 70 + (i / originalNames.length) * 10
        this.emitProgress?.('TRANSFORMANDO', progress, `Mapeando categorias... ${i}/${originalNames.length}`)
      }
    }
    
    this.logMappingStats()
    return results
  }
  
  /**
   * Cria ID de fallback para categorias não mapeadas
   */
  private createFallbackId(originalName: string): string {
    const normalized = originalName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50)
    
    return `fallback_${normalized}_${this.generateShortHash(originalName)}`
  }
  
  /**
   * Gera hash curto para IDs únicos
   */
  private generateShortHash(text: string): string {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8)
  }
  
  /**
   * Obtém estatísticas do mapeamento
   */
  getStats(): CategoryStats {
    return { ...this.stats }
  }
  
  /**
   * Log das estatísticas de mapeamento
   */
  private logMappingStats(): void {
    const { totalProcessed, mapped, unmapped, lowConfidence } = this.stats
    const mappedPercent = ((mapped / totalProcessed) * 100).toFixed(1)
    
    this.logger.info('📊 [CategoryIntegration] Estatísticas de Mapeamento:')
    this.logger.info(`   - Total processadas: ${totalProcessed}`)
    this.logger.info(`   - Mapeadas: ${mapped} (${mappedPercent}%)`)
    this.logger.info(`   - Não mapeadas: ${unmapped}`)
    this.logger.info(`   - Baixa confiança: ${lowConfidence}`)
    
    if (unmapped > 0) {
      this.logger.warn('⚠️ [CategoryIntegration] Categorias não mapeadas:')
      this.stats.details.forEach((result, name) => {
        if (result.matchType === 'unmapped') {
          this.logger.warn(`   - "${name}"`)
        }
      })
    }
  }
  
  /**
   * Exporta mapeamento para debug/auditoria
   */
  exportMappingReport(): {
    timestamp: string
    totalCategories: number
    mappingSuccess: number
    unmappedCategories: string[]
    lowConfidenceCategories: Array<{name: string, confidence: number}>
    fullDetails: Array<{
      original: string
      mapped: string | null
      id: number | null
      confidence: number
      matchType: string
    }>
  } {
    const unmapped: string[] = []
    const lowConfidence: Array<{name: string, confidence: number}> = []
    const fullDetails: Array<{
      original: string
      mapped: string | null
      id: number | null
      confidence: number
      matchType: string
    }> = []
    
    this.stats.details.forEach((result, name) => {
      if (result.matchType === 'unmapped') {
        unmapped.push(name)
      }
      
      if (result.confidence > 0 && result.confidence < 0.9) {
        lowConfidence.push({ name, confidence: result.confidence })
      }
      
      fullDetails.push({
        original: name,
        mapped: result.category?.displayName || null,
        id: result.id,
        confidence: result.confidence,
        matchType: result.matchType
      })
    })
    
    return {
      timestamp: new Date().toISOString(),
      totalCategories: this.stats.totalProcessed,
      mappingSuccess: this.stats.mapped,
      unmappedCategories: unmapped,
      lowConfidenceCategories: lowConfidence,
      fullDetails
    }
  }
  
  /**
   * Limpa cache (útil para reprocessamento)
   */
  clearCache(): void {
    this.mappingCache.clear()
    this.stats = {
      totalProcessed: 0,
      mapped: 0,
      unmapped: 0,
      lowConfidence: 0,
      details: new Map()
    }
    this.logger.info('🧹 [CategoryIntegration] Cache limpo')
  }
}