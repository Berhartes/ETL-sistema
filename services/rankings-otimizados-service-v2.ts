/**
 * Serviço otimizado para consumir rankings pré-calculados
 * Versão simplificada que usa os padrões corretos do Firestore
 */

import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { formatarCategoria } from '@/lib/categoria-formatter'

interface RankingDeputado {
  id: string
  nome: string
  nomeCivil: string
  partido: string
  uf: string
  urlFoto?: string
  totalGastos: number
  quantidadeTransacoes: number
  posicao: number
  categoria?: string
}

interface RankingResponse {
  ranking: RankingDeputado[]
  totalDeputados: number
  ultimaAtualizacao: Date
  periodo: string
  fonte?: string
}

interface EstatisticasGlobais {
  totalGeral: number
  totalTransacoes: number
  mediaTransacao: number
  totalDeputados: number
  totalFornecedores: number
  totalCategorias: number
  anosDisponiveis: number[]
  estatisticasPorAno: Record<string, any>
  estatisticasPorCategoria: Record<string, any>
  top10Geral: RankingDeputado[]
  top10PorCategoria: Record<string, RankingDeputado[]>
  ultimaAtualizacao: Date
}

export class RankingsOtimizadosService {
  
  /**
   * ✅ Normaliza nome da categoria para o padrão usado no Firestore (MELHORADO)
   * Sincronizado com a normalização do processador ETL
   */
  private normalizarNomeCategoria(categoria: string): string {
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
   * Busca ranking geral histórico (todos os anos)
   */
  async buscarRankingGeralHistorico(): Promise<RankingResponse | null> {
    try {
      const docRef = doc(db, 'rankings', 'deputados_geral_historico')
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log('❌ Ranking geral histórico não encontrado no Firestore')
        return null
      }

      const data = docSnap.data()
      return {
        ranking: data.ranking || [],
        totalDeputados: data.totalItens || data.ranking?.length || 0,
        ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
        periodo: data.periodo || 'historico'
      }
    } catch (error) {
      console.error('❌ Erro ao buscar ranking geral histórico:', error)
      return null
    }
  }

  /**
   * Busca ranking geral por ano específico
   */
  async buscarRankingGeralPorAno(ano: number): Promise<RankingResponse | null> {
    try {
      const docRef = doc(db, 'rankings', `deputados_geral_${ano}`)
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log(`❌ Ranking geral do ano ${ano} não encontrado no Firestore`)
        return null
      }

      const data = docSnap.data()
      return {
        ranking: data.ranking || [],
        totalDeputados: data.totalItens || data.ranking?.length || 0,
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
  async buscarRankingCategoriaHistorico(categoria: string): Promise<RankingResponse | null> {
    try {
      console.log(`🔍 Buscando ranking histórico da categoria: "${categoria}"`)
      
      const categoriaNormalizada = this.normalizarNomeCategoria(categoria)
      const docId = `deputados_${categoriaNormalizada}_historico`
      
      console.log(`📊 Tentando buscar documento: "${docId}"`)
      
      const docRef = doc(db, 'rankings', docId)
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log(`❌ Ranking histórico não encontrado para categoria "${categoria}" (ID: ${docId})`)
        
        // 🔍 DEBUG: Investigar por que não foi encontrado
        console.log(`🔍 [DEBUG] Tentativas de busca:`)
        console.log(`   - Documento buscado: "${docId}"`)
        console.log(`   - Categoria original: "${categoria}"`)
        console.log(`   - Categoria normalizada: "${categoriaNormalizada}"`)
        
        // Tentar buscar documentos similares
        const { collection, getDocs } = await import('firebase/firestore')
        const rankingsRef = collection(db, 'rankings')
        const allRankingsSnapshot = await getDocs(rankingsRef)
        
        const documentosSimilares = []
        allRankingsSnapshot.forEach((doc) => {
          const id = doc.id
          if (id.includes(categoriaNormalizada.split('_')[0]) || 
              categoriaNormalizada.includes(id.split('_')[1] || '')) {
            documentosSimilares.push(id)
          }
        })
        
        if (documentosSimilares.length > 0) {
          console.log(`🔍 [DEBUG] Documentos similares encontrados:`)
          documentosSimilares.forEach(doc => console.log(`   - ${doc}`))
        } else {
          console.log(`🔍 [DEBUG] Nenhum documento similar encontrado`)
          
          // Listar alguns documentos existentes para comparação
          const primeiros10 = []
          let count = 0
          allRankingsSnapshot.forEach((doc) => {
            if (count < 10 && doc.id.startsWith('deputados_') && doc.id.endsWith('_historico')) {
              primeiros10.push(doc.id)
              count++
            }
          })
          
          console.log(`🔍 [DEBUG] Exemplos de documentos existentes:`)
          primeiros10.forEach(doc => console.log(`   - ${doc}`))
        }
        
        return null
      }
      
      const data = docSnap.data()
      console.log(`✅ Ranking histórico encontrado:`, {
        totalItens: data.totalItens,
        periodo: data.periodo,
        categoria: data.categoria,
        deputados: data.ranking?.length || 0
      })
      
      return {
        ranking: data.ranking || [],
        totalDeputados: data.totalItens || data.ranking?.length || 0,
        ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
        periodo: data.periodo || 'historico'
      }
      
    } catch (error) {
      console.error(`❌ Erro ao buscar ranking histórico da categoria ${categoria}:`, error)
      return null
    }
  }

  /**
   * Busca ranking de categoria por ano específico
   */
  async buscarRankingCategoriaPorAno(categoria: string, ano: number): Promise<RankingResponse | null> {
    try {
      console.log(`🔍 Buscando ranking da categoria "${categoria}" para o ano ${ano}`)
      
      const categoriaNormalizada = this.normalizarNomeCategoria(categoria)
      const docId = `deputados_${categoriaNormalizada}_${ano}`
      
      console.log(`📊 Tentando buscar documento: "${docId}"`)
      
      const docRef = doc(db, 'rankings', docId)
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log(`❌ Ranking não encontrado para categoria "${categoria}" no ano ${ano} (ID: ${docId})`)
        
        // 🔍 DEBUG: Investigar documentos por ano
        console.log(`🔍 [DEBUG] Busca por ano:`)
        console.log(`   - Documento buscado: "${docId}"`)
        console.log(`   - Categoria original: "${categoria}"`)
        console.log(`   - Categoria normalizada: "${categoriaNormalizada}"`)
        console.log(`   - Ano: ${ano}`)
        
        return null
      }
      
      const data = docSnap.data()
      console.log(`✅ Ranking encontrado:`, {
        totalItens: data.totalItens,
        periodo: data.periodo,
        categoria: data.categoria,
        deputados: data.ranking?.length || 0
      })
      
      return {
        ranking: data.ranking || [],
        totalDeputados: data.totalItens || data.ranking?.length || 0,
        ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date(),
        periodo: data.periodo || ano.toString()
      }
      
    } catch (error) {
      console.error(`❌ Erro ao buscar ranking da categoria ${categoria} no ano ${ano}:`, error)
      return null
    }
  }

