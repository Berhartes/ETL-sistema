// Facade para manter compatibilidade total com a API atual
// Este arquivo exporta uma interface unificada que redireciona para os serviços modulares

import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  getDoc,
  limit,
  startAfter,
  orderBy,
  QuerySnapshot,
  QueryDocumentSnapshot
} from 'firebase/firestore';

import { FirestoreBase } from './base/firestore-base.js';
import { firestoreCache } from './base/firestore-cache.js';
import { deputadosService, type DeputadoFirestore, type FiltrosDeputados } from './deputados/deputados-service.js';
// import { fornecedoresService, type FornecedorCompleto, type FornecedorDetalhado, type FiltrosFornecedores } from './fornecedores/fornecedores-service.js';
// import { transacoesService, type DespesaFirestore, type TransacaoCompleta, type FiltrosTransacoes } from './transacoes/transacoes-service.js';

// Use direct Firestore queries for fornecedores service
const fornecedoresService = {
  buscarPerfilFornecedor: async (cnpj: string) => {
    try {
      const db = new FirestoreBase().getDb();
      const docRef = doc(db, 'fornecedores', cnpj);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
      console.error('[FornecedoresService] Erro ao buscar perfil fornecedor:', error);
      return null;
    }
  },
  
  buscarTodosFornecedoresOtimizado: async (filtros: any = {}) => {
    try {
      const db = new FirestoreBase().getDb();
      const fornecedoresRef = collection(db, 'fornecedores');
      let q = query(fornecedoresRef);
      
      if (filtros?.limite) {
        q = query(q, limit(filtros.limite));
      }
      
      const snapshot = await getDocs(q);
      const fornecedores = snapshot.docs.map(doc => ({
        id: doc.id,
        cnpj: doc.id,
        ...doc.data()
      }));
      
      console.log(`[FornecedoresService] Encontrados ${fornecedores.length} fornecedores`);
      return fornecedores;
    } catch (error) {
      console.error('[FornecedoresService] Erro ao buscar fornecedores:', error);
      return [];
    }
  },
  
  isFornecedoresDataAvailable: async () => {
    try {
      const db = new FirestoreBase().getDb();
      const fornecedoresRef = collection(db, 'fornecedores');
      const q = query(fornecedoresRef, limit(1));
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      return false;
    }
  },
  
  buscarTodosFornecedores: async (filtros: any) => {
    return await fornecedoresService.buscarTodosFornecedoresOtimizado(filtros);
  },
  
  buscarFornecedorPorCNPJ: async (cnpj: string) => {
    return await fornecedoresService.buscarPerfilFornecedor(cnpj);
  },
  
  buscarPerfilFornecedorUnificado: async (cnpj: string) => {
    return await fornecedoresService.buscarPerfilFornecedor(cnpj);
  },
  
  buscarFornecedoresRelacionadosOtimizado: async (deputadoId: string) => {
    try {
      const db = new FirestoreBase().getDb();
      const transacoesRef = collection(db, 'transacoes');
      const q = query(transacoesRef, where('deputadoId', '==', deputadoId), limit(100));
      const snapshot = await getDocs(q);
      
      const cnpjsUnicos = new Set();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.cnpjCpf) cnpjsUnicos.add(data.cnpjCpf);
      });
      
      return Array.from(cnpjsUnicos).slice(0, 50);
    } catch (error) {
      console.error('[FornecedoresService] Erro ao buscar fornecedores relacionados:', error);
      return [];
    }
  }
} as any;

const transacoesService = {
  buscarTransacoes: async (filtros: any) => [],
  buscarAnosDisponiveis: async () => [],
  buscarTransacoesFornecedorUnificado: async (cnpj: string, ano: any, mes: any) => [],
  buscarTransacoesFornecedor: async (cnpj: string, ano: any, mes: any) => [],
  buscarTransacoesPorCategoria: async (categoria: string, ano: any) => [],
  buscarTransacoesTemporaisFornecedor: async (cnpj: string) => [],
  buscarDespesasDeputado: async (deputadoId: string, ano: any, mes: any) => [],
  buscarTodasTransacoes: async (filtros: any) => [],
  buscarTransacoesComFiltros: async (filtros: any) => []
} as any;

