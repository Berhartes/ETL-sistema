/**
 * 🏆 SERVIÇO UNIFICADO DE RANKINGS
 * 
 * Centraliza toda a lógica de rankings para ser usada por:
 * - Página de Premiações (PremiacoesPageModular)
 * - Páginas de Categorias (CategoriasFornecedores)
 * - Componentes de ranking (DeputadosCategoriaPage, etc.)
 * 
 * Versão: 3.0 - Unificada e Otimizada
 */

import { doc, getDoc, collection, getDocs, query, limit, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { firestoreService } from '@/services/firestore-service'
import { logAuditoriaCategoria, obterAnosFallback, normalizarCategoriaDisplay } from '@/lib/categoria-utils'
import { buscarInfoDeputado } from '@/lib/mapeamento-deputados'
import { obterCategoriaNormalizada } from '@/lib/categoria-mapeamento-reverso'

// 📊 INTERFACES UNIFICADAS
export interface DeputadoRanking {
  id: string
  nome: string
  nomeCivil: string
  partido: string
  uf: string
  urlFoto?: string
  totalGastos: number
  totalValor: number // Alias para compatibilidade
  quantidadeTransacoes: number
  totalTransacoes: number // Alias para compatibilidade
  posicao: number
  categoria?: string
  // Campos extras para compatibilidade com páginas existentes
  gastos?: any[]
  totalFornecedores?: number
}

export interface RankingUnificadoResponse {
  ranking: DeputadoRanking[]
  totalDeputados: number
  ultimaAtualizacao: Date
  periodo: string
  categoria?: string
  ano?: number
  fonte: 'firestore-pre-calculado' | 'firestore-transacoes' | 'cache' | 'fallback'
  _isFallback?: boolean
  _originalCount?: number
  _fallbackAno?: number
}

export interface EstatisticasRankingUnificado {
  totalGeral: number
  totalTransacoes: number
  mediaTransacao: number
  totalDeputados: number
  totalFornecedores: number
  totalCategorias: number
  anosDisponiveis: number[]
  estatisticasPorAno: Record<string, any>
  estatisticasPorCategoria: Record<string, any>
  top10Geral: DeputadoRanking[]
  top10PorCategoria: Record<string, DeputadoRanking[]>
  ultimaAtualizacao: Date
}

export class UnifiedRankingService {
  private cache = new Map<string, { data: any; timestamp: number }>()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutos

  /**
   * 🎯 MÉTODO PRINCIPAL - Buscar ranking com fallback inteligente
   */
  async buscarRanking(params: {
    categoria?: string
    ano?: number | string
    limite?: number
    ordem?: 'desc' | 'asc'
  }): Promise<RankingUnificadoResponse> {
    const { categoria = 'TODAS', ano, limite = 100, ordem = 'desc' } = params
    
    console.log('🏆 [UnifiedRankingService] Buscando ranking:', { categoria, ano, limite, ordem })

    try {
      // 1️⃣ TENTAR RANKING PRÉ-CALCULADO PRIMEIRO
      if (categoria !== 'TODAS') {
        const preCalculado = await this.buscarRankingPreCalculado(categoria, ano)
        if (preCalculado && preCalculado.ranking && preCalculado.ranking.length > 0) {
          console.log(`✅ [UnifiedRankingService] Ranking pré-calculado encontrado: ${preCalculado.ranking.length} deputados`)
          
          // 🔍 DEBUG: Verificar se os valores estão zerados
          const deputadosComValor = preCalculado.ranking.filter((d: any) => (d.totalGastos || d.totalValor || 0) > 0)
          console.log(`🔍 [UnifiedRankingService] Deputados com valores > 0: ${deputadosComValor.length}/${preCalculado.ranking.length}`)
          
          return this.processarRankingResponse(preCalculado, categoria, ano, 'firestore-pre-calculado')
        }
      }

      // 2️⃣ FALLBACK: BUSCAR POR TRANSAÇÕES PROCESSADAS
      console.log('🔄 [UnifiedRankingService] Tentando fallback por transações processadas...')
      const transacoes = await this.buscarRankingPorTransacoes(categoria, ano)
      if (transacoes && transacoes.ranking && transacoes.ranking.length > 0) {
        console.log(`✅ [UnifiedRankingService] Ranking por transações: ${transacoes.ranking.length} deputados`)
        return this.processarRankingResponse(transacoes, categoria, ano, 'firestore-transacoes')
      }

      // 3️⃣ FALLBACK TEMPORAL: TENTAR ANOS ANTERIORES
      if (categoria !== 'TODAS' && ano && ano !== 'todos') {
        const anosFallback = obterAnosFallback(ano.toString()).slice(1) // Remove o ano já tentado
        
        for (const anoFallback of anosFallback) {
          console.log(`🔄 [UnifiedRankingService] Tentando fallback para ano ${anoFallback}...`)
          const fallbackData = await this.buscarRankingPreCalculado(categoria, anoFallback)
          
          if (fallbackData && fallbackData.ranking && fallbackData.ranking.length > 0) {
            console.log(`✅ [UnifiedRankingService] Fallback encontrado em ${anoFallback}: ${fallbackData.ranking.length} deputados`)
            const response = this.processarRankingResponse(fallbackData, categoria, ano, 'fallback')
            response._isFallback = true
            response._fallbackAno = anoFallback
            return response
          }
        }
      }

      // 4️⃣ ÚLTIMO RECURSO: RANKING GERAL
      console.log('🔄 [UnifiedRankingService] Último recurso: ranking geral...')
      const rankingGeral = await this.buscarRankingGeral(ano)
      
      if (rankingGeral && rankingGeral.ranking) {
        return this.processarRankingResponse(rankingGeral, 'TODAS', ano, 'fallback')
      }

      // 5️⃣ SEM DADOS: Retornar null quando não há dados reais
      console.log('⚠️ [UnifiedRankingService] Nenhum dado encontrado')
      return this.criarRankingVazio(categoria, ano)

    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao buscar ranking:', error)
      return this.criarRankingVazio(categoria, ano)
    }
  }

  /**
   * 🎯 Buscar ranking pré-calculado do Firestore
   */
  private async buscarRankingPreCalculado(categoria: string, ano?: number | string): Promise<any> {
    try {
      console.log(`🔍 [UnifiedRankingService] buscarRankingPreCalculado chamado com:`, { categoria, ano })
      
      const cacheKey = `ranking-${categoria}-${ano || 'todos'}`
      const cached = this.cache.get(cacheKey)
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log('📦 [UnifiedRankingService] Usando cache para:', cacheKey)
        return cached.data
      }

      // Usar o serviço existente otimizado
      const rankingsOtimizadosService = await import('@/services/rankings-otimizados-service-v2')
      const service = new rankingsOtimizadosService.RankingsOtimizadosService()

      let rankingData
      if (categoria === 'TODAS') {
        console.log(`🎯 [UnifiedRankingService] Buscando ranking GERAL para ano: ${ano}`)
        if (ano && ano !== 'todos') {
          rankingData = await service.buscarRankingGeralPorAno(Number(ano))
        } else {
          rankingData = await service.buscarRankingGeralHistorico()
        }
      } else {
        console.log(`🎯 [UnifiedRankingService] Buscando ranking CATEGORIA "${categoria}" para ano: ${ano}`)
        
        // 🔄 MAPEAMENTO REVERSO: Converter categoria formatada para normalizada
        const categoriaNormalizada = obterCategoriaNormalizada(categoria)
        console.log(`🔄 [UnifiedRankingService] Categoria mapeada: "${categoria}" → "${categoriaNormalizada}"`)
        
        if (categoriaNormalizada === null) {
          console.log(`❌ [UnifiedRankingService] Categoria "${categoria}" mapeada para null - categoria sem dados conhecidos`)
          rankingData = null
        } else {
          if (ano && ano !== 'todos') {
            rankingData = await service.buscarRankingCategoriaPorAno(categoriaNormalizada, Number(ano))
          } else {
            rankingData = await service.buscarRankingCategoriaHistorico(categoriaNormalizada)
          }
        }
      }

      if (rankingData) {
        console.log(`✅ [UnifiedRankingService] Ranking encontrado: ${rankingData.ranking?.length || 0} deputados`)
        this.cache.set(cacheKey, { data: rankingData, timestamp: Date.now() })
      } else {
        console.log(`❌ [UnifiedRankingService] Nenhum ranking encontrado para categoria "${categoria}" ano "${ano}"`)
      }

      return rankingData
    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao buscar ranking pré-calculado:', error)
      return null
    }
  }

  /**
   * 🎯 Buscar ranking processando transações em tempo real
   */
  private async buscarRankingPorTransacoes(categoria?: string, ano?: number | string): Promise<any> {
    try {
      console.log('🔄 [UnifiedRankingService] Processando transações para ranking...', { categoria, ano })

      // Usar o firestoreService existente para buscar transações
      let transactions: any[] = []
      
      if (categoria && categoria !== 'TODAS') {
        // 🔄 MAPEAMENTO REVERSO: Converter categoria formatada para normalizada
        const categoriaNormalizada = obterCategoriaNormalizada(categoria)
        console.log(`🔄 [UnifiedRankingService] Transações - Categoria mapeada: "${categoria}" → "${categoriaNormalizada}"`)
        
        if (categoriaNormalizada === null) {
          console.log(`⚠️ [UnifiedRankingService] Categoria "${categoria}" não tem dados - pulando busca por transações`)
          transactions = []
        } else {
          transactions = await firestoreService.buscarTransacoesPorCategoria(
            categoriaNormalizada,
            ano && ano !== 'todos' ? Number(ano) : undefined
          )
        }
      } else {
        // Para categoria 'TODAS', precisamos buscar todas as transações
        // Por ora, retornar array vazio e deixar fallback funcionar
        console.log('⚠️ [UnifiedRankingService] Busca geral de transações não implementada ainda')
        transactions = []
      }

      console.log('📊 [UnifiedRankingService] Transações encontradas:', {
        total: transactions?.length || 0,
        primeiras3: transactions?.slice(0, 3)?.map(t => ({
          deputadoId: t.deputadoId,
          valor: t.valorLiquido || t.valorDocumento || t.valorReembolsado,
          categoria: t.tipoDespesa || t.categoria
        }))
      })

      if (!transactions || transactions.length === 0) {
        console.log('⚠️ [UnifiedRankingService] Nenhuma transação encontrada')
        return null
      }

      // Processar transações em ranking de deputados
      const deputadosMap = new Map<string, {
        id: string
        nome: string
        nomeCivil: string
        partido: string
        uf: string
        urlFoto?: string
        totalGastos: number
        quantidadeTransacoes: number
        gastos: any[]
      }>()

      for (const transacao of transactions) {
        const deputadoId = transacao.deputadoId || transacao.id
        const valor = parseFloat(transacao.valorLiquido || transacao.valorDocumento || transacao.valorReembolsado || 0)
        
        if (!deputadoId || valor <= 0) continue

        if (!deputadosMap.has(deputadoId)) {
          // Buscar informações do deputado
          const infoDeputado = await buscarInfoDeputado(deputadoId.toString())
          
          deputadosMap.set(deputadoId, {
            id: deputadoId.toString(),
            nome: infoDeputado?.nome || transacao.deputadoNome || transacao.nomeDeputado || 'Deputado Não Identificado',
            nomeCivil: transacao.deputadoNomeCivil || transacao.nomeCivilDeputado || '',
            partido: infoDeputado?.siglaPartido || transacao.deputadoPartido || transacao.siglaPartido || '',
            uf: infoDeputado?.siglaUf || transacao.deputadoUF || transacao.siglaUf || '',
            urlFoto: infoDeputado?.urlFoto,
            totalGastos: 0,
            quantidadeTransacoes: 0,
            gastos: []
          })
        }

        const deputado = deputadosMap.get(deputadoId)!
        deputado.totalGastos += valor
        deputado.quantidadeTransacoes += 1
        deputado.gastos.push(transacao)
      }

      // Converter para array e ordenar
      const ranking = Array.from(deputadosMap.values())
        .sort((a, b) => b.totalGastos - a.totalGastos)
        .map((deputado, index) => ({
          ...deputado,
          posicao: index + 1,
          categoria: categoria !== 'TODAS' ? categoria : undefined
        }))

      console.log(`✅ [UnifiedRankingService] Ranking processado: ${ranking.length} deputados`)

      return {
        ranking,
        totalDeputados: ranking.length,
        ultimaAtualizacao: new Date(),
        periodo: ano && ano !== 'todos' ? ano.toString() : 'historico'
      }

    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao processar transações:', error)
      return null
    }
  }

  /**
   * 🎯 Buscar ranking geral como fallback
   */
  private async buscarRankingGeral(ano?: number | string): Promise<any> {
    try {
      const rankingsOtimizadosService = await import('@/services/rankings-otimizados-service-v2')
      const service = new rankingsOtimizadosService.RankingsOtimizadosService()

      if (ano && ano !== 'todos') {
        return await service.buscarRankingGeralPorAno(Number(ano))
      } else {
        return await service.buscarRankingGeralHistorico()
      }
    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao buscar ranking geral:', error)
      return this.criarRankingVazio('TODAS', ano)
    }
  }

  /**
   * 🎯 Processar resposta do ranking para formato unificado
   */
  private processarRankingResponse(
    data: any, 
    categoria: string, 
    ano?: number | string, 
    fonte: RankingUnificadoResponse['fonte'] = 'firestore-pre-calculado'
  ): RankingUnificadoResponse {
    if (!data || !data.ranking) {
      return this.criarRankingVazio(categoria, ano)
    }

    // Normalizar dados para formato unificado
    const ranking: DeputadoRanking[] = data.ranking.map((deputado: any, index: number) => {
      // 🔍 DEBUG: Log detalhado para investigar valores zerados
      if (index < 3) {
        console.log(`🔍 [UnifiedRankingService] Processando deputado ${index + 1}:`, {
          nome: deputado.nome || deputado.deputadoNome,
          totalGastos: deputado.totalGastos,
          totalValor: deputado.totalValor,
          todasPropriedades: Object.keys(deputado),
          objetoCompleto: deputado
        })
      }

      return {
        id: deputado.id || deputado.deputadoId || '',
        nome: deputado.nome || deputado.deputadoNome || 'Deputado Não Identificado',
        nomeCivil: deputado.nomeCivil || deputado.deputadoNomeCivil || '',
        partido: deputado.metadados?.partido || deputado.partido || deputado.deputadoPartido || '',
        uf: deputado.metadados?.uf || deputado.uf || deputado.deputadoUF || '',
        urlFoto: deputado.metadados?.urlFoto || deputado.urlFoto,
        totalGastos: deputado.valor || deputado.totalGastos || deputado.totalValor || 0,
        totalValor: deputado.valor || deputado.totalGastos || deputado.totalValor || 0, // Alias
        quantidadeTransacoes: deputado.metadados?.numeroTransacoes || deputado.quantidadeTransacoes || deputado.totalTransacoes || 0,
        totalTransacoes: deputado.metadados?.numeroTransacoes || deputado.quantidadeTransacoes || deputado.totalTransacoes || 0, // Alias
        posicao: deputado.posicao || index + 1,
        categoria: categoria !== 'TODAS' ? categoria : undefined,
        gastos: deputado.gastos || [],
        totalFornecedores: deputado.totalFornecedores || 0
      }
    })

    // Log de auditoria
    const totalRanking = ranking.reduce((acc, dep) => acc + dep.totalGastos, 0)
    logAuditoriaCategoria('RANKING', categoria, {
      total: totalRanking,
      deputados: ranking.length,
      periodo: ano && ano !== 'todos' ? ano.toString() : 'historico'
    })

    return {
      ranking,
      totalDeputados: ranking.length,
      ultimaAtualizacao: data.ultimaAtualizacao ? 
        (data.ultimaAtualizacao.toDate ? data.ultimaAtualizacao.toDate() : new Date(data.ultimaAtualizacao)) : 
        new Date(),
      periodo: data.periodo || (ano && ano !== 'todos' ? ano.toString() : 'historico'),
      categoria: categoria !== 'TODAS' ? categoria : undefined,
      ano: ano && ano !== 'todos' ? Number(ano) : undefined,
      fonte
    }
  }

  /**
   * 🎯 Criar ranking vazio para casos sem dados
   */
  private criarRankingVazio(categoria: string, ano?: number | string): RankingUnificadoResponse {
    return {
      ranking: [],
      totalDeputados: 0,
      ultimaAtualizacao: new Date(),
      periodo: ano && ano !== 'todos' ? ano.toString() : 'historico',
      categoria: categoria !== 'TODAS' ? categoria : undefined,
      ano: ano && ano !== 'todos' ? Number(ano) : undefined,
      fonte: 'fallback' as const
    }
  }

  /**
   * 🎯 Buscar estatísticas globais unificadas
   */
  async buscarEstatisticasGlobais(): Promise<EstatisticasRankingUnificado | null> {
    try {
      const rankingsOtimizadosService = await import('@/services/rankings-otimizados-service-v2')
      const service = new rankingsOtimizadosService.RankingsOtimizadosService()
      
      // Buscar categorias disponíveis
      const categorias = await service.listarCategoriasDisponiveis()
      
      // Buscar anos disponíveis dinamicamente
      const anosDisponiveis = await this.buscarAnosDisponiveis()
      
      // 🔢 Buscar número real de deputados processados
      console.log('🔄 [UnifiedRankingService] Iniciando busca de deputados reais...')
      const { firestoreService } = await import('@/services/firestore-service')
      const totalDeputadosReais = await firestoreService.contarDeputadosReais()
      
      console.log(`📊 [UnifiedRankingService] Resultado da contagem: ${totalDeputadosReais}`)
      console.log(`🎯 [UnifiedRankingService] Valor final que será usado: ${totalDeputadosReais || 513}`)
      
      // 📊 Buscar estatísticas reais de transações e valores
      console.log('📊 [UnifiedRankingService] Calculando estatísticas reais...')
      const estatisticasReais = await this.calcularEstatisticasReais()
      
      // Criar estatísticas básicas baseadas nas categorias encontradas
      const estatisticasPorCategoria: Record<string, any> = {}
      categorias.forEach(categoria => {
        estatisticasPorCategoria[categoria] = {
          totalGastos: 0, // Será calculado quando necessário
          totalTransacoes: 0,
          deputadosParticipantes: 0,
          fornecedoresUnicos: 0
        }
      })
      
      return {
        totalGeral: estatisticasReais.totalGeral,
        totalTransacoes: estatisticasReais.totalTransacoes,
        mediaTransacao: estatisticasReais.mediaTransacao,
        totalDeputados: totalDeputadosReais || 513, // Usar número real ou fallback oficial
        totalFornecedores: estatisticasReais.totalFornecedores,
        totalCategorias: categorias.length,
        anosDisponiveis,
        estatisticasPorAno: {},
        estatisticasPorCategoria,
        top10Geral: [],
        top10PorCategoria: {},
        ultimaAtualizacao: new Date()
      }
      
    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao buscar estatísticas globais:', error)
      return null
    }
  }

  private converterEstatisticas(estatisticas: any): EstatisticasRankingUnificado {
    return {
      totalGeral: estatisticas.volumeTotal || 0,
      totalTransacoes: estatisticas.transacoesTotais || 0,
      mediaTransacao: estatisticas.volumeMedio || 0,
      totalDeputados: estatisticas.totalDeputados || 0,
      totalFornecedores: estatisticas.totalFornecedores || 0,
      totalCategorias: estatisticas.totalCategorias || 0,
      anosDisponiveis: estatisticas.anosDisponiveis || [],
      estatisticasPorAno: estatisticas.estatisticasPorAno || {},
      estatisticasPorCategoria: estatisticas.estatisticasPorCategoria || {},
      top10Geral: estatisticas.top10Geral?.map((dep: any) => ({
        id: dep.id,
        nome: dep.nome,
        totalValor: dep.valor || dep.totalGastos || 0,
        totalTransacoes: dep.numeroTransacoes || 0,
        ranking: dep.posicao || 0
      })) || [],
      top10PorCategoria: {}, // Required missing property
      ultimaAtualizacao: new Date() // Required missing property
    }
  }

  /**
   * 📊 Calcular estatísticas reais dos rankings
   */
  private async calcularEstatisticasReais(): Promise<{
    totalGeral: number;
    totalTransacoes: number;
    mediaTransacao: number;
    totalFornecedores: number;
  }> {
    try {
      console.log('📊 [UnifiedRankingService] Iniciando cálculo de estatísticas reais...')
      
      // Buscar ranking geral histórico para calcular estatísticas
      const rankingGeral = await getDoc(doc(db, 'rankings', 'deputados_geral_historico'))
      
      if (!rankingGeral.exists()) {
        console.warn('⚠️ [UnifiedRankingService] Ranking geral não encontrado, usando valores padrão')
        return {
          totalGeral: 0,
          totalTransacoes: 0,
          mediaTransacao: 0,
          totalFornecedores: 0
        }
      }
      
      const data = rankingGeral.data()
      const ranking = data.ranking || []
      
      console.log(`📊 [UnifiedRankingService] Processando ${ranking.length} deputados do ranking`)
      
      let totalGeral = 0
      let totalTransacoes = 0
      let totalFornecedores = 0
      
      // Somar valores de todos os deputados
      ranking.forEach((deputado: any) => {
        const valor = deputado.valor || deputado.totalGastos || 0
        const transacoes = deputado.quantidadeTransacoes || deputado.totalTransacoes || 0
        const fornecedores = deputado.totalFornecedores || 0
        
        totalGeral += valor
        totalTransacoes += transacoes
        totalFornecedores += fornecedores
      })
      
      const mediaTransacao = totalTransacoes > 0 ? totalGeral / totalTransacoes : 0
      
      console.log(`✅ [UnifiedRankingService] Estatísticas calculadas:`, {
        totalGeral: `R$ ${(totalGeral / 1000000).toFixed(1)}M`,
        totalTransacoes: totalTransacoes.toLocaleString(),
        mediaTransacao: `R$ ${mediaTransacao.toFixed(2)}`,
        totalFornecedores
      })
      
      return {
        totalGeral,
        totalTransacoes,
        mediaTransacao,
        totalFornecedores
      }
      
    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao calcular estatísticas reais:', error)
      return {
        totalGeral: 0,
        totalTransacoes: 0,
        mediaTransacao: 0,
        totalFornecedores: 0
      }
    }
  }

  /**
   * 🎯 Limpar cache
   */
  limparCache(): void {
    this.cache.clear()
    console.log('🗑️ [UnifiedRankingService] Cache limpo')
  }

  /**
   * 🎯 Buscar categorias disponíveis
   */
  async buscarCategoriasDisponiveis(): Promise<string[]> {
    try {
      const rankingsOtimizadosService = await import('@/services/rankings-otimizados-service-v2')
      const service = new rankingsOtimizadosService.RankingsOtimizadosService()
      return await service.listarCategoriasDisponiveis()
    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao buscar categorias:', error)
      return []
    }
  }

  /**
   * 🎯 Buscar anos disponíveis dinamicamente
   */
  async buscarAnosDisponiveis(): Promise<number[]> {
    try {
      console.log('🔍 [UnifiedRankingService] Extraindo anos dos documentos de ranking...')
      
      const { collection, getDocs } = await import('firebase/firestore')
      const rankingsRef = collection(db, 'rankings')
      const rankingsSnapshot = await getDocs(rankingsRef)
      
      const anos = new Set<number>()
      
      rankingsSnapshot.forEach((doc) => {
        const id = doc.id
        // Procurar documentos que começam com 'deputados_geral_' seguido de um ano
        const match = id.match(/^deputados_geral_(\d{4})$/)
        if (match) {
          const ano = parseInt(match[1])
          if (ano >= 2020 && ano <= new Date().getFullYear() + 1) { // Validar anos razoáveis
            anos.add(ano)
          }
        }
      })
      
      const listaAnos = Array.from(anos).sort((a, b) => b - a) // Ordenar decrescente (mais recente primeiro)
      console.log(`📊 [UnifiedRankingService] ${listaAnos.length} anos encontrados:`, listaAnos)
      
      return listaAnos
      
    } catch (error) {
      console.error('❌ [UnifiedRankingService] Erro ao buscar anos disponíveis:', error)
      // Fallback para anos conhecidos
      return [2025, 2024, 2023]
    }
  }
}

// 🎯 EXPORT DEFAULT - Instância singleton
export const unifiedRankingService = new UnifiedRankingService()
export default unifiedRankingService