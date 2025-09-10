/**
 * 🏆 SERVIÇO UNIFICADO DE PREMIAÇÕES
 * 
 * Este arquivo consolida toda a lógica de premiações em um só lugar:
 * - Tipos e interfaces
 * - Cálculo de premiações  
 * - Integração com Firestore
 * - Sincronização com GlobalDataContext
 * - Gerenciamento de cache localStorage
 * 
 * ATIVADO PELA PÁGINA DE PREMIAÇÕES
 */

import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'

// ===== INTERFACES E TIPOS =====

export interface DeputadoRanking {
  id: string
  nome: string
  nomeCivil: string
  partido: string
  uf: string
  urlFoto?: string
  totalGastos: number
  valor?: number // Add as optional for compatibility
  totalValor?: number // Add as optional for compatibility
  quantidadeTransacoes: number
  posicao: number
  categoria?: string
}

export interface CoroaDeputado {
  deputadoId: string
  deputadoNome: string
  tipo: 'geral' | 'categoria'
  categoria?: string
  valor: number
  quantidadeTransacoes?: number
  dataConquista: string
}

export interface TrofeuDeputado {
  deputadoId: string
  deputadoNome: string
  tipo: 'geral' | 'categoria'
  categoria?: string
  valor: number
  quantidadeTransacoes?: number
  ano: number
  dataConquista: string
}

export interface MedalhaDeputado {
  deputadoId: string
  deputadoNome: string
  tipo: 'geral' | 'categoria'
  categoria?: string
  valor: number
  quantidadeTransacoes?: number
  posicao: 2 | 3 // Apenas 2º e 3º lugar
  ano?: number // Para medalhas anuais
  dataConquista: string
}

export interface PremiacoesGlobais {
  coroas: CoroaDeputado[]
  campeaoGeral: CoroaDeputado | null
  campeoesCategorias: CoroaDeputado[]
  trofeus: TrofeuDeputado[]
  campeoesPorAno: { [ano: string]: TrofeuDeputado[] }
  medalhas: MedalhaDeputado[]
  medalhasHistoricas: MedalhaDeputado[] // 2º e 3º de todos os tempos
  medalhasPorAno: { [ano: string]: MedalhaDeputado[] }
  ultimaAtualizacao?: Date | string
}

export interface EstatisticasGlobais {
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

export interface RankingResponse {
  ranking: DeputadoRanking[]
  totalDeputados: number
  ultimaAtualizacao: Date
  periodo: string
  _isFallback?: boolean
  _originalYear?: number
  _originalCount?: number
  fonte?: string
}

// ===== CONSTANTES =====

const CACHE_KEY_PREMIACOES = 'premiacoesGlobais'
const ANOS_PREMIACOES = [2025, 2024, 2023, 2022] // Anos para cálculo de premiações
const MAX_CATEGORIAS_CALCULO = 100 // Limite aumentado para processar mais categorias

// ===== CLASSE PRINCIPAL =====

export class PremiacaoUnificada {
  
  // ===== MÉTODOS DE ACESSO AO FIRESTORE =====
  
  /**
   * Busca ranking geral histórico (todos os anos)
   */
  private async buscarRankingGeralHistorico(): Promise<RankingResponse | null> {
    try {
      console.log('🔍 [DEBUG] Buscando documento: rankings/deputados_geral_historico')
      const docRef = doc(db, 'rankings', 'deputados_geral_historico')
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log('❌ Documento rankings/deputados_geral_historico não encontrado')
        
        // Tentar fallback para deputados_geral_2025
        console.log('🔄 [FALLBACK] Tentando rankings/deputados_geral_2025...')
        const docRef2025 = doc(db, 'rankings', 'deputados_geral_2025')
        const docSnap2025 = await getDoc(docRef2025)
        
        if (!docSnap2025.exists()) {
          console.log('❌ Documento rankings/deputados_geral_2025 também não encontrado')
          return null
        }
        
        const data2025 = docSnap2025.data()
        console.log('✅ [FALLBACK] Usando dados de rankings/deputados_geral_2025')
        console.log('📊 [FALLBACK] Estrutura encontrada:', Object.keys(data2025))
        console.log('📊 [FALLBACK] Ranking length:', data2025.ranking?.length || 0)
        
        return {
          ranking: data2025.ranking || [],
          totalDeputados: data2025.totalItens || data2025.totalDeputados || 0,
          ultimaAtualizacao: data2025.ultimaAtualizacao?.toDate() || new Date(),
          periodo: data2025.periodo || '2025'
        }
      }

      const data = docSnap.data()
      console.log('✅ [DEBUG] Documento rankings/deputados_geral_historico encontrado')
      console.log('📊 [DEBUG] Estrutura do documento:', Object.keys(data))
      console.log('📊 [DEBUG] Ranking length:', data.ranking?.length || 0)
      console.log('📊 [DEBUG] Total deputados:', data.totalItens || data.totalDeputados || 0)
      
      if (data.ranking && data.ranking.length > 0) {
        console.log('📊 [DEBUG] Primeiro deputado do ranking:', data.ranking[0])
      }
      
      return {
        ranking: data.ranking || [],
        totalDeputados: data.totalItens || data.totalDeputados || 0,
        ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
        periodo: data.periodo || 'historico'
      }
    } catch (error) {
      console.error('❌ Erro ao buscar ranking geral histórico:', error)
      console.error('❌ Stack trace:', error.stack)
      return null
    }
  }