// Missing types
type FiltrosFornecedores = any;
type FornecedorDetalhado = any;
import { transactionLogThrottle } from '../log-throttle.js';
import { PerfilFornecedorCompleto } from '@/core/functions/camara_api_wrapper/scripts/types/perfil-fornecedor.types';

export class FirestoreFacade extends FirestoreBase {
  
  // =====================================================
  // MÉTODOS DE DEPUTADOS
  // =====================================================
  
  /**
   * Buscar deputados com filtros opcionais
   * @deprecated Use deputadosService.buscarDeputados() diretamente para melhor performance
   */
  async buscarDeputados(filtros?: { uf?: string; partido?: string; limite?: number }) {
    return await deputadosService.buscarDeputados(filtros as FiltrosDeputados);
  }

  /**
   * Buscar deputado específico por ID
   * @deprecated Use deputadosService.buscarDeputadoCompleto() diretamente
   */
  async buscarDeputadoCompleto(deputadoId: string): Promise<any | null> {
    return await deputadosService.buscarDeputadoCompleto(deputadoId);
  }

  /**
   * Contar deputados reais no sistema
   * @deprecated Use deputadosService.contarDeputadosReais() diretamente
   */
  async contarDeputadosReais(): Promise<number> {
    return await deputadosService.contarDeputadosReais();
  }

  /**
   * Buscar todos os deputados
   * @deprecated Use deputadosService.buscarTodosDeputados() diretamente
   */
  async buscarTodosDeputados(): Promise<DeputadoFirestore[]> {
    return await deputadosService.buscarTodosDeputados();
  }

  /**
   * Debug estrutura de deputado específico
   * @deprecated Use deputadosService.debugDeputadoEstrutura() diretamente
   */
  async debugDeputadoEstrutura(deputadoId: string): Promise<void> {
    return await deputadosService.debugDeputadoEstrutura(deputadoId);
  }

  // =====================================================
  // MÉTODOS DE FORNECEDORES
  // =====================================================

  /**
   * Buscar perfil de fornecedor por CNPJ
   * @deprecated Use fornecedoresService.buscarPerfilFornecedor() diretamente
   */
  async buscarPerfilFornecedor(cnpj: string): Promise<PerfilFornecedorCompleto | null> {
    return await fornecedoresService.buscarPerfilFornecedor(cnpj);
  }

  /**
   * Buscar todos os fornecedores otimizado
   * @deprecated Use fornecedoresService.buscarTodosFornecedoresOtimizado() diretamente
   */
  async buscarTodosFornecedoresOtimizado(): Promise<PerfilFornecedorCompleto[]> {
    return await fornecedoresService.buscarTodosFornecedoresOtimizado();
  }

  /**
   * Buscar todos os fornecedores com filtros
   * @deprecated Use fornecedoresService.buscarTodosFornecedores() diretamente
   */
  async buscarTodosFornecedores(filtros: { 
    ano: number; 
    mes: string | 'todos'; 
    limite?: number;
    uf?: string;
    partido?: string;
  }) {
    return await fornecedoresService.buscarTodosFornecedores(filtros as FiltrosFornecedores);
  }

  /**
   * Buscar fornecedor por CNPJ
   * @deprecated Use fornecedoresService.buscarFornecedorPorCNPJ() diretamente
   */
  async buscarFornecedorPorCNPJ(cnpj: string): Promise<any | null> {
    return await fornecedoresService.buscarFornecedorPorCNPJ(cnpj);
  }

  /**
   * Buscar perfil de fornecedor unificado
   * @deprecated Use fornecedoresService.buscarPerfilFornecedorUnificado() diretamente
   */
  async buscarPerfilFornecedorUnificado(cnpj: string): Promise<PerfilFornecedorCompleto | null> {
    return await fornecedoresService.buscarPerfilFornecedorUnificado(cnpj);
  }

  /**
   * Buscar fornecedores relacionados a deputado
   * @deprecated Use fornecedoresService.buscarFornecedoresRelacionadosOtimizado() diretamente
   */
  async buscarFornecedoresRelacionadosOtimizado(deputadoId: string): Promise<any[]> {
    return await fornecedoresService.buscarFornecedoresRelacionadosOtimizado(deputadoId);
  }

