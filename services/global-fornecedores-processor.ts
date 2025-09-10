/**
 * Serviço Global de Processamento de Fornecedores
 * 
 * Processa todas as fornecedoras do sistema de uma vez,
 * organizando-as por categorias para cache e exibição rápida.
 */

import { fornecedoresService, type FornecedorStats } from './fornecedores-service.js'
import { unifiedScoreService } from './unified-score-service.js'
import { normalizarCategoriaDisplay } from '@/lib/categoria-utils'

// Estados do processamento
export type ProcessingStatus = 'idle' | 'processing' | 'completed' | 'error'

// Estrutura dos dados processados
export interface ProcessedFornecedoresData {
  lastProcessed: string
  totalFornecedores: number
  processingTime: number
  categorias: Record<string, FornecedorStats[]>
  estatisticas: {
    totalVolume: number
    mediaScoeSuspeicao: number
    fornecedoresSuspeitos: number
    totalTransacoes: number
    categoriasMapeadas: number
    topCategorias: Array<{
      nome: string
      quantidade: number
      volume: number
    }>
  }
  metadata: {
    versao: string
    processedAt: string
    dataSource: 'firestore' | 'fallback'
    filtroTemporal?: {
      ano: number | 'todos'
      mes: string
    }
  }
}

// Callback para progresso
export type ProgressCallback = (progress: number, message: string) => void

// Opções para processamento com filtros temporais
export interface ProcessingOptions {
  ano?: number | 'todos'
  mes?: string | 'todos'
  forceRefresh?: boolean
  limite?: number
}

class GlobalFornecedoresProcessor {
  private currentStatus: ProcessingStatus = 'idle'
  private progressCallback: ProgressCallback | null = null
  private abortController: AbortController | null = null