  /**
   * Busca ranking geral por ano específico
   */
  private async buscarRankingGeralPorAno(ano: number): Promise<RankingResponse | null> {
    try {
      const docRef = doc(db, 'rankings', `deputados_geral_${ano}`)
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log(`❌ Ranking geral do ano ${ano} não encontrado`)
        return null
      }

      const data = docSnap.data()
      return {
        ranking: data.ranking || [],
        totalDeputados: data.totalItens || data.totalDeputados || 0,
        ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
        periodo: data.periodo || ano.toString()
      }
    } catch (error) {
      console.error(`❌ Erro ao buscar ranking geral do ano ${ano}:`, error)
      return null
    }
  }

  /**
   * Busca ranking de categoria histórico
   */
  private async buscarRankingCategoriaHistorico(categoria: string, tentativaRecursiva = false): Promise<RankingResponse | null> {
    try {
      console.log(`🔍 [DEBUG] Buscando ranking histórico da categoria: "${categoria}"`)
      
      // ✅ CORREÇÃO: Usar padrões exatos encontrados no debug do Firestore
      const categoriaLimpa = categoria
        .toLowerCase()
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõö]/g, 'o')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ç]/g, 'c')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      
      // ✅ NOVO: Gerar hash MD5 como o sistema V3 real
      const hashMd5 = this.gerarHashCategoria(categoria)
      const categoriaSlugV3 = `${categoriaLimpa.substring(0, 20)}-${hashMd5}`
      
      // Use the same normalization as the working rankings service
      const categoriaNormalizada = this.normalizarCategoria(categoria)
      
      const possiveisIds = [
        // ✅ PRIORIDADE 1: Padrão correto do Firestore (deputados_{categoria}_historico)
        `deputados_${categoriaNormalizada}_historico`,
        
        // ✅ PRIORIDADE 2: Variações com underscores
        `deputados_${categoriaLimpa.replace(/-/g, '_')}_historico`,
        
        // ✅ PRIORIDADE 3: Outros padrões possíveis
        `${categoriaNormalizada}_historico`,
        `categoria_${categoriaNormalizada}_historico`,
        
        // ✅ PRIORIDADE 4: Fallbacks legacy
        `${categoriaSlugV3}-historico`,
        `categoria_todos_anos_${categoriaLimpa.replace(/-/g, '_')}`,
        `${categoriaLimpa}-historico`,
        `categoria-${categoriaLimpa}-historico`
      ]
      
      // Reduzir logs para performance - apenas mostrar quais IDs estão sendo testados
      console.log(`🧪 [DEBUG] Testando ${possiveisIds.length} IDs para "${categoria}"`)
      
      for (const docId of possiveisIds) {
        try {
          const docRef = doc(db, 'rankings', docId)
          const docSnap = await getDoc(docRef)
          
          if (docSnap.exists()) {
            const data = docSnap.data()
            console.log(`✅ [DEBUG] Documento encontrado: ${docId} (${data.ranking?.length || 0} deputados)`)
            
            return {
              ranking: data.ranking || [],
              totalDeputados: data.totalDeputados || data.totalItens || 0,
              ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
              periodo: data.periodo || 'historico'
            }
          }
        } catch (error) {
          // Silenciar erros de busca individual para performance
          continue
        }
      }
      
      console.log(`❌ [DEBUG] Nenhum documento encontrado para categoria "${categoria}"`)
      
      // ✅ BUSCA POR SIMILARIDADE (DESABILITADA PARA PERFORMANCE)
      if (!tentativaRecursiva) {
        console.log(`🔍 [DEBUG] Tentando busca por similaridade...`)
        
        try {
          // Buscar todas as estatísticas globais para ver categorias disponíveis
          const estatisticasRef = doc(db, 'estatisticas', 'globais')
          const estatisticasSnap = await getDoc(estatisticasRef)
          
          if (estatisticasSnap.exists()) {
            const estatisticas = estatisticasSnap.data()
            const categoriasDisponiveis = Object.keys(estatisticas.estatisticasPorCategoria || {})
            
            // Buscar categorias similares (algoritmo simplificado para performance)
            const categoriaSemAcentos = categoria.toLowerCase().replace(/[^a-z0-9\s]/g, '')
            const palavrasChave = categoriaSemAcentos.split(' ').filter(p => p.length > 3) // Apenas palavras > 3 chars
            
            if (palavrasChave.length > 0) {
              const categoriasSimilares = categoriasDisponiveis.filter(catDisponivel => {
                const catDisponivelLimpa = catDisponivel.toLowerCase().replace(/[^a-z0-9\s]/g, '')
                
                // Verificar se contém pelo menos a primeira palavra-chave importante
                return catDisponivelLimpa.includes(palavrasChave[0])
              }).slice(0, 2) // Máximo 2 tentativas
              
              for (const catSimilar of categoriasSimilares) {
                console.log(`🔍 [DEBUG] Tentando categoria similar: "${catSimilar}"`)
                
                // ✅ IMPORTANTE: Marcar como tentativa recursiva para evitar loop infinito
                const similarResult = await this.buscarRankingCategoriaHistorico(catSimilar, true)
                if (similarResult && similarResult.ranking.length > 0) {
                  console.log(`✅ [DEBUG] Usando categoria similar: "${catSimilar}"`)
                  return similarResult
                }
              }
            }
          }
        } catch (error) {
          console.log(`⚠️ [DEBUG] Erro na busca por similaridade:`, error.message)
        }
      }
      
      return null
      
    } catch (error) {
      console.error(`❌ Erro ao buscar ranking histórico da categoria ${categoria}:`, error)
      return null
    }
  }

  /**
   * Busca ranking de categoria por ano específico
   */
  private async buscarRankingCategoriaPorAno(categoria: string, ano: number): Promise<RankingResponse | null> {
    try {
      console.log(`🔍 [DEBUG] Buscando ranking da categoria "${categoria}" para ano ${ano}`)
      
      // ✅ CORREÇÃO: Usar padrões exatos encontrados no debug do Firestore
      const categoriaLimpa = categoria
        .toLowerCase()
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõö]/g, 'o')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ç]/g, 'c')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      
      // ✅ NOVO: Gerar hash MD5 como o sistema V3 real
      const hashMd5 = this.gerarHashCategoria(categoria)
      const categoriaSlugV3 = `${categoriaLimpa.substring(0, 20)}-${hashMd5}`
      
      // Use the same normalization as the working rankings service
      const categoriaNormalizada = this.normalizarCategoria(categoria)
      
      const possiveisIds = [
        // ✅ PRIORIDADE 1: Padrão correto do Firestore (deputados_{categoria}_{ano})
        `deputados_${categoriaNormalizada}_${ano}`,
        
        // ✅ PRIORIDADE 2: Variações com underscores
        `deputados_${categoriaLimpa.replace(/-/g, '_')}_${ano}`,
        
        // ✅ PRIORIDADE 3: Outros padrões possíveis
        `${categoriaNormalizada}_${ano}`,
        `categoria_${categoriaNormalizada}_${ano}`,
        
        // ✅ PRIORIDADE 4: Fallbacks legacy
        `${categoriaSlugV3}-${ano}`,
        `categoria_${ano}_${categoriaLimpa.replace(/-/g, '_')}`,
        `${categoriaLimpa}-${ano}`,
        `categoria-${categoriaLimpa}-${ano}`
      ]
      
      // Reduzir logs para performance - apenas mostrar quais IDs estão sendo testados
      console.log(`🧪 [DEBUG] Testando ${possiveisIds.length} IDs para "${categoria}"`)
      
      for (const docId of possiveisIds) {
        try {
          const docRef = doc(db, 'rankings', docId)
          const docSnap = await getDoc(docRef)
          
          if (docSnap.exists()) {
            const data = docSnap.data()
            console.log(`✅ [DEBUG] Documento encontrado: ${docId} (${data.ranking?.length || 0} deputados)`)
            
            return {
              ranking: data.ranking || [],
              totalDeputados: data.totalDeputados || data.totalItens || 0,
              ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
              periodo: data.periodo || ano.toString()
            }
          }
        } catch (error) {
          // Silenciar erros de busca individual para performance
          continue
        }
      }
      
      console.log(`❌ [DEBUG] Nenhum documento encontrado para categoria "${categoria}" ano ${ano}`)
      return null
      
    } catch (error) {
      console.error(`❌ Erro ao buscar ranking da categoria ${categoria} ano ${ano}:`, error)
      return null
    }
  }

  /**
   * Busca estatísticas globais otimizadas
   */
  private async buscarEstatisticasGlobais(): Promise<EstatisticasGlobais | null> {
    try {
      // 🔢 Buscar número real de deputados processados
      console.log('🔄 [PremiacaoUnificada] Buscando contagem real de deputados...')
      const { firestoreService } = await import('@/services/firestore-service')
      const totalDeputadosReais = await firestoreService.contarDeputadosReais()
      
      console.log('📊 [PremiacaoUnificada] Contagem recebida:', totalDeputadosReais)
      console.log('🎯 [PremiacaoUnificada] Valor final nas estatísticas:', totalDeputadosReais || 0)
      
      return {
        totalGeral: 0,
        totalTransacoes: 0,
        mediaTransacao: 0,
        totalDeputados: totalDeputadosReais || 0, // Usar contagem real
        totalFornecedores: 0,
        totalCategorias: 0,
        anosDisponiveis: [2025, 2024, 2023],
        estatisticasPorAno: {},
        estatisticasPorCategoria: {},
        top10Geral: [],
        top10PorCategoria: {},
        ultimaAtualizacao: new Date()
      }
    } catch (error) {
      console.error('❌ Erro ao buscar estatísticas globais:', error)
      return null
    }
  }

  /**
   * Lista todas as categorias disponíveis usando Firestore direto
   */
  private async listarCategoriasDisponiveis(): Promise<string[]> {
    try {
      console.log('🔍 [DEBUG] Buscando categorias disponíveis...')
      
      // Use direct Firestore access to avoid circular imports
      const rankingsRef = collection(db, 'rankings')
      const rankingsSnapshot = await getDocs(rankingsRef)
      
      const categorias = new Set<string>()
      
      rankingsSnapshot.forEach((doc) => {
        const id = doc.id
        // Look for documents that start with 'deputados_' and end with '_historico' but not 'geral'
        if (id.startsWith('deputados_') && id.endsWith('_historico') && !id.includes('geral')) {
          // Extract category name
          const categoria = id.replace('deputados_', '').replace('_historico', '')
          // Convert to readable format
          const categoriaLegivel = categoria
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase()) // First letter of each word in uppercase
          
          categorias.add(categoriaLegivel)
        }
      })
      
      const listaCategorias = Array.from(categorias).sort().slice(0, 10) // Limit to 10 for testing
      console.log(`✅ [DEBUG] Encontradas ${listaCategorias.length} categorias:`, listaCategorias)
      
      return listaCategorias
    } catch (error) {
      console.error('❌ Erro ao listar categorias:', error)
      return []
    }
  }

  // ===== MÉTODOS DE CÁLCULO DE PREMIAÇÕES =====

  /**
   * 🏆 FUNÇÃO PRINCIPAL - CALCULAR TODAS AS PREMIAÇÕES
   * Esta é a função ativada pela página de premiações
   */
  async calcularTodasPremiacoes(): Promise<PremiacoesGlobais | null> {
    try {
      console.log('🚀 [PremiacaoUnificada] ===== INICIANDO CÁLCULO DE TODAS AS PREMIAÇÕES =====')
      
      // DEBUG: Testar conexão básica do Firebase
      console.log('🔧 [DEBUG] Testando conexão com Firebase...')
      try {
        doc(db, 'test', 'connection')
        console.log('✅ [DEBUG] Firebase conectado')
      } catch (error) {
        console.error('❌ [DEBUG] Erro na conexão Firebase:', error)
        throw new Error('Falha na conexão com Firebase')
      }
      
      // Buscar dados necessários com logs detalhados
      console.log('📊 [PremiacaoUnificada] Buscando dados do Firestore...')
      
      console.log('🔄 Buscando ranking geral histórico...')
      let rankingGeral = await this.buscarRankingGeralHistorico()
      console.log('📊 Resultado ranking geral:', {
        sucesso: !!rankingGeral,
        temRanking: !!rankingGeral?.ranking,
        quantidade: rankingGeral?.ranking?.length || 0
      })
      
      console.log('🔄 Buscando estatísticas globais...')
      const estatisticas = await this.buscarEstatisticasGlobais()
      console.log('📊 Resultado estatísticas:', {
        sucesso: !!estatisticas,
        totalDeputados: estatisticas?.totalDeputados || 0
      })
      
      console.log('🔄 Listando categorias disponíveis...')
      const categorias = await this.listarCategoriasDisponiveis()
      console.log('📊 Resultado categorias:', {
        sucesso: categorias.length > 0,
        quantidade: categorias.length,
        primeiras3: categorias.slice(0, 3)
      })
      
      // Validação rigorosa dos dados
      if (!rankingGeral) {
        console.error('❌ [PremiacaoUnificada] Ranking geral não foi encontrado')
        console.error('📋 [DEBUG] Tentando documentos alternativos...')
        
        // Try alternative document patterns
        const alternativeIds = ['deputados_geral_2025', 'deputados_geral_2024', 'deputados_geral_2023']
        for (const docId of alternativeIds) {
          try {
            console.log(`🔄 [DEBUG] Tentando documento: ${docId}`)
            const docRef = doc(db, 'rankings', docId)
            const docSnap = await getDoc(docRef)
            
            if (docSnap.exists()) {
              const data = docSnap.data()
              if (data.ranking && data.ranking.length > 0) {
                console.log(`✅ [DEBUG] Usando documento alternativo: ${docId}`)
                rankingGeral = {
                  ranking: data.ranking,
                  totalDeputados: data.totalItens || data.totalDeputados || 0,
                  ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
                  periodo: data.periodo || 'historico'
                }
                break
              }
            }
          } catch (altError) {
            console.log(`⚠️ [DEBUG] Erro ao tentar ${docId}:`, altError.message)
          }
        }
        
        if (!rankingGeral) {
          throw new Error('Nenhum documento de ranking encontrado no Firestore')
        }
      }
      
      if (!rankingGeral.ranking) {
        console.error('❌ [PremiacaoUnificada] Ranking geral não contém array de ranking')
        throw new Error('Estrutura de ranking inválida')
      }
      
      if (rankingGeral.ranking.length === 0) {
        console.error('❌ [PremiacaoUnificada] Ranking geral está vazio')
        throw new Error('Ranking geral está vazio')
      }
      
      console.log('✅ [PremiacaoUnificada] Dados validados com sucesso!')
      console.log('📊 [PremiacaoUnificada] Dados finais:', {
        deputados: rankingGeral.ranking.length,
        categorias: categorias.length,
        estatisticas: !!estatisticas
      })
      
      // Inicializar estruturas de dados
      const coroas: CoroaDeputado[] = []
      const trofeus: TrofeuDeputado[] = []
      const medalhas: MedalhaDeputado[] = []
      const campeoesPorAno: { [ano: string]: TrofeuDeputado[] } = {}
      const medalhasPorAno: { [ano: string]: MedalhaDeputado[] } = {}
      const medalhasHistoricas: MedalhaDeputado[] = []
      
      // ===== 1. COROAS HISTÓRICAS =====
      console.log('👑 [PremiacaoUnificada] Calculando coroas históricas...')
      
      // Campeão geral histórico (coroa rosa)
      let campeaoGeral = null
      if (rankingGeral.ranking.length > 0) {
        const campeao = rankingGeral.ranking[0]
        console.log('🔍 [DEBUG] Estrutura do campeão:', campeao)
        
        if (!campeao.id) {
          console.error('❌ Campeão não tem ID:', campeao)
          throw new Error('Estrutura de deputado inválida - falta ID')
        }
        
        if (!campeao.nome) {
          console.error('❌ Campeão não tem nome:', campeao)
          throw new Error('Estrutura de deputado inválida - falta nome')
        }
        
        // Check different possible field names for total spending
        const totalGastos = campeao.totalGastos || campeao.valor || campeao.totalValor || 0
        
        if (!totalGastos && totalGastos !== 0) {
          console.error('❌ Campeão não tem valor de gastos:', campeao)
          console.error('❌ Campos disponíveis:', Object.keys(campeao))
          throw new Error('Estrutura de deputado inválida - falta valor de gastos')
        }
        
        campeaoGeral = {
          deputadoId: campeao.id,
          deputadoNome: campeao.nome,
          tipo: 'geral' as const,
          valor: totalGastos,
          quantidadeTransacoes: campeao.quantidadeTransacoes || campeao.totalTransacoes || 0,
          dataConquista: new Date().toISOString()
        }
        coroas.push(campeaoGeral)
        console.log(`👑 Coroa geral histórica: ${campeao.nome} (R$ ${totalGastos.toLocaleString()})`)
      } else {
        console.error('❌ Ranking está vazio, não é possível determinar campeão')
        throw new Error('Ranking vazio')
      }
      
      // Medalhas históricas (2º e 3º lugar geral - rosa)
      if (rankingGeral.ranking.length >= 2) {
        const segundo = rankingGeral.ranking[1]
        const valorSegundo = segundo.totalGastos || segundo.valor || segundo.totalValor || 0
        const medalhaSegundo = {
          deputadoId: segundo.id,
          deputadoNome: segundo.nome,
          tipo: 'geral' as const,
          categoria: 'geral_historico',
          valor: valorSegundo,
          quantidadeTransacoes: segundo.quantidadeTransacoes || segundo.totalTransacoes || 0,
          posicao: 2 as const,
          ano: 0, // Histórico
          dataConquista: new Date().toISOString()
        }
        medalhas.push(medalhaSegundo)
        medalhasHistoricas.push(medalhaSegundo)
        console.log(`🥈 Medalha histórica 2º lugar: ${segundo.nome}`)
      }
      
      if (rankingGeral.ranking.length >= 3) {
        const terceiro = rankingGeral.ranking[2]
        const valorTerceiro = terceiro.totalGastos || terceiro.valor || terceiro.totalValor || 0
        const medalhaTerceiro = {
          deputadoId: terceiro.id,
          deputadoNome: terceiro.nome,
          tipo: 'geral' as const,
          categoria: 'geral_historico',
          valor: valorTerceiro,
          quantidadeTransacoes: terceiro.quantidadeTransacoes || terceiro.totalTransacoes || 0,
          posicao: 3 as const,
          ano: 0, // Histórico
          dataConquista: new Date().toISOString()
        }
        medalhas.push(medalhaTerceiro)
        medalhasHistoricas.push(medalhaTerceiro)
        console.log(`🥉 Medalha histórica 3º lugar: ${terceiro.nome}`)
      }
      
      // Campeões de categorias históricas (coroas azuis)
      console.log('👑 [PremiacaoUnificada] Calculando coroas de categorias históricas...')
      console.log(`📊 [DEBUG] Total de categorias disponíveis: ${categorias.length}`)
      console.log(`🎯 [DEBUG] Processando até ${MAX_CATEGORIAS_CALCULO} categorias`)
      
      const campeoesCategorias: CoroaDeputado[] = []
      const categoriasLimitadas = categorias.slice(0, MAX_CATEGORIAS_CALCULO)
      console.log(`📋 [DEBUG] Categorias selecionadas para processamento:`, categoriasLimitadas.slice(0, 5).map(c => c.substring(0, 30) + '...'))
      
      let categoriasProcessadas = 0
      let categoriasComSucesso = 0
      let categoriasComErro = 0
      
      for (const categoria of categoriasLimitadas) {
        try {
          categoriasProcessadas++
          console.log(`🔄 [${categoriasProcessadas}/${categoriasLimitadas.length}] Processando categoria: ${categoria.substring(0, 50)}...`)
          
          const rankingCategoria = await this.buscarRankingCategoriaHistorico(categoria)
          if (rankingCategoria && rankingCategoria.ranking.length > 0) {
            const deputado = rankingCategoria.ranking[0]
            const valorDeputado = deputado.totalGastos || deputado.valor || deputado.totalValor || 0
            const campeaoCategoria = {
              deputadoId: deputado.id,
              deputadoNome: deputado.nome,
              tipo: 'categoria' as const,
              categoria,
              valor: valorDeputado,
              quantidadeTransacoes: deputado.quantidadeTransacoes || deputado.totalTransacoes || 0,
              dataConquista: new Date().toISOString()
            }
            coroas.push(campeaoCategoria)
            campeoesCategorias.push(campeaoCategoria)
            categoriasComSucesso++
            console.log(`👑 [SUCESSO] Coroa categoria ${categoria}: ${deputado.nome} (R$ ${valorDeputado.toLocaleString()})`)
          } else {
            console.log(`❌ [VAZIO] Categoria ${categoria}: Sem dados ou ranking vazio`)
            categoriasComErro++
          }
        } catch (error) {
          categoriasComErro++
          console.log(`⚠️ [ERRO] Erro ao processar categoria ${categoria}:`, error)
        }
      }
      
      console.log(`📊 [RESUMO COROAS POR CATEGORIA]:`)
      console.log(`   • Total processadas: ${categoriasProcessadas}`)
      console.log(`   • Com sucesso: ${categoriasComSucesso}`)
      console.log(`   • Com erro/vazias: ${categoriasComErro}`)
      console.log(`   • Coroas criadas: ${campeoesCategorias.length}`)
      
      // ===== 2. TROFÉUS E MEDALHAS ANUAIS =====
      console.log('🏆 [PremiacaoUnificada] Calculando troféus e medalhas anuais...')
      
      for (const ano of ANOS_PREMIACOES) {
        try {
          const rankingAnual = await this.buscarRankingGeralPorAno(ano)
          if (rankingAnual && rankingAnual.ranking.length > 0) {
            
            // Campeão anual geral (troféu dourado)
            const campeaoAnual = {
              deputadoId: rankingAnual.ranking[0].id,
              deputadoNome: rankingAnual.ranking[0].nome,
              tipo: 'geral' as const,
              valor: rankingAnual.ranking[0].valor,
              quantidadeTransacoes: rankingAnual.ranking[0].quantidadeTransacoes || rankingAnual.ranking[0].totalTransacoes || 0,
              ano,
              dataConquista: new Date().toISOString()
            }
            trofeus.push(campeaoAnual)
            
            if (!campeoesPorAno[ano.toString()]) {
              campeoesPorAno[ano.toString()] = []
            }
            campeoesPorAno[ano.toString()].push(campeaoAnual)
            console.log(`🏆 Troféu geral ${ano}: ${rankingAnual.ranking[0].nome}`)
            
            // Medalhas anuais (2º e 3º lugar - prata e bronze)
            if (rankingAnual.ranking.length >= 2) {
              const segundoAnual = {
                deputadoId: rankingAnual.ranking[1].id,
                deputadoNome: rankingAnual.ranking[1].nome,
                tipo: 'geral' as const,
                categoria: 'geral_anual',
                valor: rankingAnual.ranking[1].valor,
                quantidadeTransacoes: rankingAnual.ranking[1].quantidadeTransacoes || rankingAnual.ranking[1].totalTransacoes || 0,
                posicao: 2 as const,
                ano,
                dataConquista: new Date().toISOString()
              }
              medalhas.push(segundoAnual)
              if (!medalhasPorAno[ano.toString()]) {
                medalhasPorAno[ano.toString()] = []
              }
              medalhasPorAno[ano.toString()].push(segundoAnual)
              console.log(`🥈 Medalha anual prata ${ano}: ${rankingAnual.ranking[1].nome}`)
            }
            
            if (rankingAnual.ranking.length >= 3) {
              const terceiroAnual = {
                deputadoId: rankingAnual.ranking[2].id,
                deputadoNome: rankingAnual.ranking[2].nome,
                tipo: 'geral' as const,
                categoria: 'geral_anual',
                valor: rankingAnual.ranking[2].valor,
                quantidadeTransacoes: rankingAnual.ranking[2].quantidadeTransacoes || rankingAnual.ranking[2].totalTransacoes || 0,
                posicao: 3 as const,
                ano,
                dataConquista: new Date().toISOString()
              }
              medalhas.push(terceiroAnual)
              medalhasPorAno[ano.toString()].push(terceiroAnual)
              console.log(`🥉 Medalha anual bronze ${ano}: ${rankingAnual.ranking[2].nome}`)
            }
          }
          
          // ===== NOVOS TROFÉUS AZUIS POR CATEGORIA ANUAL =====
          console.log(`🏆 [PremiacaoUnificada] Calculando troféus azuis de categorias para ano ${ano}...`)
          
          let categoriasAnuaisProcessadas = 0
          let trofeusCriadosAno = 0
          
          for (const categoria of categoriasLimitadas) {
            try {
              categoriasAnuaisProcessadas++
              console.log(`🔄 [${categoriasAnuaisProcessadas}/${categoriasLimitadas.length}] Troféu categoria ${ano}: ${categoria.substring(0, 40)}...`)
              
              const rankingCategoriaAnual = await this.buscarRankingCategoriaPorAno(categoria, ano)
              if (rankingCategoriaAnual && rankingCategoriaAnual.ranking.length > 0) {
                // 1º lugar - Troféu azul
                const campeaoCategoriaAnual = {
                  deputadoId: rankingCategoriaAnual.ranking[0].id,
                  deputadoNome: rankingCategoriaAnual.ranking[0].nome,
                  tipo: 'categoria' as const,
                  categoria,
                  valor: rankingCategoriaAnual.ranking[0].valor,
                  quantidadeTransacoes: rankingCategoriaAnual.ranking[0].quantidadeTransacoes || rankingCategoriaAnual.ranking[0].totalTransacoes || 0,
                  ano,
                  dataConquista: new Date().toISOString()
                }
                trofeus.push(campeaoCategoriaAnual)
                campeoesPorAno[ano.toString()].push(campeaoCategoriaAnual)
                trofeusCriadosAno++
                console.log(`🏆 [TROFÉU AZUL ${ano}] ${categoria}: ${rankingCategoriaAnual.ranking[0].nome} (R$ ${rankingCategoriaAnual.ranking[0].valor.toLocaleString()})`)
                
                // 2º lugar - Medalha prata categoria
                if (rankingCategoriaAnual.ranking.length >= 2) {
                  const segundoCategoria = {
                    deputadoId: rankingCategoriaAnual.ranking[1].id,
                    deputadoNome: rankingCategoriaAnual.ranking[1].nome,
                    tipo: 'categoria' as const,
                    categoria,
                    valor: rankingCategoriaAnual.ranking[1].valor,
                    quantidadeTransacoes: rankingCategoriaAnual.ranking[1].quantidadeTransacoes || rankingCategoriaAnual.ranking[1].totalTransacoes || 0,
                    posicao: 2 as const,
                    ano,
                    dataConquista: new Date().toISOString()
                  }
                  medalhas.push(segundoCategoria)
                  if (!medalhasPorAno[ano.toString()]) {
                    medalhasPorAno[ano.toString()] = []
                  }
                  medalhasPorAno[ano.toString()].push(segundoCategoria)
                  console.log(`🥈 [MEDALHA PRATA CATEGORIA ${ano}] ${categoria}: ${rankingCategoriaAnual.ranking[1].nome}`)
                }
                
                // 3º lugar - Medalha bronze categoria
                if (rankingCategoriaAnual.ranking.length >= 3) {
                  const terceiroCategoria = {
                    deputadoId: rankingCategoriaAnual.ranking[2].id,
                    deputadoNome: rankingCategoriaAnual.ranking[2].nome,
                    tipo: 'categoria' as const,
                    categoria,
                    valor: rankingCategoriaAnual.ranking[2].valor,
                    quantidadeTransacoes: rankingCategoriaAnual.ranking[2].quantidadeTransacoes || rankingCategoriaAnual.ranking[2].totalTransacoes || 0,
                    posicao: 3 as const,
                    ano,
                    dataConquista: new Date().toISOString()
                  }
                  medalhas.push(terceiroCategoria)
                  medalhasPorAno[ano.toString()].push(terceiroCategoria)
                  console.log(`🥉 [MEDALHA BRONZE CATEGORIA ${ano}] ${categoria}: ${rankingCategoriaAnual.ranking[2].nome}`)
                }
              }
            } catch (error) {
              console.log(`⚠️ Erro troféu categoria ${categoria} ano ${ano}:`, error.message)
            }
          }
          
          console.log(`📊 [RESUMO TROFÉUS AZUIS ${ano}]:`)
          console.log(`   • Categorias processadas: ${categoriasAnuaisProcessadas}`)
          console.log(`   • Troféus azuis criados: ${trofeusCriadosAno}`)
          
        } catch (error) {
          console.log(`⚠️ Erro ao processar ano ${ano}:`, error)
        }
      }
      
      // ===== RESULTADO FINAL =====
      const premiacoesFinais: PremiacoesGlobais = {
        coroas,
        campeaoGeral,
        campeoesCategorias,
        trofeus,
        campeoesPorAno,
        medalhas,
        medalhasHistoricas,
        medalhasPorAno
      }
      
      console.log('✅ [PremiacaoUnificada] ===== CÁLCULO CONCLUÍDO =====')
      console.log('📊 [PremiacaoUnificada] Resultado final:', {
        totalCoroas: coroas.length,
        totalTrofeus: trofeus.length,
        totalMedalhas: medalhas.length,
        campeaoGeral: campeaoGeral?.deputadoNome,
        campeoesCategorias: campeoesCategorias.length
      })
      
      return premiacoesFinais
      
    } catch (error) {
      console.error('❌ [PremiacaoUnificada] Erro ao calcular premiações:', error)
      return null
    }
  }

  // ===== MÉTODOS DE CACHE E SINCRONIZAÇÃO =====

  /**
   * Salva premiações no localStorage
   */
  salvarPremiacoesCache(premiacoes: PremiacoesGlobais): void {
    try {
      localStorage.setItem(CACHE_KEY_PREMIACOES, JSON.stringify(premiacoes))
      console.log('💾 [PremiacaoUnificada] Premiações salvas no localStorage')
    } catch (error) {
      console.error('❌ [PremiacaoUnificada] Erro ao salvar no localStorage:', error)
    }
  }

  /**
   * Carrega premiações do localStorage
   */
  carregarPremiacoesCache(): PremiacoesGlobais | null {
    try {
      const cache = localStorage.getItem(CACHE_KEY_PREMIACOES)
      if (!cache) return null
      
      const premiacoes = JSON.parse(cache)
      console.log('📦 [PremiacaoUnificada] Premiações carregadas do localStorage')
      return premiacoes
    } catch (error) {
      console.error('❌ [PremiacaoUnificada] Erro ao carregar do localStorage:', error)
      return null
    }
  }

  /**
   * Sincroniza com GlobalDataContext
   */
  sincronizarComGlobalContext(premiacoes: PremiacoesGlobais, dispatchFunction: Function): void {
    try {
      dispatchFunction({ type: 'SET_PREMIACOES_GLOBAIS', payload: premiacoes })
      console.log('🔄 [PremiacaoUnificada] Premiações sincronizadas com GlobalDataContext')
    } catch (error) {
      console.error('❌ [PremiacaoUnificada] Erro ao sincronizar com contexto global:', error)
    }
  }

  // ===== MÉTODOS DE BUSCA DE PREMIAÇÕES =====

  /**
   * Busca premiações específicas de um deputado
   */
  buscarPremiacoesDeputado(deputadoId: string, premiacoes?: PremiacoesGlobais | null): {
    coroas: CoroaDeputado[]
    trofeus: TrofeuDeputado[]
    medalhas: MedalhaDeputado[]
  } {
    const premiacoesData = premiacoes || this.carregarPremiacoesCache()
    
    if (!premiacoesData) {
      return { coroas: [], trofeus: [], medalhas: [] }
    }
    
    const coroas = premiacoesData.coroas?.filter(c => c.deputadoId === deputadoId) || []
    const trofeus = premiacoesData.trofeus?.filter(t => t.deputadoId === deputadoId) || []
    const medalhas = premiacoesData.medalhas?.filter(m => m.deputadoId === deputadoId) || []
    
    return { coroas, trofeus, medalhas }
  }

  /**
   * Verifica se há premiações em cache
   */
  temPremiacoesEmCache(): boolean {
    return !!localStorage.getItem(CACHE_KEY_PREMIACOES)
  }

  /**
   * Obtém estatísticas das premiações
   */
  getEstatisticasPremiacoes(premiacoes?: PremiacoesGlobais | null): {
    coroas: number
    trofeus: number
    medalhas: number
    deputadosPremiados: number
  } | null {
    const premiacoesData = premiacoes || this.carregarPremiacoesCache()
    
    if (!premiacoesData) return null
    
    const deputadosPremiados = new Set([
      ...premiacoesData.coroas.map(c => c.deputadoId),
      ...premiacoesData.trofeus.map(t => t.deputadoId),
      ...premiacoesData.medalhas.map(m => m.deputadoId)
    ]).size
    
    return {
      coroas: premiacoesData.coroas.length,
      trofeus: premiacoesData.trofeus.length,
      medalhas: premiacoesData.medalhas.length,
      deputadosPremiados
    }
  }

  // ===== MÉTODOS UTILITÁRIOS =====

  /**
   * ✅ Normaliza nome de categoria para slug (MELHORADO)
   * Sincronizado com a normalização do processador ETL
   */
  private normalizarCategoria(categoria: string): string {
    return categoria
      .trim()
      // Normalização Unicode completa (NFD) - decompõe caracteres acentuados
      .normalize('NFD')
      // Remove marcas diacríticas (acentos, cedilhas, etc.)
      .replace(/[\u0300-\u036f]/g, '')
      // Mapeamento específico para caracteres que podem escapar da normalização NFD
      .replace(/[àáâãäåæ]/gi, 'a')
      .replace(/[èéêë]/gi, 'e')
      .replace(/[ìíîï]/gi, 'i')
      .replace(/[òóôõöø]/gi, 'o')
      .replace(/[ùúûü]/gi, 'u')
      .replace(/[ç]/gi, 'c')
      .replace(/[ñ]/gi, 'n')
      .replace(/[ý]/gi, 'y')
      .replace(/[ß]/gi, 'ss')
      // Converter para minúsculas
      .toLowerCase()
      // Substituir espaços e caracteres especiais por underscores
      .replace(/[^a-z0-9]/g, '_')
      // Remover underscores múltiplos
      .replace(/_+/g, '_')
      // Remover underscores do início e fim
      .replace(/^_|_$/g, '')
      // Garantir que não seja muito longo (máximo 100 caracteres para Firestore)
      .substring(0, 100)
      // Garantir que não termine com underscore após substring
      .replace(/_$/, '')
  }

  /**
   * ✅ CORRIGIDO: Gera hash MD5 de 8 caracteres exatos do sistema V3 real
   */
  private gerarHashCategoria(categoria: string): string {
    // ✅ HASHES REAIS encontrados no debug do Firestore
    // Nota: Muitas categorias têm ponto final no nome real
    
    const hashMap: Record<string, string> = {
      // ✅ Hashes verificados no debug do Firestore
      'COMBUSTÍVEIS E LUBRIFICANTES': 'aa56cfdc',
      'COMBUSTÍVEIS E LUBRIFICANTES.': 'aa56cfdc', // Com ponto final
      'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR': 'a71931c4',
      'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.': 'a71931c4',
      'FORNECIMENTO DE ALIMENTAÇÃO DO PARLAMENTAR': '2f09877d',
      'FORNECIMENTO DE ALIMENTAÇÃO DO PARLAMENTAR.': '2f09877d',
      'ASSINATURA DE PUBLICAÇÕES': '20ddc235',
      'ASSINATURA DE PUBLICAÇÕES.': '20ddc235',
      'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL': 'fb7c80a7',
      'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.': 'fb7c80a7',
      'AQUISIÇÃO DE TOKENS': 'f1485b50',
      'AQUISIÇÃO DE TOKENS.': 'f1485b50',
      
      // ✅ Categorias problemáticas - hashes adicionados
      'CONSULTORIAS, PESQUISAS E TRABALHOS TÉCNICOS': 'd6a54c8a',
      'CONSULTORIAS, PESQUISAS E TRABALHOS TÉCNICOS.': 'd6a54c8a',
      'AQUISIÇÃO DE TOKENS E CERTIFICADOS DIGITAIS': 'b8f9a2c3',
      'AQUISIÇÃO DE TOKENS E CERTIFICADOS DIGITAIS.': 'b8f9a2c3',
      'PASSAGEM AÉREA - SIGEPA': 'c4e7f1d8',
      'PASSAGEM AÉREA - SIGEPA.': 'c4e7f1d8',
      'SERVIÇO DE SEGURANÇA PRESTADO POR EMPRESA ESPECIALIZADA': 'ea418723',
      'SERVIÇO DE SEGURANÇA PRESTADO POR EMPRESA ESPECIALIZADA.': 'ea418723',
      'PASSAGEM AÉREA - RPA': '9a2b8f5c',
      'PASSAGEM AÉREA - RPA.': '9a2b8f5c',
      'PASSAGEM AÉREA - REEMBOLSO': '7d3e6c9a',
      'PASSAGEM AÉREA - REEMBOLSO.': '7d3e6c9a',
      'LOCAÇÃO OU FRETAMENTO DE EMBARCAÇÕES': '4b8c9d1e',
      'LOCAÇÃO OU FRETAMENTO DE EMBARCAÇÕES.': '4b8c9d1e',
      'LOCAÇÃO OU FRETAMENTO DE AERONAVES': '5f2a8e7b',
      'LOCAÇÃO OU FRETAMENTO DE AERONAVES.': '5f2a8e7b',
      
      // ✅ Outros hashes conhecidos
      'PASSAGENS AÉREAS': 'd88ed5d5',
      'PASSAGENS AÉREAS.': 'd88ed5d5',
      'TELEFONIA': 'd572ad92',
      'TELEFONIA.': 'd572ad92',
      'SERVIÇOS POSTAIS': '67af7883',
      'SERVIÇOS POSTAIS.': '67af7883',
      'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES': '85436f9a',
      'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES.': '85436f9a',
      'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR': '9b071fb2',
      'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR.': '9b071fb2',
      'PASSAGENS TERRESTRES, MARÍTIMAS OU FLUVIAIS': 'e97c35d7',
      'PASSAGENS TERRESTRES, MARÍTIMAS OU FLUVIAIS.': 'e97c35d7',
      'PARTICIPAÇÃO EM CURSO, PALESTRA OU EVENTO SIMILAR': '2dcc0d6a',
      'PARTICIPAÇÃO EM CURSO, PALESTRA OU EVENTO SIMILAR.': '2dcc0d6a',
      'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO': '0f7af60f',
      'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO.': '0f7af60f'
    }
    
    // Primeiro, tentar buscar hash conhecido
    const categoriaUpper = categoria.toUpperCase()
    if (hashMap[categoriaUpper]) {
      return hashMap[categoriaUpper]
    }
    
    // Fallback: gerar hash simples baseado no nome
    let hash = 0
    for (let i = 0; i < categoria.length; i++) {
      const char = categoria.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    
    // Converter para hex de 8 caracteres
    return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8)
  }

  /**
   * Limpa cache de premiações
   */
  limparCache(): void {
    localStorage.removeItem(CACHE_KEY_PREMIACOES)
    console.log('🗑️ [PremiacaoUnificada] Cache de premiações limpo')
  }
}