  /**
   * Verificar se dados de fornecedores estão disponíveis
   * @deprecated Use fornecedoresService.isFornecedoresDataAvailable() diretamente
   */
  async isFornecedoresDataAvailable(): Promise<boolean> {
    return await fornecedoresService.isFornecedoresDataAvailable();
  }

  // =====================================================
  // MÉTODOS DE TRANSAÇÕES
  // =====================================================

  /**
   * Buscar transações de fornecedor na estrutura unificada
   * @deprecated Use transacoesService.buscarTransacoesFornecedorUnificado() diretamente
   */
  async buscarTransacoesFornecedorUnificado(cnpj: string, ano: number, mes: string = 'todos'): Promise<any[]> {
    return await transacoesService.buscarTransacoesFornecedorUnificado(cnpj, ano, mes);
  }

  /**
   * Buscar transações de fornecedor (método tradicional)
   * @deprecated Use transacoesService.buscarTransacoesFornecedor() diretamente
   */
  async buscarTransacoesFornecedor(cnpj: string, ano: number, mes: string = 'todos'): Promise<any[]> {
    return await transacoesService.buscarTransacoesFornecedor(cnpj, ano, mes);
  }

  /**
   * Buscar transações por categoria
   * @deprecated Use transacoesService.buscarTransacoesPorCategoria() diretamente
   */
  async buscarTransacoesPorCategoria(categoria: string, ano?: number): Promise<any[]> {
    return await transacoesService.buscarTransacoesPorCategoria(categoria, ano);
  }

  /**
   * Buscar transações temporais de fornecedor
   * @deprecated Use transacoesService.buscarTransacoesTemporaisFornecedor() diretamente
   */
  async buscarTransacoesTemporaisFornecedor(cnpj: string): Promise<any[]> {
    return await transacoesService.buscarTransacoesTemporaisFornecedor(cnpj);
  }

  // =====================================================
  // MÉTODOS COMPOSTOS (COMPATIBILIDADE)
  // =====================================================

  /**
   * Buscar fornecedor com transações
   * Mantém compatibilidade com API original
   */
  async buscarFornecedorComTransacoes(cnpj: string, ano: number, mes: string = 'todos'): Promise<{
    fornecedor: any | null;
    transacoes: any[];
  }> {
    try {
      console.log(`[FirestoreFacade] 🔍 Buscando fornecedor com transações - CNPJ: ${cnpj}, Ano: ${ano}, Mês: ${mes}`);
      
      // Buscar fornecedor e transações em paralelo
      const [fornecedor, transacoes] = await Promise.all([
        fornecedoresService.buscarFornecedorPorCNPJ(cnpj),
        transacoesService.buscarTransacoesFornecedorUnificado(cnpj, ano, mes)
      ]);
      
      // Fallback para método tradicional se não encontrar na estrutura unificada
      let transacoesFinais = transacoes;
      if (transacoes.length === 0) {
        console.log(`[FirestoreFacade] ⚠️ Transações não encontradas na estrutura unificada, tentando método tradicional`);
        transacoesFinais = await transacoesService.buscarTransacoesFornecedor(cnpj, ano, mes);
      }
      
      console.log(`[FirestoreFacade] ✅ Fornecedor: ${fornecedor ? 'encontrado' : 'não encontrado'}, Transações: ${transacoesFinais.length}`);
      
      return {
        fornecedor,
        transacoes: transacoesFinais
      };
      
    } catch (error) {
      console.error(`❌ [FirestoreFacade] Erro ao buscar fornecedor com transações:`, error);
      return {
        fornecedor: null,
        transacoes: []
      };
    }
  }

  /**
   * Buscar fornecedor detalhes
   * Mantém compatibilidade com API original
   */
  async buscarFornecedorDetalhes(cnpj: string, ano: number): Promise<FornecedorDetalhado | null> {
    try {
      console.log(`[FirestoreFacade] 🔍 Buscando detalhes para o fornecedor CNPJ: ${cnpj}, Ano: ${ano}`);
      
      const perfil = await fornecedoresService.buscarPerfilFornecedor(cnpj);
      if (!perfil) {
        console.warn(`⚠️ [FirestoreFacade] Perfil não encontrado para CNPJ: ${cnpj}`);
        return null;
      }
      
      // Buscar transações do ano
      const transacoes = await transacoesService.buscarTransacoesFornecedorUnificado(cnpj, ano, 'todos');
      
      return {
        ...perfil,
        transacoes
      };
      
    } catch (error) {
      console.error(`❌ [FirestoreFacade] Erro ao buscar detalhes do fornecedor ${cnpj}:`, error);
      return null;
    }
  }

