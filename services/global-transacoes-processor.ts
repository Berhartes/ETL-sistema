/**
 * Serviço de Processamento Global de Transações
 * 
 * Similar ao global-fornecedores-processor, mas focado em:
 * - Processamento e cache de transações globais
 * - Análise de padrões temporais
 * - Otimização de consultas Firestore
 * - Sincronização de dados entre estruturas antigas e novas
 */

import { firestoreService } from '@/services/firestore-service'
import { TransacaoGlobal } from '@/components/fornecedores/TransacoesGlobais'
import { transacoesGlobalCache } from '@/services/transacoes-global-cache'

export type ProcessingStatusTransacoes = 'idle' | 'processing' | 'completed' | 'error' | 'cancelled'

export interface ProcessingOptionsTransacoes {
  ano?: number | 'todos'
  mes?: number | string | 'todos' 
  forceRefresh?: boolean
  incluirEstatisticas?: boolean
  limite?: number
}

export interface ProcessedTransacoesData {
  transacoes: TransacaoGlobal[]
  estatisticas: {
    totalTransacoes: number
    valorTotal: number
    fornecedoresUnicos: number
    deputadosUnicos: number
    anosDisponiveis: number[]
    categorias: string[]
    periodoProcessado: {
      ano: number | 'todos'
      mes: number | string | 'todos'
      dataInicio?: string
      dataFim?: string
    }
  }
  metadata: {
    processedAt: string
    tempoProcessamento: number
    versao: string
    filtrosAplicados: ProcessingOptionsTransacoes
  }
}

class GlobalTransacoesProcessor {
  private status: ProcessingStatusTransacoes = 'idle'
  private currentData: ProcessedTransacoesData | null = null
  private abortController: AbortController | null = null
  private progressCallback?: (progress: number, message: string) => void

  /**
   * Define callback para acompanhar progresso
   */
  setProgressCallback(callback: (progress: number, message: string) => void) {
    this.progressCallback = callback
  }

  /**
   * Obtém status atual do processamento
   */
  getStatus(): ProcessingStatusTransacoes {
    return this.status
  }

  /**
   * Obtém dados processados (cache) com fallback inteligente
   */
  getProcessedData(): ProcessedTransacoesData | null {
    // Prioridade 1: Cache em memória atual
    if (this.currentData) {
      return this.currentData
    }

    // Prioridade 2: Cache persistente válido
    const validCache = transacoesGlobalCache.getCache()
    if (validCache) {
      console.log('⚡ [GlobalTransacoesProcessor] Recuperando dados do cache persistente válido')
      this.currentData = validCache // Sincronizar com memória
      return validCache
    }

    // Prioridade 3: Cache aceitável
    const acceptableCache = transacoesGlobalCache.getAcceptableCache()
    if (acceptableCache) {
      console.log('📦 [GlobalTransacoesProcessor] Recuperando dados do cache aceitável')
      this.currentData = acceptableCache // Sincronizar com memória
      return acceptableCache
    }

    // Prioridade 4: Cache stale como último recurso
    const staleCache = transacoesGlobalCache.getStaleCache()
    if (staleCache) {
      console.log('🔄 [GlobalTransacoesProcessor] Recuperando dados do cache stale (último recurso)')
      this.currentData = staleCache // Sincronizar com memória
      return staleCache
    }

    console.log('📭 [GlobalTransacoesProcessor] Nenhum cache disponível')
    return null
  }

  /**
   * Verifica se há cache válido usando o novo sistema persistente
   */
  hasValidCache(options: ProcessingOptionsTransacoes = {}): boolean {
    console.log('🔍 [GlobalTransacoesProcessor] Verificando cache válido com novo sistema persistente...')
    
    // Primeiro verificar cache persistente
    const hasValidPersistentCache = transacoesGlobalCache.hasValidCache()
    if (hasValidPersistentCache) {
      const cacheData = transacoesGlobalCache.getCache()
      if (cacheData && this.isCompatibleWithOptions(cacheData, options)) {
        console.log('✅ [GlobalTransacoesProcessor] Cache persistente válido e compatível')
        return true
      }
    }

    // Fallback para cache em memória (compatibilidade)
    if (!this.currentData) return false

    const metadata = this.currentData.metadata
    const filtrosCache = metadata.filtrosAplicados
    
    // Verificar compatibilidade de filtros
    if (!this.isCompatibleWithOptions(this.currentData, options)) return false
    
    // Cache em memória válido há menos de 24 horas (alinhado com o persistente)
    const ageDiff = Date.now() - new Date(metadata.processedAt).getTime()
    const isRecent = ageDiff < 24 * 60 * 60 * 1000 // 24 horas
    
    console.log(`📊 [GlobalTransacoesProcessor] Cache em memória ${isRecent ? 'válido' : 'expirado'} (${Math.round(ageDiff / (1000 * 60 * 60))}h)`)
    return isRecent
  }