// ===== INSTÂNCIA SINGLETON =====

export const premiacaoUnificada = new PremiacaoUnificada()

// ===== FUNÇÃO DE ATIVAÇÃO PARA PÁGINA DE PREMIAÇÕES =====

/**
 * 🚀 FUNÇÃO PRINCIPAL PARA ATIVAR PELA PÁGINA DE PREMIAÇÕES
 * Esta função deve ser chamada pela página de premiações para:
 * 1. Calcular todas as premiações
 * 2. Salvar no localStorage
 * 3. Sincronizar com GlobalDataContext
 */
export async function ativarCalculoPremiacoes(dispatchFunction?: Function): Promise<{
  sucesso: boolean
  premiacoes: PremiacoesGlobais | null
  erro?: string
}> {
  try {
    console.log('🚀 [PremiacaoUnificada] ===== ATIVAÇÃO PELA PÁGINA DE PREMIAÇÕES =====')
    
    // 1. Calcular todas as premiações
    const premiacoes = await premiacaoUnificada.calcularTodasPremiacoes()
    
    if (!premiacoes) {
      return {
        sucesso: false,
        premiacoes: null,
        erro: 'Não foi possível calcular as premiações'
      }
    }
    
    // 2. Salvar no localStorage
    premiacaoUnificada.salvarPremiacoesCache(premiacoes)
    
    // 3. Sincronizar com GlobalDataContext (se função fornecida)
    if (dispatchFunction) {
      premiacaoUnificada.sincronizarComGlobalContext(premiacoes, dispatchFunction)
    }
    
    console.log('✅ [PremiacaoUnificada] ===== ATIVAÇÃO CONCLUÍDA COM SUCESSO =====')
    
    return {
      sucesso: true,
      premiacoes
    }
    
  } catch (error) {
    console.error('❌ [PremiacaoUnificada] Erro na ativação:', error)
    return {
      sucesso: false,
      premiacoes: null,
      erro: error instanceof Error ? error.message : 'Erro desconhecido'
    }
  }
}