  /**
   * Busca estatísticas globais otimizadas
   */
  async buscarEstatisticasGlobais(): Promise<EstatisticasGlobais | null> {
    try {
      const docRef = doc(db, 'rankings', 'estatisticas_globais')
      const docSnap = await getDoc(docRef)
      
      if (!docSnap.exists()) {
        console.log('❌ Estatísticas globais não encontradas no Firestore')
        return null
      }

      const data = docSnap.data()
      return {
        totalGeral: data.totalGeral || 0,
        totalTransacoes: data.totalTransacoes || 0,
        mediaTransacao: data.mediaTransacao || 0,
        totalDeputados: data.totalDeputados || 0,
        totalFornecedores: data.totalFornecedores || 0,
        totalCategorias: data.totalCategorias || 0,
        anosDisponiveis: data.anosDisponiveis || [],
        estatisticasPorAno: data.estatisticasPorAno || {},
        estatisticasPorCategoria: data.estatisticasPorCategoria || {},
        top10Geral: data.top10Geral || [],
        top10PorCategoria: data.top10PorCategoria || {},
        ultimaAtualizacao: data.ultimaAtualizacao?.toDate() || new Date()
      }
    } catch (error) {
      console.error('❌ Erro ao buscar estatísticas globais:', error)
      return null
    }
  }

  /**
   * Lista categorias disponíveis extraindo dos documentos existentes
   */
  async listarCategoriasDisponiveis(): Promise<string[]> {
    try {
      console.log('🔍 Extraindo categorias dos documentos de ranking...')
      
      // Usar formatador global de categorias
      
      const { collection, getDocs } = await import('firebase/firestore')
      const rankingsRef = collection(db, 'rankings')
      const rankingsSnapshot = await getDocs(rankingsRef)
      
      const categorias = new Set<string>()
      
      rankingsSnapshot.forEach((doc) => {
        const id = doc.id
        // Pegar apenas documentos que começam com 'deputados_' e terminam com '_historico'
        if (id.startsWith('deputados_') && id.endsWith('_historico') && id.indexOf('geral') === -1) {
          // Extrair nome da categoria
          const categoria = id.replace('deputados_', '').replace('_historico', '')
          
          // Tentar obter o nome correto do CategoryRegistry
          const categoriaFormatada = categoria
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase()) // Primeira letra de cada palavra em maiúscula
          
          // Usar o formatador global de categorias para obter o displayName correto
          const displayName = formatarCategoria(categoriaFormatada)
          
          categorias.add(displayName)
        }
      })
      
      const listaCategorias = Array.from(categorias).sort()
      console.log(`📊 ${listaCategorias.length} categorias encontradas:`, listaCategorias)
      
      return listaCategorias
      
    } catch (error) {
      console.error('❌ Erro ao listar categorias:', error)
      return []
    }
  }
}