  /**
   * Verifica se há cache aceitável (≤7 dias)
   */
  hasAcceptableCache(options: ProcessingOptionsTransacoes = {}): boolean {
    console.log('🔍 [GlobalTransacoesProcessor] Verificando cache aceitável...')
    
    const hasAcceptablePersistentCache = transacoesGlobalCache.hasAcceptableCache()
    if (hasAcceptablePersistentCache) {
      const cacheData = transacoesGlobalCache.getAcceptableCache()
      if (cacheData && this.isCompatibleWithOptions(cacheData, options)) {
        console.log('⚡ [GlobalTransacoesProcessor] Cache aceitável encontrado e compatível')
        return true
      }
    }
    
    return false
  }

  /**
   * Verifica compatibilidade dos filtros entre cache e opções solicitadas
   */
  private isCompatibleWithOptions(cacheData: ProcessedTransacoesData, options: ProcessingOptionsTransacoes): boolean {
    const filtrosCache = cacheData.metadata.filtrosAplicados
    
    // Se não há opções específicas, qualquer cache é válido
    if (!options.ano && !options.mes) return true
    
    // Verificar compatibilidade de ano
    if (options.ano && filtrosCache.ano !== options.ano) {
      console.log(`🔍 [GlobalTransacoesProcessor] Incompatibilidade de ano: cache=${filtrosCache.ano}, solicitado=${options.ano}`)
      return false
    }
    
    // Verificar compatibilidade de mês
    if (options.mes && filtrosCache.mes !== options.mes) {
      console.log(`🔍 [GlobalTransacoesProcessor] Incompatibilidade de mês: cache=${filtrosCache.mes}, solicitado=${options.mes}`)
      return false
    }
    
    console.log('✅ [GlobalTransacoesProcessor] Filtros compatíveis')
    return true
  }