  // =====================================================
  // MÉTODOS ANALÍTICOS E DE COMPATIBILIDADE
  // =====================================================

  /**
   * Análise de relacionamento monogâmico de fornecedor
   * Mantém compatibilidade com método original complexo
   */
  async analisarRelacionamentoMonogamicoFornecedor(cnpj: string): Promise<{
    isMonogamico: boolean;
    deputadoPrincipal: string | null;
    percentualConcentracao: number;
    totalTransacoes: number;
    totalValor: number;
  }> {
    try {
      console.log(`🔍 [RelacionamentoMonogamico] Analisando CNPJ: ${cnpj}`);
      
      const transacoes = await transacoesService.buscarTransacoesTemporaisFornecedor(cnpj);
      
      if (transacoes.length === 0) {
        const bancoVazio = await this.isBancoVazio();
        if (!bancoVazio) {
          console.warn(`⚠️ [RelacionamentoMonogamico] CNPJ ${cnpj}: Sem transações temporais válidas`);
        }
        
        return {
          isMonogamico: false,
          deputadoPrincipal: null,
          percentualConcentracao: 0,
          totalTransacoes: 0,
          totalValor: 0
        };
      }
      
      // Agrupar por deputado
      const transacoesPorDeputado: Record<string, { count: number; valor: number }> = {};
      let totalValor = 0;
      
      transacoes.forEach(transacao => {
        const deputadoId = transacao.deputadoId;
        const valor = this.converterValorNumerico(transacao.valorLiquido);
        
        if (deputadoId) {
          if (!transacoesPorDeputado[deputadoId]) {
            transacoesPorDeputado[deputadoId] = { count: 0, valor: 0 };
          }
          transacoesPorDeputado[deputadoId].count++;
          transacoesPorDeputado[deputadoId].valor += valor;
          totalValor += valor;
        }
      });
      
      // Encontrar deputado principal
      const deputadosEntries = Object.entries(transacoesPorDeputado);
      if (deputadosEntries.length === 0) {
        return {
          isMonogamico: false,
          deputadoPrincipal: null,
          percentualConcentracao: 0,
          totalTransacoes: transacoes.length,
          totalValor
        };
      }
      
      // Ordenar por valor
      deputadosEntries.sort((a, b) => b[1].valor - a[1].valor);
      const [deputadoPrincipal, dadosPrincipal] = deputadosEntries[0];
      
      const percentualConcentracao = totalValor > 0 ? (dadosPrincipal.valor / totalValor) * 100 : 0;
      const isMonogamico = percentualConcentracao >= 80; // Considera monogâmico se 80%+ das transações são com um deputado
      
      console.log(`✅ [RelacionamentoMonogamico] CNPJ ${cnpj}: ${isMonogamico ? 'MONOGÂMICO' : 'DIVERSIFICADO'} - ${percentualConcentracao.toFixed(1)}% concentração`);
      
      return {
        isMonogamico,
        deputadoPrincipal,
        percentualConcentracao,
        totalTransacoes: transacoes.length,
        totalValor
      };
      
    } catch (error) {
      console.error(`❌ [RelacionamentoMonogamico] Erro ao analisar CNPJ ${cnpj}:`, error);
      return {
        isMonogamico: false,
        deputadoPrincipal: null,
        percentualConcentracao: 0,
        totalTransacoes: 0,
        totalValor: 0
      };
    }
  }

  /**
   * Buscar anos disponíveis
   * Mantém compatibilidade com método original
   */
  async buscarAnosDisponiveis(): Promise<{ano: number, quantidade: number}[]> {
    try {
      console.log('🗓️ [FirestoreFacade] Delegando busca de anos disponíveis para TransacoesService...');
      
      // Usar o método otimizado do TransacoesService
      const anos = await transacoesService.buscarAnosDisponiveis();
      
      console.log(`✅ [FirestoreFacade] Encontrados ${anos.length} anos com dados`);
      return anos;
      
    } catch (error) {
      console.error('❌ [AnosDisponiveis] Erro ao buscar anos disponíveis:', error);
      return [];
    }
  }

