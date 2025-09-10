/**
 * 🏆 SISTEMA UNIFICADO DE PREMIAÇÕES DE DEPUTADOS
 * 
 * Este serviço centraliza toda a lógica de premiação, badges e banners para deputados.
 * Responsável por:
 * - Cálculo e atribuição de premiações (coroas, troféus, medalhas)
 * - Renderização de badges nos cards dos deputados
 * - Banners de premiações nos perfis dos deputados
 * - Sincronização com Context Global e Firestore
 * - Cache e persistência local
 * 
 * @author Sistema de Gestão de Gastos de Deputados
 * @version 1.0.0
 */

import React from 'react'
import { doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { premiacaoUnificada, type PremiacoesGlobais } from '@/services/premiacao-unificada'

// ===== INTERFACES E TIPOS =====

export interface DeputadoRanking {
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
  ano?: number
}

export interface CoroaDeputado {
  deputadoId: string
  deputadoNome: string
  tipo: 'geral' | 'categoria'
  categoria?: string
  valor: number
  dataConquista: string
  descricao?: string
}

export interface TrofeuDeputado {
  deputadoId: string
  deputadoNome: string
  tipo: 'geral' | 'categoria'
  categoria?: string
  valor: number
  ano: number
  posicao: number
  dataConquista: string
  descricao?: string
}

export interface MedalhaDeputado {
  deputadoId: string
  deputadoNome: string
  tipo: 'geral' | 'categoria'
  categoria?: string
  valor: number
  ano?: number
  posicao: number
  dataConquista: string
  descricao?: string
}

export interface PremiacoesDeputado {
  deputadoId: string
  deputadoNome: string
  coroas: CoroaDeputado[]
  trofeus: TrofeuDeputado[]
  medalhas: MedalhaDeputado[]
  totalPremiacoes: number
  ultimaAtualizacao: Date
}

export interface PremiacaoVisual {
  tipo: 'coroa' | 'trofeu' | 'medalha'
  subtipo: 'geral' | 'categoria'
  emoji: string
  cor: string
  descricao: string
  categoria?: string
  ano?: number
  valor: number
  posicao?: number
}

export interface PremiacaoAgrupada {
  tipo: 'coroa' | 'trofeu' | 'medalha'
  subtipo: 'geral' | 'categoria'
  emoji: string
  cor: string
  descricao: string
  quantidade: number
  premiacoes: PremiacaoVisual[]
  numeroAlto: string // ¹²³⁴⁵⁶⁷⁸⁹
}

// ===== CONFIGURAÇÕES DE PREMIAÇÃO =====

const CORES_PREMIACAO = {
  // Coroas
  coroa_geral: 'from-pink-400 to-pink-600',      // Rosa para campeão geral histórico
  coroa_categoria: 'from-blue-400 to-blue-600',   // Azul para campeão de categoria histórico
  
  // Troféus
  trofeu_geral: 'from-yellow-400 to-yellow-600',  // Dourado para campeão geral anual
  trofeu_categoria: 'from-blue-400 to-blue-600',  // Azul para campeão de categoria anual
  
  // Medalhas
  medalha_geral_historico: 'from-pink-400 to-pink-600',  // Rosa para medalhas históricas gerais
  medalha_prata: 'from-slate-300 to-slate-500',          // Prata para 2º lugar geral
  medalha_bronze: 'from-amber-500 to-yellow-700',        // Bronze para 3º lugar geral
  medalha_prata_categoria: 'from-slate-400 to-slate-600', // Prata especial para 2º lugar categoria
  medalha_bronze_categoria: 'from-amber-600 to-orange-800', // Bronze especial para 3º lugar categoria
  medalha_categoria: 'from-purple-400 to-purple-600'     // Roxo para outras medalhas de categoria
}

const EMOJIS_PREMIACAO = {
  coroa: '👑',
  trofeu: '🏆',
  medalha: '🎖️'
}

const DESCRICOES_PREMIACAO = {
  coroa_geral: 'Campeão Geral de Todos os Anos',
  coroa_categoria: 'Campeão de Categoria (Todos os Anos)',
  trofeu_geral: 'Campeão Geral Anual',
  trofeu_categoria: 'Campeão de Categoria Anual',
  medalha_geral_historico: 'Medalha de Honra Histórica',
  medalha_prata: 'Medalha de Prata',
  medalha_bronze: 'Medalha de Bronze',
  medalha_categoria: 'Medalha de Categoria'
}

// ===== SERVIÇO PRINCIPAL =====

class DeputadoPremiacaoUnificado {
  private cache: Map<string, PremiacoesDeputado> = new Map()
  private cacheTimeout = 5 * 60 * 1000 // 5 minutos

  /**
   * Busca todas as premiações de um deputado específico
   */
  async buscarPremiacoesDeputado(deputadoId: string): Promise<PremiacoesDeputado> {
    try {
      // Verificar cache primeiro
      const cacheKey = `premiacoes_${deputadoId}`
      const cached = this.cache.get(cacheKey)
      
      if (cached && (Date.now() - cached.ultimaAtualizacao.getTime()) < this.cacheTimeout) {
        console.log(`📦 [Deputado Premiação] Cache hit para ${deputadoId}`)
        return cached
      }

      console.log(`🔍 [Deputado Premiação] Buscando premiações para deputado ${deputadoId}`)

      // Tentar buscar do sistema unificado primeiro (localStorage)
      let premiacoes = await this.buscarPremiacoesUnificadas(deputadoId)
      
      // Se não encontrar no sistema unificado, buscar do Firestore
      if (premiacoes.totalPremiacoes === 0) {
        premiacoes = await this.buscarPremiacoesFirestore(deputadoId)
      }
      
      // Adicionar ao cache
      this.cache.set(cacheKey, premiacoes)
      
      return premiacoes

    } catch (error) {
      console.error(`❌ [Deputado Premiação] Erro ao buscar premiações para ${deputadoId}:`, error)
      return this.criarPremiacaoVazia(deputadoId)
    }
  }

  /**
   * Busca premiações do sistema unificado (localStorage)
   */
  private async buscarPremiacoesUnificadas(deputadoId: string): Promise<PremiacoesDeputado> {
    try {
      const premiacoesGlobaisCache = localStorage.getItem('premiacoesGlobais')
      if (!premiacoesGlobaisCache) {
        return this.criarPremiacaoVazia(deputadoId)
      }

      const premiacoesGlobais = JSON.parse(premiacoesGlobaisCache)
      
      // Filtrar premiações do deputado específico
      const coroas = premiacoesGlobais.coroas?.filter((c: any) => c.deputadoId === deputadoId) || []
      const trofeus = premiacoesGlobais.trofeus?.filter((t: any) => t.deputadoId === deputadoId) || []
      const medalhas = premiacoesGlobais.medalhas?.filter((m: any) => m.deputadoId === deputadoId) || []

      // Buscar nome do deputado
      let deputadoNome = 'Deputado'
      if (coroas.length > 0) {
        deputadoNome = coroas[0].deputadoNome
      } else if (trofeus.length > 0) {
        deputadoNome = trofeus[0].deputadoNome
      } else if (medalhas.length > 0) {
        deputadoNome = medalhas[0].deputadoNome
      }

      return {
        deputadoId,
        deputadoNome,
        coroas: coroas.map((c: any) => ({
          ...c,
          descricao: c.tipo === 'geral' 
            ? DESCRICOES_PREMIACAO.coroa_geral 
            : DESCRICOES_PREMIACAO.coroa_categoria
        })),
        trofeus: trofeus.map((t: any) => ({
          ...t,
          posicao: t.posicao || 1,
          descricao: t.tipo === 'geral' 
            ? DESCRICOES_PREMIACAO.trofeu_geral 
            : DESCRICOES_PREMIACAO.trofeu_categoria
        })),
        medalhas: medalhas.map((m: any) => ({
          ...m,
          descricao: this.obterDescricaoMedalhaUnificada(m)
        })),
        totalPremiacoes: coroas.length + trofeus.length + medalhas.length,
        ultimaAtualizacao: new Date()
      }

    } catch (error) {
      console.error(`❌ [Deputado Premiação] Erro ao buscar do sistema unificado para ${deputadoId}:`, error)
      return this.criarPremiacaoVazia(deputadoId)
    }
  }

  /**
   * Obter descrição específica para medalhas do sistema unificado
   */
  private obterDescricaoMedalhaUnificada(medalha: any): string {
    if (medalha.categoria === 'geral_historico' && medalha.ano === 0) {
      return DESCRICOES_PREMIACAO.medalha_geral_historico
    }
    
    if (medalha.categoria === 'geral_anual' && medalha.ano > 0) {
      return medalha.posicao === 2 
        ? DESCRICOES_PREMIACAO.medalha_prata 
        : DESCRICOES_PREMIACAO.medalha_bronze
    }
    
    // Medalhas de categoria específica
    if (medalha.tipo === 'categoria' && medalha.categoria && medalha.categoria !== 'geral_historico' && medalha.categoria !== 'geral_anual') {
      return medalha.posicao === 2 ? 'Medalha de Prata de Categoria' : 'Medalha de Bronze de Categoria'
    }
    
    return DESCRICOES_PREMIACAO.medalha_categoria
  }

  /**
   * Busca premiações no Firestore
   */
  private async buscarPremiacoesFirestore(deputadoId: string): Promise<PremiacoesDeputado> {
    console.log(`🔍 [Deputado Premiação] Buscando premiações no Firestore para ${deputadoId}`)
    
    // 🆕 NOVA ABORDAGEM: Usar premiações calculadas dinamicamente
    try {
      console.log(`🔍 [DEBUG] Calculando premiações globais...`)
      const premiacoesGlobais = await premiacaoUnificada.calcularTodasPremiacoes()
      
      if (!premiacoesGlobais) {
        console.warn(`⚠️ [Deputado Premiação] Não foi possível calcular premiações globais`)
        return this.criarPremiacaoVazia(deputadoId)
      }

      console.log(`🎯 [DEBUG] Premiações globais calculadas:`, {
        totalCoroas: premiacoesGlobais.coroas.length,
        totalTrofeus: premiacoesGlobais.trofeus.length,  
        totalMedalhas: premiacoesGlobais.medalhas.length
      })

      // Filtrar premiações específicas do deputado
      const coroas: CoroaDeputado[] = premiacoesGlobais.coroas.filter(c => c.deputadoId === deputadoId)
      const trofeus: TrofeuDeputado[] = premiacoesGlobais.trofeus.filter(t => t.deputadoId === deputadoId)
      const medalhas: MedalhaDeputado[] = premiacoesGlobais.medalhas.filter(m => m.deputadoId === deputadoId)

      console.log(`👤 [DEBUG] Premiações do deputado ${deputadoId}:`, {
        coroas: coroas.length,
        trofeus: trofeus.length,
        medalhas: medalhas.length
      })

      // Debug dos valores nas premiações
      if (coroas.length > 0) {
        console.log(`👑 [DEBUG] Primeira coroa:`, coroas[0])
      }
      if (trofeus.length > 0) {
        console.log(`🏆 [DEBUG] Primeiro troféu:`, trofeus[0])
      }
      if (medalhas.length > 0) {
        console.log(`🎖️ [DEBUG] Primeira medalha:`, medalhas[0])
      }

      // Buscar nome do deputado dos rankings se não tem premiações
      let deputadoNome = 'Deputado'
      if (coroas.length > 0) {
        deputadoNome = coroas[0].deputadoNome
      } else if (trofeus.length > 0) {
        deputadoNome = trofeus[0].deputadoNome
      } else if (medalhas.length > 0) {
        deputadoNome = medalhas[0].deputadoNome
      } else {
        // Tentar buscar do ranking geral se não tem premiações
        try {
          const rankingGeral = await getDoc(doc(db, 'rankings', 'deputados_geral_historico'))
          if (rankingGeral.exists()) {
            const data = rankingGeral.data()
            const deputado = data.ranking?.find((d: any) => d.id === deputadoId)
            if (deputado) {
              deputadoNome = deputado.nome
            }
          }
        } catch (err) {
          console.warn(`⚠️ [Deputado Premiação] Erro ao buscar nome do deputado ${deputadoId}:`, err)
        }
      }

      const result: PremiacoesDeputado = {
        deputadoId,
        deputadoNome,
        coroas,
        trofeus,
        medalhas,
        totalPremiacoes: coroas.length + trofeus.length + medalhas.length,
        ultimaAtualizacao: new Date()
      }

      console.log(`✅ [Deputado Premiação] Encontradas ${result.totalPremiacoes} premiações para ${deputadoNome}`)
      return result

    } catch (error) {
      console.error(`❌ [Deputado Premiação] Erro ao calcular premiações dinamicamente para ${deputadoId}:`, error)
      return this.criarPremiacaoVazia(deputadoId)
    }
  }


  /**
   * Cria estrutura vazia de premiações
   */
  private criarPremiacaoVazia(deputadoId: string): PremiacoesDeputado {
    return {
      deputadoId,
      deputadoNome: 'Deputado',
      coroas: [],
      trofeus: [],
      medalhas: [],
      totalPremiacoes: 0,
      ultimaAtualizacao: new Date()
    }
  }

  /**
   * Obter descrição específica para medalhas
   */
  private obterDescricaoMedalha(data: any): string {
    if (data.categoria === 'geral_historico' && data.ano === 0) {
      return DESCRICOES_PREMIACAO.medalha_geral_historico
    }
    
    if (data.categoria === 'geral_anual' && data.ano > 0) {
      return data.posicao === 2 
        ? DESCRICOES_PREMIACAO.medalha_prata 
        : DESCRICOES_PREMIACAO.medalha_bronze
    }
    
    return DESCRICOES_PREMIACAO.medalha_categoria
  }

  /**
   * Converte número para superscript (números altos)
   */
  private converterParaNumeroAlto(numero: number): string {
    const superscripts = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
    return numero.toString().split('').map(digit => superscripts[parseInt(digit)]).join('')
  }

  /**
   * Agrupa premiações por tipo e cor para exibição compacta
   */
  agruparPremiacoesPorTipo(premiacoes: PremiacoesDeputado): PremiacaoAgrupada[] {
    const visuais = this.converterPremiacoesParaVisuais(premiacoes)
    const grupos: { [key: string]: PremiacaoVisual[] } = {}
    
    // Agrupar por tipo, subtipo e cor
    visuais.forEach(visual => {
      const chave = `${visual.tipo}-${visual.subtipo}-${visual.cor}`
      if (!grupos[chave]) {
        grupos[chave] = []
      }
      grupos[chave].push(visual)
    })
    
    // Converter para formato agrupado
    const agrupadas: PremiacaoAgrupada[] = []
    
    for (const [chave, premiacoesGrupo] of Object.entries(grupos)) {
      const primeira = premiacoesGrupo[0]
      const quantidade = premiacoesGrupo.length
      
      // Determinar descrição baseada no tipo e quantidade
      let descricaoAgrupada = primeira.descricao
      if (quantidade > 1) {
        if (primeira.tipo === 'coroa') {
          descricaoAgrupada = primeira.subtipo === 'geral' 
            ? `Coroas Gerais` 
            : `Coroas de Categoria`
        } else if (primeira.tipo === 'trofeu') {
          descricaoAgrupada = primeira.subtipo === 'geral' 
            ? `Troféus Gerais` 
            : `Troféus de Categoria`
        } else {
          descricaoAgrupada = primeira.subtipo === 'geral' 
            ? `Medalhas Gerais` 
            : `Medalhas de Categoria`
        }
      }
      
      agrupadas.push({
        tipo: primeira.tipo,
        subtipo: primeira.subtipo,
        emoji: primeira.emoji,
        cor: primeira.cor,
        descricao: descricaoAgrupada,
        quantidade,
        premiacoes: premiacoesGrupo,
        numeroAlto: quantidade > 1 ? this.converterParaNumeroAlto(quantidade) : ''
      })
    }
    
    // Ordenar por prioridade: coroas > troféus > medalhas, depois geral > categoria
    return agrupadas.sort((a, b) => {
      const ordemTipo = { coroa: 0, trofeu: 1, medalha: 2 }
      const ordemSubtipo = { geral: 0, categoria: 1 }
      
      if (ordemTipo[a.tipo] !== ordemTipo[b.tipo]) {
        return ordemTipo[a.tipo] - ordemTipo[b.tipo]
      }
      
      if (ordemSubtipo[a.subtipo] !== ordemSubtipo[b.subtipo]) {
        return ordemSubtipo[a.subtipo] - ordemSubtipo[b.subtipo]
      }
      
      return b.quantidade - a.quantidade
    })
  }

  /**
   * Converte premiações para formato visual (para badges)
   */
  converterPremiacoesParaVisuais(premiacoes: PremiacoesDeputado): PremiacaoVisual[] {
    const visuais: PremiacaoVisual[] = []

    // Converter coroas
    premiacoes.coroas.forEach(coroa => {
      const valor = (typeof coroa.valor === 'number' && !isNaN(coroa.valor)) ? coroa.valor : 0
      console.log(`👑 [DEBUG] Convertendo coroa: valor=${coroa.valor} -> ${valor}`, coroa)
      
      visuais.push({
        tipo: 'coroa',
        subtipo: coroa.tipo,
        emoji: EMOJIS_PREMIACAO.coroa,
        cor: coroa.tipo === 'geral' ? CORES_PREMIACAO.coroa_geral : CORES_PREMIACAO.coroa_categoria,
        descricao: coroa.descricao || DESCRICOES_PREMIACAO.coroa_geral,
        categoria: coroa.categoria,
        valor: valor
      })
    })

    // Converter troféus
    premiacoes.trofeus.forEach(trofeu => {
      const valor = (typeof trofeu.valor === 'number' && !isNaN(trofeu.valor)) ? trofeu.valor : 0
      console.log(`🏆 [DEBUG] Convertendo troféu: valor=${trofeu.valor} -> ${valor}`, trofeu)
      
      visuais.push({
        tipo: 'trofeu',
        subtipo: trofeu.tipo,
        emoji: EMOJIS_PREMIACAO.trofeu,
        cor: trofeu.tipo === 'geral' ? CORES_PREMIACAO.trofeu_geral : CORES_PREMIACAO.trofeu_categoria,
        descricao: trofeu.descricao || DESCRICOES_PREMIACAO.trofeu_geral,
        categoria: trofeu.categoria,
        ano: trofeu.ano,
        valor: valor,
        posicao: trofeu.posicao
      })
    })

    // Converter medalhas
    premiacoes.medalhas.forEach(medalha => {
      let cor = CORES_PREMIACAO.medalha_categoria
      
      if (medalha.categoria === 'geral_historico') {
        cor = CORES_PREMIACAO.medalha_geral_historico
      } else if (medalha.categoria === 'geral_anual') {
        cor = medalha.posicao === 2 ? CORES_PREMIACAO.medalha_prata : CORES_PREMIACAO.medalha_bronze
      } else if (medalha.tipo === 'categoria' && medalha.categoria !== 'geral_historico' && medalha.categoria !== 'geral_anual') {
        // Medalhas de categoria específica com cores especiais
        cor = medalha.posicao === 2 ? CORES_PREMIACAO.medalha_prata_categoria : CORES_PREMIACAO.medalha_bronze_categoria
      }

      const valor = (typeof medalha.valor === 'number' && !isNaN(medalha.valor)) ? medalha.valor : 0
      console.log(`🎖️ [DEBUG] Convertendo medalha: valor=${medalha.valor} -> ${valor}`, medalha)
      
      visuais.push({
        tipo: 'medalha',
        subtipo: medalha.tipo,
        emoji: EMOJIS_PREMIACAO.medalha,
        cor,
        descricao: medalha.descricao || DESCRICOES_PREMIACAO.medalha_categoria,
        categoria: medalha.categoria,
        ano: medalha.ano,
        valor: valor,
        posicao: medalha.posicao
      })
    })

    return visuais
  }

  /**
   * Gera badges HTML para cards de deputados
   */
  gerarBadgesDeputado(premiacoes: PremiacoesDeputado, maxBadges: number = 3): string {
    const visuais = this.converterPremiacoesParaVisuais(premiacoes)
    const badges = visuais.slice(0, maxBadges)
    
    if (badges.length === 0) return ''

    return badges.map(badge => `
      <div 
        class="flex items-center justify-center w-8 h-8 rounded-full text-sm bg-gradient-to-r ${badge.cor}"
        title="${badge.descricao}${badge.categoria ? ` - ${badge.categoria}` : ''}${badge.ano ? ` (${badge.ano})` : ''}"
      >
        ${badge.emoji}
      </div>
    `).join('')
  }

  /**
   * Gera banner para perfil do deputado
   */
  gerarBannerPerfil(premiacoes: PremiacoesDeputado): string {
    if (premiacoes.totalPremiacoes === 0) return ''

    const visuais = this.converterPremiacoesParaVisuais(premiacoes)
    
    return `
      <div class="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-4 rounded-lg mb-6">
        <div class="flex items-center gap-3">
          <div class="text-2xl">🏆</div>
          <div>
            <h3 class="font-bold text-lg">Deputado Premiado</h3>
            <p class="text-sm opacity-90">
              ${premiacoes.coroas.length} coroas, ${premiacoes.trofeus.length} troféus, ${premiacoes.medalhas.length} medalhas
            </p>
          </div>
          <div class="flex gap-2 ml-auto">
            ${visuais.slice(0, 5).map(v => `
              <div class="bg-white/20 p-2 rounded-full text-lg">${v.emoji}</div>
            `).join('')}
          </div>
        </div>
      </div>
    `
  }

  /**
   * Verifica se deputado tem coroa específica
   */
  temCoroa(deputadoId: string, tipo?: 'geral' | 'categoria'): boolean {
    const cached = this.cache.get(`premiacoes_${deputadoId}`)
    if (!cached) return false
    
    if (!tipo) return cached.coroas.length > 0
    return cached.coroas.some(coroa => coroa.tipo === tipo)
  }

  /**
   * Verifica se deputado tem troféu específico
   */
  temTrofeu(deputadoId: string, ano?: number, tipo?: 'geral' | 'categoria'): boolean {
    const cached = this.cache.get(`premiacoes_${deputadoId}`)
    if (!cached) return false
    
    return cached.trofeus.some(trofeu => {
      if (ano && trofeu.ano !== ano) return false
      if (tipo && trofeu.tipo !== tipo) return false
      return true
    })
  }

  /**
   * Obter ranking de deputados mais premiados
   */
  async obterRankingPremiados(limite: number = 10): Promise<PremiacoesDeputado[]> {
    // Buscar todos os deputados com premiações
    const todosPremiados: PremiacoesDeputado[] = []
    
    try {
      // Buscar IDs únicos de deputados premiados
      const deputadosIds = new Set<string>()
      
      const [coroasSnapshot, trofeusSnapshot, medalhasSnapshot] = await Promise.all([
        getDocs(collection(db, 'premiacoes_coroas')),
        getDocs(collection(db, 'premiacoes_trofeus')),
        getDocs(collection(db, 'premiacoes_medalhas'))
      ])
      
      coroasSnapshot.forEach(doc => deputadosIds.add(doc.data().deputadoId))
      trofeusSnapshot.forEach(doc => deputadosIds.add(doc.data().deputadoId))
      medalhasSnapshot.forEach(doc => deputadosIds.add(doc.data().deputadoId))
      
      // Buscar premiações de cada deputado
      for (const deputadoId of Array.from(deputadosIds)) {
        const premiacoes = await this.buscarPremiacoesDeputado(deputadoId)
        if (premiacoes.totalPremiacoes > 0) {
          todosPremiados.push(premiacoes)
        }
      }
      
      // Ordenar por total de premiações
      return todosPremiados
        .sort((a, b) => b.totalPremiacoes - a.totalPremiacoes)
        .slice(0, limite)
        
    } catch (error) {
      console.error('❌ [Deputado Premiação] Erro ao obter ranking premiados:', error)
      return []
    }
  }

  /**
   * Limpar cache
   */
  limparCache(): void {
    this.cache.clear()
    console.log('🗑️ [Deputado Premiação] Cache limpo')
  }

  // Método removido - usar formatarCategoria de @/lib/categoria-formatter

  /**
   * Formatar valor monetário
   */
  formatarMoeda(valor: number): string {
    // Validar se o valor é um número válido
    if (typeof valor !== 'number' || isNaN(valor) || valor === null || valor === undefined) {
      console.warn('⚠️ [formatarMoeda] Valor inválido recebido:', valor, 'usando 0 como fallback')
      valor = 0
    }
    
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(valor)
  }
}

// ===== EXPORT DA INSTÂNCIA =====

export const deputadoPremiacaoUnificado = new DeputadoPremiacaoUnificado()

// ===== FUNÇÕES UTILITÁRIAS =====

/**
 * Hook para uso em componentes React
 */
export function useDeputadoPremiacao(deputadoId: string) {
  const [premiacoes, setPremiacoes] = React.useState<PremiacoesDeputado | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!deputadoId) return

    const carregarPremiacoes = async () => {
      try {
        setLoading(true)
        setError(null)
        const result = await deputadoPremiacaoUnificado.buscarPremiacoesDeputado(deputadoId)
        setPremiacoes(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido')
        console.error('❌ Hook useDeputadoPremiacao:', err)
      } finally {
        setLoading(false)
      }
    }

    carregarPremiacoes()
  }, [deputadoId])

  const carregarPremiacoes = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await deputadoPremiacaoUnificado.buscarPremiacoesDeputado(deputadoId)
      setPremiacoes(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
      console.error('❌ Hook useDeputadoPremiacao:', err)
    } finally {
      setLoading(false)
    }
  }

  return { premiacoes, loading, error, refetch: carregarPremiacoes }
}

export default deputadoPremiacaoUnificado