  /**
   * Processa transações com opções específicas
   */
  async processTransacoes(options: ProcessingOptionsTransacoes = {}): Promise<ProcessedTransacoesData> {
    if (this.status === 'processing') {
      throw new Error('Processamento já em andamento')
    }

    this.status = 'processing'
    this.abortController = new AbortController()
    const startTime = Date.now()

    try {
      // Determinar escopo do processamento para logs claros
      const escopoProcessamento = this.determinarEscopoProcessamento(options)
      
      this.updateProgress(0, `Iniciando processamento de transações (${escopoProcessamento})...`)

      // Configurar filtros para busca no Firestore
      const filtros: any = {
        limite: options.limite || 10000
      }

      if (options.ano !== 'todos' && options.ano) {
        filtros.ano = options.ano
        console.log(`📅 [GlobalTransacoesProcessor] Aplicando filtro de ano: ${options.ano}`)
      } else {
        console.log(`📅 [GlobalTransacoesProcessor] Processando TODOS os anos disponíveis`)
      }

      if (options.mes !== 'todos' && options.mes) {
        filtros.mes = typeof options.mes === 'string' ? parseInt(options.mes) : options.mes
        console.log(`📅 [GlobalTransacoesProcessor] Aplicando filtro de mês: ${filtros.mes}`)
      } else {
        console.log(`📅 [GlobalTransacoesProcessor] Processando TODOS os meses`)
      }

      console.log(`🔧 [GlobalTransacoesProcessor] Filtros finais:`, filtros)
      this.updateProgress(10, `Buscando transações no Firestore (${escopoProcessamento})...`)

      // Buscar transações usando o serviço existente
      const transacoesRaw = await firestoreService.buscarTodasTransacoesFornecedores(filtros)
      
      console.log(`✅ [GlobalTransacoesProcessor] ${transacoesRaw.length} transações encontradas para escopo: ${escopoProcessamento}`)
      this.updateProgress(40, `Processando ${transacoesRaw.length} transações (${escopoProcessamento})...`)

      // Mapear para formato padronizado
      const transacoes: TransacaoGlobal[] = transacoesRaw.map((transacao: any, index: number) => {
        if (index % 1000 === 0) {
          this.updateProgress(40 + (index / transacoesRaw.length) * 40, `Mapeando transação ${index + 1}/${transacoesRaw.length}...`)
        }

        return {
          id: transacao.id || `tx-${index}`,
          dataDocumento: transacao.dataDocumento || transacao.data || '',
          nomeDeputado: transacao.nomeDeputado || transacao.deputadoNome || transacao.deputado || 'Não informado',
          idDeputado: transacao.idDeputado || transacao.deputadoId || '',
          nomeFornecedor: transacao.nomeFornecedor || transacao.fornecedor || 'Não informado',
          cnpjCpfFornecedor: transacao.cnpjCpfFornecedor || transacao.cnpj || '',
          valorLiquido: parseFloat(transacao.valorLiquido || transacao.valor || 0),
          tipoDespesa: transacao.tipoDespesa || transacao.categoria || 'Não informado',
          tipoDocumento: transacao.tipoDocumento || '',
          numDocumento: transacao.numDocumento || transacao.numeroDocumento || '',
          urlDocumento: transacao.urlDocumento || '',
          ano: parseInt(transacao.ano || (transacao.dataDocumento ? new Date(transacao.dataDocumento).getFullYear() : new Date().getFullYear())),
          mes: parseInt(transacao.mes || (transacao.dataDocumento ? new Date(transacao.dataDocumento).getMonth() + 1 : new Date().getMonth() + 1))
        }
      })

      this.updateProgress(80, 'Calculando estatísticas...')

      // Calcular estatísticas
      const valorTotal = transacoes.reduce((sum, t) => sum + t.valorLiquido, 0)
      const fornecedoresUnicos = new Set(transacoes.map(t => t.cnpjCpfFornecedor)).size
      const deputadosUnicos = new Set(transacoes.map(t => t.idDeputado)).size
      const anosDisponiveis = [...new Set(transacoes.map(t => t.ano))].sort((a, b) => b - a)
      const categorias = [...new Set(transacoes.map(t => t.tipoDespesa))].sort()

      this.updateProgress(90, 'Finalizando processamento...')

      const processedData: ProcessedTransacoesData = {
        transacoes,
        estatisticas: {
          totalTransacoes: transacoes.length,
          valorTotal,
          fornecedoresUnicos,
          deputadosUnicos,
          anosDisponiveis,
          categorias,
          periodoProcessado: {
            ano: options.ano || 'todos',
            mes: options.mes || 'todos'
          }
        },
        metadata: {
          processedAt: new Date().toISOString(),
          tempoProcessamento: Date.now() - startTime,
          versao: '1.0.0',
          filtrosAplicados: options
        }
      }

      // Salvar no cache persistente
      console.log('💾 [GlobalTransacoesProcessor] Salvando dados no cache persistente...')
      transacoesGlobalCache.setCache(processedData)
      
      this.currentData = processedData
      this.status = 'completed'
      
      console.log(`🎉 [GlobalTransacoesProcessor] Processamento concluído:`)
      console.log(`   • Escopo: ${escopoProcessamento}`)
      console.log(`   • Transações: ${transacoes.length}`)
      console.log(`   • Anos: ${anosDisponiveis.join(', ')}`)
      console.log(`   • Valor total: R$ ${valorTotal.toLocaleString('pt-BR')}`)
      console.log(`   • Tempo: ${processedData.metadata.tempoProcessamento}ms`)
      console.log(`   • Cache: Salvo em localStorage + memória`)
      
      this.updateProgress(100, `Concluído! ${transacoes.length} transações (${escopoProcessamento}) em ${Math.round(processedData.metadata.tempoProcessamento/1000)}s`)

      return processedData

    } catch (error) {
      this.status = 'error'
      console.error('❌ [GlobalTransacoesProcessor] Erro no processamento:', error)
      throw error
    } finally {
      this.abortController = null
    }
  }