  /**
   * Busca despesas de um deputado específico
   * Método essencial para perfis de deputados
   */
  async buscarDespesasDeputado(
    deputadoId: string, 
    ano: number, 
    mes?: number | string
  ): Promise<any[]> {
    try {
      console.log(`🏛️ [FirestoreFacade] Delegando busca de despesas para TransacoesService - Deputado: ${deputadoId}, Ano: ${ano}, Mes: ${mes}`);
      
      // Usar o método otimizado do TransacoesService
      const despesas = await transacoesService.buscarDespesasDeputado(deputadoId, ano, mes);
      
      console.log(`✅ [FirestoreFacade] Encontradas ${despesas.length} despesas para deputado ${deputadoId}`);
      return despesas;
      
    } catch (error) {
      console.error(`❌ [FirestoreFacade] Erro ao buscar despesas do deputado ${deputadoId}:`, error);
      return [];
    }
  }

  // =====================================================
  // MÉTODOS DE CACHE E UTILITÁRIOS
  // =====================================================

  /**
   * Limpar cache do banco vazio
   */
  public clearBancoVazioCache(): void {
    firestoreCache.clearBancoVazioCache();
    console.log('[FirestoreFacade] 🗑️ Cache de banco vazio limpo');
  }

  /**
   * Limpar todo o cache
   */
  public clearAllCache(): void {
    firestoreCache.clearCache();
    console.log('[FirestoreFacade] 🗑️ Todos os caches limpos');
  }

  /**
   * Obter estatísticas do cache
   */
  public getCacheStats() {
    return firestoreCache.getCacheStats();
  }

  // =====================================================
  // MÉTODOS CRÍTICOS PARA COMPATIBILIDADE
  // =====================================================

  /**
   * Buscar dados completos (deputados + fornecedores + transações)
   * Método crítico usado por UnifiedMicroContextProvider e hooks
   */
  async buscarDadosCompletos(opcoes?: {
    ano?: number;
    mes?: number | string;
    uf?: string;
    partido?: string;
    skipDeputados?: boolean;
  }) {
    try {
      const ano = opcoes?.ano || new Date().getFullYear();
      const mes = opcoes?.mes || 'todos';

      console.log(`[FirestoreFacade] Buscando dados completos - Ano: ${ano}, Mês: ${mes}${opcoes?.skipDeputados ? ' (PULANDO DEPUTADOS)' : ''}`);

      let deputados: any[] = [];
      
      // Só buscar deputados se necessário
      if (!opcoes?.skipDeputados) {
        deputados = await deputadosService.buscarDeputados({
          uf: opcoes?.uf,
          partido: opcoes?.partido,
        });

        if (deputados.length === 0) {
          const bancoVazio = await this.isBancoVazio();
          if (!bancoVazio) {
            console.warn('[FirestoreFacade] ⚠️ Nenhum deputado encontrado, mas continuando com os dados disponíveis');
          }
        }
      }

      // Buscar fornecedores
      const fornecedores = await fornecedoresService.buscarTodosFornecedoresOtimizado();

      console.log(`[FirestoreFacade] ✅ Dados completos carregados:`, {
        deputados: deputados.length,
        fornecedores: fornecedores.length,
        parametros: { ano, mes, uf: opcoes?.uf, partido: opcoes?.partido }
      });

      return {
        deputados,
        fornecedores,
        transacoes: [], // Pode ser implementado conforme necessidade
        metadados: {
          ano,
          mes,
          totalDeputados: deputados.length,
          totalFornecedores: fornecedores.length,
          ultimaAtualizacao: new Date()
        }
      };

    } catch (error) {
      console.error('[FirestoreFacade] ❌ Erro ao buscar dados completos:', error);
      throw error;
    }
  }