  /**
   * Inicia o processamento global de todas as fornecedoras
   */
  async processarTodasFornecedoras(
    progressCallback?: ProgressCallback,
    options: ProcessingOptions = {}
  ): Promise<ProcessedFornecedoresData> {
    // Extrair opções com valores padrão
    const {
      ano = 'todos',
      mes = 'todos',
      forceRefresh = false,
      limite
    } = options
    console.log('🚀 [GlobalProcessor] ⭐ INICIANDO PROCESSAMENTO GLOBAL DE FORNECEDORAS ⭐')
    console.log('📋 [GlobalProcessor] Opções configuradas:', {
      ano, mes, forceRefresh, limite,
      isAnoTodos: ano === 'todos',
      isCurrentYear: ano === new Date().getFullYear()
    })
    
    this.currentStatus = 'processing'
    this.progressCallback = progressCallback || null
    this.abortController = new AbortController()
    
    const startTime = Date.now()
    
    try {
      this.updateProgress(2, 'Configurando processamento...')
      console.log('✅ [GlobalProcessor] Status definido como "processing"')
      
      this.updateProgress(5, 'Conectando ao banco de dados...')
      
      // 1. Buscar todas as fornecedoras com paginação
      this.updateProgress(8, `Iniciando busca de fornecedoras (${ano}/${mes})...`)
      this.updateProgress(12, 'Carregando dados do Firestore...')
      console.log('🔍 [GlobalProcessor] Iniciando busca paginada de fornecedoras...')

      let todasFornecedoras: FornecedorStats[] = []
      let hasMore = true
      let offset = 0

      while (hasMore) {
        const serviceOptions = {
          ano,
          mes,
          offset,
          apenasComScore: false,
          scoreMinimo: 0,
        }

        console.log('⚙️ [GlobalProcessor] Buscando lote de fornecedoras com offset:', offset)
        const response = await fornecedoresService.buscarFornecedoresUnificado(serviceOptions)
        
        if (response && response.fornecedores.length > 0) {
          todasFornecedoras.push(...response.fornecedores)
          hasMore = response.hasMore
          offset += response.fornecedores.length
          // Progresso mais granular na busca (12% a 35%)
          const progressoBusca = 12 + (todasFornecedoras.length / 30000) * 23
          this.updateProgress(
            Math.min(35, progressoBusca), 
            `Carregando dados... ${todasFornecedoras.length.toLocaleString()} fornecedores encontrados`
          )
        } else {
          hasMore = false
        }
      }
      
            console.log(`[GlobalProcessor] ✅ Busca paginada concluída. Total de ${todasFornecedoras.length} fornecedoras encontradas.`)
      this.updateProgress(38, `✅ Dados carregados: ${todasFornecedoras.length.toLocaleString()} fornecedores`)

      if (todasFornecedoras.length === 0) {
        console.error('❌ [GlobalProcessor] ERRO CRÍTICO: Nenhuma fornecedora retornada pelo serviço após busca paginada')
        throw new Error('Nenhuma fornecedora encontrada no banco de dados')
      }

      console.log('✅ [GlobalProcessor] Fornecedoras obtidas com sucesso. Iniciando enriquecimento...')

      // 2. Enriquecer dados com scores se necessário
      this.updateProgress(42, 'Iniciando cálculo de scores...')
      this.updateProgress(45, 'Calculando scores de suspeição...')
      const fornecedoresEnriquecidas = await this.enriquecerFornecedores(todasFornecedoras)
      
      // 3. Organizar por categorias
      this.updateProgress(62, 'Agrupando por categorias...')
      this.updateProgress(68, 'Organizando dados por categoria...')
      const categorias = this.organizarPorCategorias(fornecedoresEnriquecidas)
      
      // 4. Calcular estatísticas globais
      this.updateProgress(75, 'Processando estatísticas...')
      this.updateProgress(82, 'Calculando estatísticas globais...')
      const estatisticas = this.calcularEstatisticasGlobais(fornecedoresEnriquecidas, categorias)
      
      // 5. Finalizar processamento
      this.updateProgress(88, 'Preparando dados finais...')
      this.updateProgress(95, 'Finalizando processamento...')
      
      const processedData: ProcessedFornecedoresData = {
        lastProcessed: new Date().toISOString(),
        totalFornecedores: fornecedoresEnriquecidas.length,
        processingTime: Date.now() - startTime,
        categorias,
        estatisticas,
        metadata: {
          versao: '1.1.0', // Atualizar versão para incluir suporte temporal
          processedAt: new Date().toISOString(),
          dataSource: 'firestore',
          filtroTemporal: {
            ano: ano === 'todos' ? 'todos' : ano,
            mes: mes
          }
        }
      }
      
      // 🎉 MENSAGEM FINAL DE SUCESSO ROBUSTA
      const totalProcessados = fornecedoresEnriquecidas.length
      const totalCategorias = Object.keys(categorias).length
      const tempoProcessamento = ((Date.now() - startTime) / 1000).toFixed(1)
      
      this.updateProgress(100, 
        `🎉 Concluído! ${totalProcessados.toLocaleString()} fornecedores organizados em ${totalCategorias} categorias (${tempoProcessamento}s)`
      )
      
      this.currentStatus = 'completed'
      
      console.log(`✅ [GlobalProcessor] Processamento concluído em ${processedData.processingTime}ms`, {
        total: processedData.totalFornecedores,
        categorias: Object.keys(categorias).length,
        estatisticas: processedData.estatisticas
      })
      
      return processedData
      
    } catch (error) {
      console.error('❌ [GlobalProcessor] ⚠️ ERRO CRÍTICO DURANTE PROCESSAMENTO ⚠️')
      console.error('🔍 [GlobalProcessor] Detalhes do erro:', {
        errorType: error?.constructor?.name,
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        errorStack: error instanceof Error ? error.stack : 'Stack não disponível',
        currentStatus: this.currentStatus,
        processTime: Date.now() - startTime
      })
      
      // Tentar identificar onde falhou baseado na mensagem
      if (error instanceof Error) {
        if (error.message.includes('Nenhuma fornecedora encontrada')) {
          console.error('💥 [GlobalProcessor] FALHA: Serviço não retornou fornecedores')
          console.error('🔧 [GlobalProcessor] POSSÍVEIS CAUSAS: Conexão Firestore, dados ausentes, filtros muito restritivos')
        } else if (error.message.includes('buscarFornecedoresUnificado')) {
          console.error('💥 [GlobalProcessor] FALHA: Erro no serviço de fornecedores')
          console.error('🔧 [GlobalProcessor] POSSÍVEIS CAUSAS: Erro de conexão, método inexistente, parâmetros inválidos')
        } else if (error.message.includes('enriquecerFornecedores')) {
          console.error('💥 [GlobalProcessor] FALHA: Erro no enriquecimento de dados')
          console.error('🔧 [GlobalProcessor] POSSÍVEIS CAUSAS: Erro no cálculo de scores, dados corrompidos')
        } else {
          console.error('💥 [GlobalProcessor] FALHA: Erro não identificado')
          console.error('🔧 [GlobalProcessor] Erro geral no processamento')
        }
      }
      
      this.currentStatus = 'error'
      const errorMessage = `❌ Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      this.updateProgress(0, errorMessage)
      
      // Re-throw com mais contexto
      const enhancedError = new Error(`Processamento de fornecedores falhou: ${error instanceof Error ? error.message : 'Erro desconhecido'}`)
      enhancedError.cause = error
      throw enhancedError
    }
  }
  
  /**
   * Enriquece fornecedoras com scores adicionais
   */
  private async enriquecerFornecedores(fornecedores: FornecedorStats[]): Promise<FornecedorStats[]> {
    const batchSize = 50
    const enriched: FornecedorStats[] = []
    
    for (let i = 0; i < fornecedores.length; i += batchSize) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Processamento cancelado pelo usuário')
      }
      
      const batch = fornecedores.slice(i, i + batchSize)
      const batchProgress = Math.round((i / fornecedores.length) * 15) + 45 // 45-60%
      
      const percentage = ((i + batch.length) / fornecedores.length * 100).toFixed(1)
      this.updateProgress(
        batchProgress, 
        `Processando fornecedores... ${(i + batch.length).toLocaleString()}/${fornecedores.length.toLocaleString()} (${percentage}%)`
      )
      
      // Processar batch
      for (const fornecedor of batch) {
        try {
          // Garantir que temos score de suspeição
          if (fornecedor.scoreSuspeicao === undefined || fornecedor.scoreSuspeicao === 0) {
            const scoreData = await unifiedScoreService.calcularScoreFornecedor({
              cnpj: fornecedor.cnpj,
              nome: fornecedor.nome,
              totalRecebido: fornecedor.totalTransacionado || 0, // Required property
              deputadosAtendidos: fornecedor.deputadosAtendidos?.length || 0,
              numTransacoes: fornecedor.transacoes || 0,
              alertas: [] // Required property
            })
            
            fornecedor.scoreSuspeicao = (scoreData as any).scoreGeral || 0
            fornecedor.categoriaRisco = this.categorizarRisco((scoreData as any).scoreGeral || 0)
          }
          
          enriched.push(fornecedor)
        } catch (error) {
          console.warn(`⚠️ Erro ao enriquecer fornecedor ${fornecedor.nome}:`, error)
          // Manter fornecedor original mesmo com erro
          enriched.push(fornecedor)
        }
      }
      
      // Pequena pausa para não sobrecarregar
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    return enriched
  }
  
  /**
   * Organiza fornecedoras por categorias
   */
  private organizarPorCategorias(fornecedores: FornecedorStats[]): Record<string, FornecedorStats[]> {
    console.log('📁 [GlobalProcessor] Organizando por categorias...')
    
    const categorias: Record<string, FornecedorStats[]> = {}
    const categoriasEncontradas = new Set<string>()
    
    fornecedores.forEach(fornecedor => {
      if (!fornecedor.categorias || fornecedor.categorias.length === 0) {
        // Categoria "SEM_CATEGORIA" para fornecedores sem categoria
        const categoria = 'SEM_CATEGORIA'
        categoriasEncontradas.add(categoria)
        
        if (!categorias[categoria]) {
          categorias[categoria] = []
        }
        categorias[categoria].push(fornecedor)
        return
      }
      
      // Adicionar fornecedor a cada uma de suas categorias
      fornecedor.categorias.forEach(categoria => {
        const categoriaNormalizada = this.normalizarCategoriaUnificada(categoria)
        categoriasEncontradas.add(categoriaNormalizada)
        
        if (!categorias[categoriaNormalizada]) {
          categorias[categoriaNormalizada] = []
        }
        
        // Evitar duplicatas na mesma categoria
        if (!categorias[categoriaNormalizada].find(f => f.cnpj === fornecedor.cnpj)) {
          categorias[categoriaNormalizada].push(fornecedor)
        }
      })
    })
    
    console.log(`📊 [GlobalProcessor] Organizadas ${categoriasEncontradas.size} categorias:`, 
      Array.from(categoriasEncontradas).sort()
    )
    
    return categorias
  }
  
  /**
   * Calcula estatísticas globais do sistema
   */
  private calcularEstatisticasGlobais(
    fornecedores: FornecedorStats[], 
    categorias: Record<string, FornecedorStats[]>
  ) {
    console.log('📈 [GlobalProcessor] Calculando estatísticas globais...')
    
    const totalVolume = fornecedores.reduce((sum, f) => sum + (f.totalTransacionado || 0), 0)
    const totalTransacoes = fornecedores.reduce((sum, f) => sum + (f.transacoes || 0), 0)
    const scoresValidos = fornecedores.filter(f => f.scoreSuspeicao > 0)
    const mediaScoeSuspeicao = scoresValidos.length > 0 
      ? scoresValidos.reduce((sum, f) => sum + f.scoreSuspeicao, 0) / scoresValidos.length 
      : 0
    
    const fornecedoresSuspeitos = fornecedores.filter(f => 
      this.categorizarRisco(f.scoreSuspeicao) !== 'BAIXO'
    ).length
    
    // Top categorias por volume
    const topCategorias = Object.entries(categorias)
      .map(([nome, fornecedoresDaCategoria]) => ({
        nome,
        quantidade: fornecedoresDaCategoria.length,
        volume: fornecedoresDaCategoria.reduce((sum, f) => sum + (f.totalTransacionado || 0), 0)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10)
    
    const estatisticas = {
      totalVolume,
      mediaScoeSuspeicao: Math.round(mediaScoeSuspeicao),
      fornecedoresSuspeitos,
      totalTransacoes,
      categoriasMapeadas: Object.keys(categorias).length,
      topCategorias
    }
    
    console.log('📊 [GlobalProcessor] Estatísticas calculadas:', estatisticas)
    
    return estatisticas
  }
  
  /**
   * Normaliza nome da categoria de forma unificada
   * Usa o sistema padronizado do categoria-utils para garantir consistência
   */
  private normalizarCategoriaUnificada(categoria: string): string {
    // Usar a função padronizada que preserva caracteres especiais para display
    const categoriaDisplay = normalizarCategoriaDisplay(categoria)
    
    // Aplicar normalização adicional para chave interna (sem afetar o display)
    return categoriaDisplay
      .toUpperCase()
      .trim()
      .replace(/[ÀÁÂÃÄÅ]/g, 'A')
      .replace(/[ÈÉÊË]/g, 'E')
      .replace(/[ÌÍÎÏ]/g, 'I')
      .replace(/[ÒÓÔÕÖ]/g, 'O')
      .replace(/[ÙÚÛÜ]/g, 'U')
      .replace(/[Ç]/g, 'C')
      // Manter espaços para melhor legibilidade
      .replace(/\s+/g, ' ')
      // Remover apenas caracteres realmente problemáticos
      .replace(/[^\w\sÀ-ÿ]/g, '')
      .trim()
  }

  /**
   * Normaliza nome da categoria (mantida para compatibilidade)
   * @deprecated Use normalizarCategoriaUnificada
   */
  private normalizarCategoria(categoria: string): string {
    return this.normalizarCategoriaUnificada(categoria)
  }
  
  /**
   * Categoriza risco baseado no score
   */
  private categorizarRisco(score: number): 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO' {
    if (score >= 90) return 'CRITICO'
    if (score >= 70) return 'ALTO'
    if (score >= 40) return 'MEDIO'
    return 'BAIXO'
  }
  
  /**
   * Atualiza progresso
   */
  private updateProgress(progress: number, message: string) {
    if (this.progressCallback) {
      this.progressCallback(Math.min(100, Math.max(0, progress)), message)
    }
  }
  
  /**
   * Cancela processamento em andamento
   */
  cancelarProcessamento() {
    if (this.abortController) {
      this.abortController.abort()
      this.currentStatus = 'idle'
      console.log('🛑 [GlobalProcessor] Processamento cancelado')
    }
  }
  
  /**
   * Retorna status atual
   */
  getStatus(): ProcessingStatus {
    return this.currentStatus
  }
}

// Exportar instância singleton
export const globalFornecedoresProcessor = new GlobalFornecedoresProcessor()