  /**
   * Cancela processamento em andamento
   */
  cancelProcessing() {
    if (this.abortController) {
      this.abortController.abort()
      this.status = 'cancelled'
      this.updateProgress(0, 'Processamento cancelado pelo usuário')
    }
  }

  /**
   * Limpa cache de dados (memória + persistente)
   */
  clearCache() {
    console.log('🗑️ [GlobalTransacoesProcessor] Limpando todos os caches...')
    
    // Limpar cache persistente
    transacoesGlobalCache.clearCache()
    
    // Limpar cache em memória
    this.currentData = null
    this.status = 'idle'
    
    console.log('✅ [GlobalTransacoesProcessor] Cache limpo (memória + persistente)')
  }

  /**
   * Obtém estatísticas rápidas do cache (com fallback inteligente)
   */
  getQuickStats() {
    // Tentar obter estatísticas do cache persistente primeiro
    const statsFromCache = transacoesGlobalCache.getEstatisticasComFallback()
    if (statsFromCache) {
      console.log('⚡ [GlobalTransacoesProcessor] Estatísticas obtidas do cache persistente')
      return statsFromCache
    }

    // Fallback para dados em memória
    if (this.currentData) {
      console.log('📊 [GlobalTransacoesProcessor] Estatísticas obtidas da memória')
      return this.currentData.estatisticas
    }

    console.log('📭 [GlobalTransacoesProcessor] Nenhuma estatística disponível')
    return null
  }

  /**
   * Obtém informações sobre o cache atual
   */
  getCacheInfo() {
    return transacoesGlobalCache.getCacheInfo()
  }

  /**
   * Determina escopo do processamento para mensagens claras
   */
  private determinarEscopoProcessamento(options: ProcessingOptionsTransacoes): string {
    const isAnoTodos = !options.ano || options.ano === 'todos'
    const isMesTodos = !options.mes || options.mes === 'todos'
    
    if (isAnoTodos && isMesTodos) {
      return 'todos os anos e meses'
    } else if (isAnoTodos && !isMesTodos) {
      const mesNome = this.getNomeMes(options.mes)
      return `todos os anos, mês ${mesNome}`
    } else if (!isAnoTodos && isMesTodos) {
      return `ano ${options.ano}, todos os meses`
    } else {
      const mesNome = this.getNomeMes(options.mes)
      return `${options.ano}/${mesNome}`
    }
  }

  /**
   * Converte número do mês para nome
   */
  private getNomeMes(mes: number | string | undefined): string {
    if (!mes || mes === 'todos') return 'todos'
    const mesNum = typeof mes === 'string' ? parseInt(mes) : mes
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    return meses[mesNum - 1] || mesNum.toString()
  }

  /**
   * Atualiza progresso
   */
  private updateProgress(progress: number, message: string) {
    if (this.progressCallback) {
      this.progressCallback(progress, message)
    }
  }


  /**
   * Reprocessa dados existentes (útil para mudanças de filtros locais)
   */
  async reprocessWithFilters(localFilters: {
    busca?: string
    categoria?: string
    deputado?: string
  }): Promise<TransacaoGlobal[]> {
    if (!this.currentData) {
      throw new Error('Nenhum dado processado disponível para filtrar')
    }

    let transacoesFiltradas = this.currentData.transacoes

    // Aplicar filtros locais
    if (localFilters.busca?.trim()) {
      const termo = localFilters.busca.toLowerCase().trim()
      transacoesFiltradas = transacoesFiltradas.filter(t =>
        t.nomeFornecedor?.toLowerCase().includes(termo) ||
        t.nomeDeputado?.toLowerCase().includes(termo) ||
        t.cnpjCpfFornecedor?.includes(termo) ||
        t.tipoDespesa?.toLowerCase().includes(termo)
      )
    }

    if (localFilters.categoria && localFilters.categoria !== 'todas') {
      transacoesFiltradas = transacoesFiltradas.filter(t => t.tipoDespesa === localFilters.categoria)
    }

    if (localFilters.deputado && localFilters.deputado !== 'todos') {
      transacoesFiltradas = transacoesFiltradas.filter(t => t.idDeputado === localFilters.deputado)
    }

    return transacoesFiltradas
  }
}

// Instância singleton
export const globalTransacoesProcessor = new GlobalTransacoesProcessor()