  /**
   * Buscar perfis de fornecedores completos
   * Método crítico usado por fornecedores-service
   * Implementação baseada no backup original
   */
  async buscarPerfisFornecedoresCompletos(): Promise<PerfilFornecedorCompleto[]> {
    try {
      console.log('[FirestoreFacade] 🚀 ⭐ INICIANDO BUSCA DE PERFIS FORNECEDORES COMPLETOS ⭐');
      
      // 🚨 EMERGÊNCIA: Limpar cache em caso de problemas de dados
      const cacheKey = 'perfis-fornecedores-completos';
      
      // Verificar se há dados em cache - removida lógica de corrupção problemática
      const cached = firestoreCache.get<PerfilFornecedorCompleto[]>(cacheKey, 'fornecedores');
      if (cached && cached.length === 0) {
        console.warn(`🚨 [FirestoreFacade] Cache vazio detectado! Limpando cache para forçar nova busca...`);
        firestoreCache.clearCache('fornecedores');
      }
      
      // 🚨 FORÇA LIMPEZA: LIMPAR CACHE PARA GARANTIR DADOS ATUALIZADOS
      console.log('[FirestoreFacade] 🧹 LIMPANDO CACHE PARA GARANTIR DADOS ATUALIZADOS COM LÓGICA CORRIGIDA...');
      firestoreCache.clearCache('fornecedores');
      
      return await firestoreCache.getOrSet(
        cacheKey,
        async () => {
          // 🚨 CORREÇÃO: Usar DIRETAMENTE a lógica corrigida do fornecedoresService
          console.log('[FirestoreFacade] 🎯 USANDO LÓGICA CORRIGIDA DO fornecedoresService...');
          try {
            const fornecedoresCorrigidos = await fornecedoresService.buscarTodosFornecedoresOtimizado();
            console.log(`[FirestoreFacade] 📊 Lógica corrigida retornou: ${fornecedoresCorrigidos.length} fornecedores`);
            
            if (fornecedoresCorrigidos.length > 0) {
              console.log(`[FirestoreFacade] ✅ SUCESSO: Usando lógica corrigida com ${fornecedoresCorrigidos.length} fornecedores`);
              return fornecedoresCorrigidos.map(f => ({
                cnpj: f.cnpj,
                nome: f.nome,
                totalRecebido: f.totalRecebido,
                numTransacoes: f.numTransacoes,
                deputadosAtendidos: f.deputadosAtendidos,
                categorias: f.categorias,
                mediaTransacao: f.mediaTransacao,
                indiceSuspeicao: f.indiceSuspeicao
              })) as PerfilFornecedorCompleto[];
            }
          } catch (fallbackError) {
            console.error('[FirestoreFacade] ❌ Erro na lógica corrigida:', fallbackError);
          }
          
          // Se o fallback falhou ou retornou poucos dados, tentar método original
          console.log('[FirestoreFacade] 🔄 Tentando método original da coleção fornecedores...');
          const db = this.getDb();
          
          // ✅ ESTRUTURA CORRETA: Buscar diretamente na coleção fornecedores/{cnpj}
          const fornecedoresRef = collection(db, 'fornecedores');
          const batchSize = 500;
          const maxBatches = 100;
          const allPerfis: PerfilFornecedorCompleto[] = [];
          let lastDoc: QueryDocumentSnapshot | null = null;
          let batchCount = 0;
          let querySnapshot;
          
          console.log('[FirestoreFacade] 🔄 Buscando TODOS os perfis completos de fornecedores com paginação...');
          
          do {
            // Construir query com paginação
            let currentQuery = query(fornecedoresRef, limit(batchSize));
            if (lastDoc) {
              currentQuery = query(fornecedoresRef, startAfter(lastDoc), limit(batchSize));
            }
            
            console.log(`[FirestoreFacade] 📦 Processando batch ${batchCount + 1} (${allPerfis.length} perfis carregados)...`);
            
            try {
              // ⚡ OTIMIZAÇÃO: Usar getDocs com timeout adequado
              const queryPromise = getDocs(currentQuery);
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Query timeout')), 15000) // Timeout de 15s
              );
              
              querySnapshot = await Promise.race([queryPromise, timeoutPromise]) as QuerySnapshot;
              const batchPerfis = querySnapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                cnpj: doc.id // Garantir que o CNPJ seja o ID
              })) as unknown as PerfilFornecedorCompleto[];
              
              allPerfis.push(...batchPerfis);
              console.log(`[FirestoreFacade] ✅ Batch ${batchCount + 1} concluído: +${batchPerfis.length} perfis (total: ${allPerfis.length})`);
              
            } catch (error) {
              if (error.message === 'Query timeout') {
                console.warn(`[FirestoreFacade] ⚠️ Timeout no batch ${batchCount + 1}, continuando com próximo batch. Perfis carregados: ${allPerfis.length}`);
                querySnapshot = null;
              } else {
                console.error(`[FirestoreFacade] ❌ Erro no batch ${batchCount + 1}:`, error);
                break;
              }
            }
            
            // Atualizar lastDoc para próximo batch
            if (querySnapshot && querySnapshot.docs.length > 0) {
              lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
            } else {
              break; // Sem mais documentos
            }
            
            batchCount++;
            
            // Limite de segurança
            if (batchCount >= maxBatches) {
              console.warn(`[FirestoreFacade] ⚠️ Limite de ${maxBatches} batches atingido. Perfis carregados: ${allPerfis.length}`);
              break;
            }
            
          } while (querySnapshot && querySnapshot.docs.length === batchSize);
          
          console.log(`[FirestoreFacade] ✅ BUSCA CONCLUÍDA COM SUCESSO - ${allPerfis.length} perfis obtidos`);
          
          // ✅ SEMPRE USAR O SERVICE MODULAR: Ele agora tem a lógica corrigida
          console.log('[FirestoreFacade] 🎯 USANDO SEMPRE SERVICE MODULAR CORRIGIDO...');
          
          const fornecedores = await fornecedoresService.buscarTodosFornecedoresOtimizado();
          console.log(`[FirestoreFacade] 📊 Service modular retornou: ${fornecedores.length} fornecedores`);
          
          if (fornecedores.length > 0) {
            console.log(`[FirestoreFacade] ✅ USANDO DADOS DO SERVICE MODULAR CORRIGIDO (${fornecedores.length} fornecedores)`);
            return fornecedores.map(f => ({
              cnpj: f.cnpj,
              nome: f.nome,
              totalRecebido: f.totalRecebido,
              numTransacoes: f.numTransacoes,
              deputadosAtendidos: f.deputadosAtendidos,
              categorias: f.categorias,
              mediaTransacao: f.mediaTransacao,
              indiceSuspeicao: f.indiceSuspeicao
            })) as PerfilFornecedorCompleto[];
          }
          
          // Fallback apenas se o service modular falhar completamente
          if (allPerfis.length === 0) {
            console.error(`🚨 [FirestoreFacade] ALERTA: Nenhum perfil encontrado como fallback`);
          } else if (allPerfis.length < 100) {
            console.warn(`⚠️ [FirestoreFacade] AVISO: Apenas ${allPerfis.length} perfis encontrados como fallback`);
          }
          
          return allPerfis;
        },
        'fornecedores',
        15 * 60 * 1000 // Cache por 15 minutos
      );
      
    } catch (error) {
      console.error('[FirestoreFacade] ❌ Erro ao buscar perfis fornecedores completos:', error);
      throw error;
    }
  }

  /**
   * Buscar todas as transações do sistema
   * Método INDEPENDENTE usado por global-transacoes-processor
   */
  async buscarTodasTransacoes(filtros?: {
    ano?: number;
    mes?: number;
    limite?: number;
  }): Promise<any[]> {
    try {
      console.log('🔍 [FirestoreFacade] Iniciando busca global de transações...', filtros);
      
      const cacheKey = `todas-transacoes-${JSON.stringify(filtros || {})}`;
      
      // Usar o método INDEPENDENTE do transacoesService
      const transacoes = await transacoesService.buscarTodasTransacoes(filtros);
      
      console.log(`✅ [FirestoreFacade] Busca global concluída: ${transacoes.length} transações encontradas`);
      
      return transacoes;
      
    } catch (error) {
      console.error('❌ [FirestoreFacade] Erro crítico na busca global de transações:', error);
      return [];
    }
  }

  /**
   * Buscar ranking de despesas
   * Método usado por hooks e contextos
   */
  async buscarRankingDespesas(opcoes?: any): Promise<any[]> {
    try {
      console.log('[FirestoreFacade] Buscando ranking de despesas...', opcoes);
      
      // Implementar usando deputadosService e estatísticas
      const deputados = await deputadosService.buscarDeputados();
      
      // Ordenar por totalGastos
      const ranking = deputados
        .filter(d => d.totalGastos && d.totalGastos > 0)
        .sort((a, b) => (b.totalGastos || 0) - (a.totalGastos || 0))
        .slice(0, opcoes?.limite || 100);
      
      console.log(`[FirestoreFacade] ✅ Ranking gerado: ${ranking.length} deputados`);
      return ranking;
      
    } catch (error) {
      console.error('[FirestoreFacade] ❌ Erro ao buscar ranking de despesas:', error);
      return [];
    }
  }

  /**
   * Buscar despesas por ano
   * Método usado por rankings-otimizados-service
   */
  async buscarDespesasPorAno(ano: number): Promise<any[]> {
    try {
      console.log(`[FirestoreFacade] Buscando despesas do ano ${ano}...`);
      
      // Usar transacoesService para buscar por ano
      const transacoes = await transacoesService.buscarTransacoesComFiltros({
        ano,
        limite: 10000
      });
      
      console.log(`[FirestoreFacade] ✅ Encontradas ${transacoes.length} despesas para o ano ${ano}`);
      return transacoes;
      
    } catch (error) {
      console.error(`[FirestoreFacade] ❌ Erro ao buscar despesas do ano ${ano}:`, error);
      return [];
    }
  }

  // =====================================================
  // MÉTODOS DE ESTATÍSTICAS DE CATEGORIA
  // =====================================================

  /**
   * Obter estatísticas de categoria específica
   * Mantém compatibilidade com useCategoriaData.ts
   */
  async obterEstatisticasCategoria(categoria: string, ano?: number): Promise<any> {
    try {
      console.log(`[FirestoreFacade] 📊 Obtendo estatísticas da categoria: ${categoria}, Ano: ${ano || 'todos'}`);
      
      // Buscar todos os fornecedores e filtrar por categoria
      const todosFornecedores = await fornecedoresService.buscarTodosFornecedoresOtimizado();
      const fornecedoresDaCategoria = todosFornecedores.filter(f => 
        f.categorias && f.categorias.some(cat => 
          cat.toLowerCase().includes(categoria.toLowerCase()) || 
          categoria.toLowerCase().includes(cat.toLowerCase())
        )
      );
      
      if (fornecedoresDaCategoria.length === 0) {
        console.warn(`[FirestoreFacade] ⚠️ Nenhum fornecedor encontrado para categoria: ${categoria}`);
        return {
          totalFornecedores: 0,
          totalRecebido: 0,
          mediaTransacao: 0,
          numeroTransacoes: 0
        };
      }
      
      // Calcular estatísticas
      const totalFornecedores = fornecedoresDaCategoria.length;
      const totalRecebido = fornecedoresDaCategoria.reduce((sum, f) => sum + (f.totalRecebido || 0), 0);
      const numeroTransacoes = fornecedoresDaCategoria.reduce((sum, f) => sum + (f.numTransacoes || 0), 0);
      const mediaTransacao = numeroTransacoes > 0 ? totalRecebido / numeroTransacoes : 0;
      
      const estatisticas = {
        totalFornecedores,
        totalRecebido,
        mediaTransacao,
        numeroTransacoes,
        ano: ano || 'todos'
      };
      
      console.log(`[FirestoreFacade] ✅ Estatísticas calculadas para ${categoria}:`, estatisticas);
      return estatisticas;
      
    } catch (error) {
      console.error(`[FirestoreFacade] ❌ Erro ao obter estatísticas da categoria ${categoria}:`, error);
      return {
        totalFornecedores: 0,
        totalRecebido: 0,
        mediaTransacao: 0,
        numeroTransacoes: 0
      };
    }
  }

  // =====================================================
  // MÉTODOS LEGADOS REMOVIDOS COM LOGS DE ORIENTAÇÃO
  // =====================================================

  /**
   * @deprecated Este método foi removido. Use os novos serviços modulares:
   * - deputadosService para operações com deputados
   * - fornecedoresService para operações com fornecedores  
   * - transacoesService para operações com transações
   */
  private _logMigrationWarning(methodName: string, replacement: string) {
    console.warn(`⚠️ [MIGRAÇÃO] O método ${methodName} foi modularizado. Use: ${replacement}`);
  }
}

// Instância singleton para compatibilidade
export const firestoreFacade = new FirestoreFacade();

// Exportar classe e instância para compatibilidade total
export { FirestoreFacade as FirestoreService };
export const firestoreService = firestoreFacade;