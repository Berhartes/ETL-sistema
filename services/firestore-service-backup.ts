import { db } from '@/lib/firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  getDoc,
  limit,
  startAfter,
  collectionGroup,
  orderBy
} from 'firebase/firestore';
import { unifiedCacheService } from './unified-cache-service.js';
import { transactionLogThrottle } from './log-throttle.js';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { PerfilFornecedorCompleto } from '@/core/functions/camara_api_wrapper/scripts/types/perfil-fornecedor.types';

// Interface para deputado no Firestore (Estrutura V3)
interface DeputadoFirestore {
  id: string;
  nome?: string;
  nomeCivil?: string;
  siglaPartido?: string;
  siglaUf?: string;
  urlFoto?: string;
  cpf?: string;
  
  // Campos críticos da V3
  nomeEleitoral?: string;
  situacao?: string;
  condicaoEleitoral?: string;
  gabinete?: {
    nome?: string;
    predio?: string;
    sala?: string;
    andar?: string;
    telefone?: string;
    email?: string;
  };
  redeSocial?: string[];
  
  // Dados pessoais adicionais
  dataNascimento?: string;
  dataFalecimento?: string;
  sexo?: string;
  escolaridade?: string;
  ufNascimento?: string;
  municipioNascimento?: string;
  urlWebsite?: string;
  email?: string;
  
  // Métricas calculadas
  totalGastos?: number;
  scoreInvestigativo?: number;
  indicadorConformidade?: string;
  numeroTransacoes?: number;
  numeroFornecedores?: number;
  ultimaAtualizacao?: any;
  
  // Campos legados (compatibilidade)
  ideCadastro?: string;
  nuCarteiraParlamentar?: string;
  nuLegislatura?: number;
  [key: string]: any;
}

// Interface para despesa no Firestore
interface DespesaFirestore {
  dataDocumento?: string;
  tipoDespesa?: string;
  tipoDocumento?: string;
  
  // ✅ FASE 2: Nomenclatura API Câmara (prioritária)
  nomeFornecedor?: string;
  cnpjCpfFornecedor?: string;
  
  // 🔄 MIGRAÇÃO CONCLUÍDA: Apenas nomenclatura padrão da API
  
  valorDocumento?: number | string;
  valorGlosa?: number | string;
  valorLiquido?: number | string;
  urlDocumento?: string;
  numDocumento?: string;
  numParcela?: number;
  [key: string]: any;
}

// Interface para Fornecedor Completo no Firestore
interface FornecedorCompleto {
  id: string;
  cnpj: string;
  nome: string;
  totalRecebido: number;
  numTransacoes: number;
  deputadosAtendidos: string[];
  categorias: string[];
  mediaTransacao: number;
  indiceSuspeicao: number;
  // Campos do algoritmo investigativo avançado
  categoriaRisco?: 'NORMAL' | 'SUSPEITO' | 'ALTO_RISCO' | 'ORGANIZACAO_CRIMINOSA';
  alertasInvestigativos?: string[];
}

// Interface para Fornecedor Detalhado
interface FornecedorDetalhado extends FornecedorCompleto {
  transacoes: (DespesaFirestore & { nomeDeputado?: string })[];
}


export class FirestoreService {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
  private bancoVazioCache: { isEmpty: boolean; timestamp: number } | null = null;
  private readonly BANCO_VAZIO_CACHE_DURATION = 30 * 1000; // 30 segundos

  /**
   * Verificar se o banco está vazio (com cache para evitar verificações repetidas)
   */
  private async isBancoVazio(): Promise<boolean> {
    const now = Date.now();
    
    // Usar cache se disponível e válido
    if (this.bancoVazioCache && (now - this.bancoVazioCache.timestamp) < this.BANCO_VAZIO_CACHE_DURATION) {
      return this.bancoVazioCache.isEmpty;
    }
    
    try {
      // Verificação rápida: tentar buscar qualquer documento
      const fornecedoresQuery = query(collection(db, 'fornecedores'), limit(1));
      const fornecedoresSnapshot = await getDocs(fornecedoresQuery);
      
      const isEmpty = fornecedoresSnapshot.empty;
      
      // Armazenar resultado no cache
      this.bancoVazioCache = { isEmpty, timestamp: now };
      
      return isEmpty;
    } catch (error) {
      // Em caso de erro, assumir que está vazio para evitar warnings
      this.bancoVazioCache = { isEmpty: true, timestamp: now };
      return true;
    }
  }

  /**
   * Limpar cache de banco vazio (usar após popular dados)
   */
  public clearBancoVazioCache(): void {
    this.bancoVazioCache = null;
    console.log(`[FirestoreService] 🗑️ Cache de banco vazio limpo`);
  }

  /**
   * Verificar se dados de fornecedores estão disponíveis
   */
  async isFornecedoresDataAvailable(): Promise<boolean> {
    try {
      // Verificação específica para fornecedores
      const fornecedoresQuery = query(collection(db, 'fornecedores'), limit(1));
      const fornecedoresSnapshot = await getDocs(fornecedoresQuery);
      
      if (!fornecedoresSnapshot.empty) {
        return true;
      }
      
      // Fallback: verificar perfisFornecedores (estrutura antiga)
      const perfisQuery = query(collection(db, 'perfisFornecedores'), limit(1));
      const perfisSnapshot = await getDocs(perfisQuery);
      
      return !perfisSnapshot.empty;
    } catch (error) {
      console.warn('[FirestoreService] ⚠️ Erro ao verificar dados de fornecedores:', error);
      return false;
    }
  }

  /**
   * Verificação leve de conexão com Firestore
   */
  async checkFirestoreConnection(): Promise<boolean> {
    try {
      // Tentativa leve de verificar conexão
      const testQuery = query(collection(db, 'rankings'), limit(1));
      await getDocs(testQuery);
      return true;
    } catch (error) {
      console.warn('[FirestoreService] ⚠️ Conexão Firestore falhando:', error);
      return false;
    }
  }

  /**
   * Método de debug para verificar estrutura de dados de um deputado específico
   */
  async debugDeputadoEstrutura(deputadoId: string) {
    try {
      console.log(`🔍 [DEBUG] Verificando estrutura para deputado: ${deputadoId}`);
      
      // 1. Verificar documento principal
      const docPrincipalRef = doc(db, 'despesas', deputadoId);
      const docPrincipalSnap = await getDoc(docPrincipalRef);
      
      if (docPrincipalSnap.exists()) {
        const data = docPrincipalSnap.data();
        console.log(`📄 [DEBUG] Documento principal existe:`, {
          hasDeputado: !!data.deputado,
          hasDespesas: !!data.despesas,
          hasTotalDespesas: !!data.totalDespesas,
          keys: Object.keys(data)
        });
      } else {
        console.log(`❌ [DEBUG] Documento principal não existe`);
      }
      
      // 2. Verificar subcoleção dados/info
      const dadosRef = doc(db, 'despesas', deputadoId, 'dados', 'info');
      const dadosSnap = await getDoc(dadosRef);
      
      if (dadosSnap.exists()) {
        const dadosData = dadosSnap.data();
        console.log(`📄 [DEBUG] dados/info existe:`, {
          hasNome: !!dadosData.nome,
          hasPartido: !!dadosData.siglaPartido,
          hasUf: !!dadosData.siglaUf,
          keys: Object.keys(dadosData)
        });
      } else {
        console.log(`❌ [DEBUG] dados/info não existe`);
      }
      
      // 3. Verificar estrutura de anos
      const anosRef = collection(db, 'despesas', deputadoId, 'anos');
      const anosSnap = await getDocs(anosRef);
      
      if (!anosSnap.empty) {
        console.log(`📅 [DEBUG] Encontrados ${anosSnap.docs.length} anos:`, anosSnap.docs.map(d => d.id));
      } else {
        console.log(`❌ [DEBUG] Nenhum ano encontrado`);
      }
      
    } catch (error) {
      console.error(`❌ [DEBUG] Erro ao verificar estrutura:`, error);
    }
  }

  /**
   * Busca deputados do Firestore (Nova estrutura V3: despesas/{idDeputado})
   */
  async buscarDeputados(filtros?: { uf?: string; partido?: string; limite?: number }) {
    try {
      console.log('🔍 Buscando deputados no Firestore (Estrutura V3)...');
      console.log('🔍 Filtros aplicados:', filtros);
      
      // NOVA ESTRATÉGIA: Usar collectionGroup para encontrar todos os documentos dados/info
      // Isso permite descobrir automaticamente TODOS os deputados sem listas hardcoded
      
      let deputadosIds: string[] = [];
      
      console.log('🚀 Usando estratégia avançada: collectionGroup para descobrir todos os deputados...');
      
      try {
        // Usar collectionGroup para buscar todos os documentos em qualquer subcoleção 'dados'
        // Como sabemos que a estrutura é despesas/{deputadoId}/dados/info
        const { collectionGroup, query, limit } = await import('firebase/firestore');
        
        const dadosCollectionGroup = collectionGroup(db, 'dados');
        const limitedQuery = dadosCollectionGroup; // ✅ REMOVIDO LIMITE ARTIFICIAL - buscar TODOS os deputados
        const querySnapshot = await getDocs(limitedQuery);
        
        console.log(`📊 Encontrados ${querySnapshot.docs.length} documentos na collectionGroup 'dados'`);
        
        // Para cada documento encontrado, extrair o ID do deputado do path
        const deputadosSet = new Set<string>();
        
        querySnapshot.docs.forEach(doc => {
          // O path é algo como: despesas/{deputadoId}/dados/{docId}
          const pathParts = doc.ref.path.split('/');
          if (pathParts.length >= 2 && pathParts[0] === 'despesas') {
            const deputadoId = pathParts[1];
            deputadosSet.add(deputadoId);
          }
        });
        
        deputadosIds = Array.from(deputadosSet);
        console.log(`🎯 [DEBUG] Descobertos ${deputadosIds.length} deputados únicos via collectionGroup`, {
          totalDocumentos: querySnapshot.docs.length,
          deputadosUnicos: deputadosIds.length,
          esperado: 300,
          diferenca: 300 - deputadosIds.length,
          primeiros5IDs: deputadosIds.slice(0, 5),
          limitUsado: 5000
        });
        
      } catch (error) {
        console.warn('⚠️ Erro ao usar collectionGroup, usando método de fallback:', error);
        
        // Fallback: usar listDocuments se disponível (só funciona em admin SDK)
        // Como não temos admin SDK, usar lista expandida conhecida
        deputadosIds = [
          '107970', '109429', '121948', // IDs conhecidos
          // Adicionar range baseado nos padrões observados
        ];
        
        // Expandir com ranges conhecidos
        const ranges = [
          { start: 107960, end: 107990 },
          { start: 109420, end: 109450 },
          { start: 121940, end: 121960 }
        ];
        
        for (const range of ranges) {
          for (let i = range.start; i <= range.end; i++) {
            deputadosIds.push(i.toString());
          }
        }
        
        console.log(`📋 Usando lista expandida de fallback: ${deputadosIds.length} IDs para testar`);
      }
      
      const deputados: DeputadoFirestore[] = [];
      let deputadosComDados = 0;
      let deputadosSemDados = 0;
      
      // Para cada deputado descoberto, buscar dados na subcoleção 'dados'
      for (const deputadoId of deputadosIds) {
        
        try {
          // Buscar dados do deputado na estrutura V3: despesas/{deputadoId}/dados/info
          const dadosRef = doc(db, 'despesas', deputadoId, 'dados', 'info');
          const dadosSnapshot = await getDoc(dadosRef);
          
          if (dadosSnapshot.exists()) {
            const deputadoData = dadosSnapshot.data();
            deputadosComDados++;
            
            console.log(`✅ Deputado ${deputadoId}:`, {
              nome: deputadoData.nome,
              partido: deputadoData.siglaPartido,
              uf: deputadoData.siglaUf,
              totalGastos: deputadoData.totalGastos
            });
            
            // Aplicar filtros se fornecidos
            if (filtros?.uf && deputadoData.siglaUf !== filtros.uf) {
              console.log(`⏭️ Deputado ${deputadoId} filtrado por UF (${deputadoData.siglaUf} != ${filtros.uf})`);
              continue;
            }
            if (filtros?.partido && deputadoData.siglaPartido !== filtros.partido) {
              console.log(`⏭️ Deputado ${deputadoId} filtrado por partido (${deputadoData.siglaPartido} != ${filtros.partido})`);
              continue;
            }
            
            deputados.push({
              id: deputadoId,
              nome: deputadoData.nome,
              nomeCivil: deputadoData.nomeCivil,
              siglaPartido: deputadoData.siglaPartido,
              siglaUf: deputadoData.siglaUf,
              urlFoto: deputadoData.urlFoto,
              cpf: deputadoData.cpf,
              // Campos críticos da V3
              nomeEleitoral: deputadoData.nomeEleitoral,
              situacao: deputadoData.situacao,
              condicaoEleitoral: deputadoData.condicaoEleitoral,
              gabinete: deputadoData.gabinete,
              redeSocial: deputadoData.redeSocial,
              // Métricas calculadas
              totalGastos: deputadoData.totalGastos,
              scoreInvestigativo: deputadoData.scoreInvestigativo,
              indicadorConformidade: deputadoData.indicadorConformidade,
              numeroTransacoes: deputadoData.numeroTransacoes,
              numeroFornecedores: deputadoData.numeroFornecedores,
              ultimaAtualizacao: deputadoData.ultimaAtualizacao
            });
            
            // Aplicar limite se especificado
            if (filtros?.limite && deputados.length >= filtros.limite) {
              console.log(`🛑 Limite de ${filtros.limite} deputados atingido, parando...`);
              break;
            }
          } else {
            deputadosSemDados++;
            console.log(`⚠️ Documento ${deputadoId} não tem dados na subcoleção dados/info`);
          }
        } catch (error) {
          deputadosSemDados++;
          console.log(`❌ Erro ao buscar dados do deputado ${deputadoId}:`, error);
        }
      }

      console.log(`📊 [DEBUG] Resumo final buscarDeputados:`, {
        deputadosIdsDescobertas: deputadosIds.length,
        deputadosComDados,
        deputadosSemDados,
        deputadosProcessados: deputados.length,
        esperado: 300,
        diferencaFinal: 300 - deputados.length
      });
      console.log(`✅ ${deputados.length} deputados processados da estrutura V3`);
      return deputados;
    } catch (error) {
      console.error('❌ Erro ao buscar deputados V3:', error);
      throw error;
    }
  }


  /**
   * Busca anos disponíveis no sistema usando collectionGroup
   * Método eficiente que consulta diretamente a estrutura /despesas/{deputadoId}/anos/{ano}
   */
  async buscarAnosDisponiveis(): Promise<{ano: number, quantidade: number}[]> {
    try {
      console.log('🔍 [buscarAnosDisponiveis] Iniciando busca de anos disponíveis via collectionGroup...')
      
      // Usar collectionGroup para buscar todos os documentos em qualquer subcoleção 'anos'
      const { collectionGroup, getDocs } = await import('firebase/firestore')
      const anosQuery = collectionGroup(db, 'anos')
      const snapshot = await getDocs(anosQuery)
      
      console.log(`📊 [buscarAnosDisponiveis] Encontrados ${snapshot.docs.length} documentos de anos`)
      
      // Agrupar por ano e contar quantidade de deputados
      const anosMap = new Map<number, number>()
      const anosSet = new Set<number>()
      
      snapshot.docs.forEach(doc => {
        try {
          const ano = parseInt(doc.id)
          if (!isNaN(ano) && ano >= 2015 && ano <= new Date().getFullYear() + 1) { // Validação de anos razoáveis
            anosSet.add(ano)
            anosMap.set(ano, (anosMap.get(ano) || 0) + 1)
          }
        } catch (error) {
          console.warn(`⚠️ Erro ao processar documento de ano ${doc.id}:`, error)
        }
      })
      
      // Converter para array ordenado
      const anosDisponiveis = Array.from(anosMap.entries())
        .map(([ano, quantidade]) => ({ ano, quantidade }))
        .sort((a, b) => b.ano - a.ano) // Mais recente primeiro
      
      console.log('✅ [buscarAnosDisponiveis] Anos encontrados:', anosDisponiveis)
      
      return anosDisponiveis
      
    } catch (error) {
      console.error('❌ [buscarAnosDisponiveis] Erro ao buscar anos disponíveis:', error)
      
      // Fallback: retornar anos padrão
      const anosConhecidos = [
        { ano: 2024, quantidade: 513 },
        { ano: 2023, quantidade: 513 },
        { ano: 2022, quantidade: 513 },
        { ano: 2021, quantidade: 513 },
        { ano: 2020, quantidade: 513 }
      ]
      
      console.log('🔄 [buscarAnosDisponiveis] Usando fallback com anos conhecidos:', anosConhecidos)
      return anosConhecidos
    }
  }

  /**
   * Busca despesas de um deputado específico (Nova estrutura /despesas/{deputadoId}/anos/{ano})
   */
  async buscarDespesasDeputado(
    deputadoId: string, 
    ano: number, 
    mes?: number | string
  ): Promise<DespesaFirestore[]> {
    try {
      console.log(`[FirestoreService V3] Buscando despesas para deputado ${deputadoId}, Ano:${ano}, Mes:${mes}`);
      
      // Buscar documento do ano específico na estrutura /despesas/{deputadoId}/anos/{ano}
      const anoRef = doc(db, 'despesas', deputadoId, 'anos', ano.toString());
      const anoSnap = await getDoc(anoRef);
      
      if (!anoSnap.exists()) {
        console.log(`Ano ${ano} não encontrado para deputado ${deputadoId}`);
        return [];
      }
      
      const data = anoSnap.data();
      let todasDespesas: any[] = [];
      
      // Extrair array de despesas do documento
      if (data.despesas && Array.isArray(data.despesas)) {
        todasDespesas = data.despesas;
      }
      
      if (todasDespesas.length === 0) {
        console.log(`Nenhuma despesa encontrada para deputado ${deputadoId} no ano ${ano}`);
        return [];
      }
      
      // Filtrar despesas por mês se especificado
      let despesasFiltradas = todasDespesas;
      if (mes && mes !== 'todos') {
        const mesNum = typeof mes === 'string' ? parseInt(mes) : mes;
        despesasFiltradas = todasDespesas.filter((despesa: any) => {
          return despesa.mes === mesNum;
        });
      }
      
      // Ordenar por data do documento (mais recente primeiro)
      despesasFiltradas.sort((a: any, b: any) => {
        const dateA = a.dataDocumento?.toDate?.() || new Date(a.dataDocumento);
        const dateB = b.dataDocumento?.toDate?.() || new Date(b.dataDocumento);
        return dateB.getTime() - dateA.getTime();
      });

      console.log(`[FirestoreService V3] ${despesasFiltradas.length} despesas encontradas para deputado ${deputadoId} no ano ${ano} (${todasDespesas.length} total)`);
      return despesasFiltradas;

    } catch (error) {
      console.error(`Erro ao buscar despesas V3 do deputado ${deputadoId}:`, error);
      return [];
    }
  }

  /**
   * Conta o número real de deputados processados no sistema
   */
  async contarDeputadosReais(): Promise<number> {
    try {
      console.log('🔢 [CONTAGEM] Iniciando contagem de deputados reais no Firestore...');
      
      // Verificar se Firebase está inicializado
      if (!db) {
        console.error('❌ [CONTAGEM] Firebase DB não inicializado');
        return 0;
      }
      
      console.log('✅ [CONTAGEM] Firebase DB conectado, buscando ranking geral...');
      
      // 🆕 NOVA ABORDAGEM: Contar deputados do ranking geral em vez da coleção "despesas"
      try {
        const rankingGeral = await getDoc(doc(db, 'rankings', 'deputados_geral_historico'));
        
        if (rankingGeral.exists()) {
          const data = rankingGeral.data();
          const totalDeputados = data.ranking?.length || 0;
          
          console.log(`🎯 [CONTAGEM] RESULTADO: ${totalDeputados} deputados encontrados no ranking geral`);
          
          if (totalDeputados > 0) {
            const primeiros3 = data.ranking.slice(0, 3).map((d: any) => d.nome);
            console.log('📋 [CONTAGEM] Primeiros deputados:', primeiros3);
          }
          
          return totalDeputados;
        } else {
          console.warn('⚠️ [CONTAGEM] Ranking geral não encontrado');
          return 0;
        }
      } catch (rankingError) {
        console.error('❌ [CONTAGEM] Erro ao acessar ranking geral:', rankingError);
        
        // Fallback: tentar contar a partir dos metadados
        try {
          const metadados = await getDoc(doc(db, 'metadados', 'ultimoProcessamento'));
          if (metadados.exists()) {
            const data = metadados.data();
            const totalDeputados = data.totalDeputados || 0;
            console.log(`🎯 [CONTAGEM] FALLBACK: ${totalDeputados} deputados nos metadados`);
            return totalDeputados;
          }
        } catch (metaError) {
          console.error('❌ [CONTAGEM] Erro ao acessar metadados:', metaError);
        }
        
        return 0;
      }
      
    } catch (error) {
      console.error('❌ [CONTAGEM] Erro ao contar deputados reais:', error);
      console.error('❌ [CONTAGEM] Detalhes do erro:', error.message);
      return 0;
    }
  }

  /**
   * Busca um deputado específico com todos os dados da estrutura V3
   */
  async buscarDeputadoCompleto(deputadoId: string): Promise<any | null> {
    try {
      console.log(`🔍 Buscando deputado ${deputadoId} na estrutura V3...`);
      
      const deputadoRef = doc(db, 'despesas', deputadoId);
      const deputadoSnap = await getDoc(deputadoRef);
      
      if (!deputadoSnap.exists()) {
        console.log(`Deputado ${deputadoId} não encontrado na estrutura V3`);
        return null;
      }
      
      const data = deputadoSnap.data();
      
      return {
        id: deputadoId,
        deputado: data.deputado,
        despesas: data.despesas || [],
        totalDespesas: data.totalDespesas || 0,
        ultimaAtualizacao: data.ultimaAtualizacao
      };
      
    } catch (error) {
      console.error(`Erro ao buscar deputado completo ${deputadoId}:`, error);
      return null;
    }
  }

  /**
   * Busca dados completos diretamente da estrutura V3 otimizada
   */
  async buscarDadosCompletos(opcoes?: {
    ano?: number;
    mes?: number | string;
    uf?: string;
    partido?: string;
    skipDeputados?: boolean; // ✅ NOVO: Permite pular busca de deputados
  }) {
    try {
      const ano = opcoes?.ano || new Date().getFullYear();
      const mes = opcoes?.mes || 'todos';

      console.log(`[FirestoreService V3] Buscando dados completos da estrutura otimizada - Ano: ${ano}, Mês: ${mes}${opcoes?.skipDeputados ? ' (PULANDO DEPUTADOS)' : ''}`);

      let deputados: any[] = [];
      
      // ✅ OTIMIZAÇÃO: Só buscar deputados se necessário
      if (!opcoes?.skipDeputados) {
        // Buscar deputados da estrutura V3 (despesas/{deputadoId})
        deputados = await this.buscarDeputados({
          uf: opcoes?.uf,
          partido: opcoes?.partido,
        });

        if (deputados.length === 0) {
          // ✅ Só mostrar warning se o banco não estiver vazio
          const bancoVazio = await this.isBancoVazio();
          if (!bancoVazio) {
            console.warn('[FirestoreService V3] ⚠️ Nenhum deputado encontrado na estrutura V3, mas continuando com os dados disponíveis');
          }
          // Não lançar erro aqui, apenas criar uma estrutura mínima para que outros dados possam ser carregados
        }
      } else {
        console.log('[FirestoreService V3] ⏭️ Busca de deputados pulada conforme solicitado');
      }

      console.log(`[FirestoreService V3] ${deputados.length} deputados encontrados na estrutura V3`);
      
      // Log detalhado dos primeiros deputados
      if (deputados.length > 0) {
        console.log(`[FirestoreService V3] Primeiros deputados:`, deputados.slice(0, 3).map(d => ({
          id: d.id,
          nome: d.nome,
          totalGastos: d.totalGastos,
          scoreInvestigativo: d.scoreInvestigativo
        })));
      }

      // Os deputados já vêm com todas as métricas calculadas da estrutura V3
      // Criar análise compatível com o formato esperado
      const deputadosAnalise = deputados.map(deputado => ({
        id: deputado.id,
        nome: deputado.nome || deputado.nomeCivil || 'Nome não disponível',
        partido: deputado.siglaPartido || 'Sem partido', 
        uf: deputado.siglaUf || 'Sem estado',
        totalGasto: deputado.totalGastos || 0,
        numTransacoes: deputado.numeroTransacoes || 0,
        scoreSuspeicao: deputado.scoreInvestigativo || 0,
        indicadorConformidade: deputado.indicadorConformidade || 'NORMAL',
        // Campos adicionais da V3
        nomeEleitoral: deputado.nomeEleitoral,
        situacao: deputado.situacao, 
        condicaoEleitoral: deputado.condicaoEleitoral,
        gabinete: deputado.gabinete,
        redeSocial: deputado.redeSocial,
        cpf: deputado.cpf,
        urlFoto: deputado.urlFoto,
        alertas: deputado.padroesSuspeitos || []
      }));

      // Buscar estatísticas da coleção de estatísticas se existir
      let estatisticas = {
        totalGasto: deputados.reduce((sum, dep) => sum + (dep.totalGastos || 0), 0),
        numDeputados: deputados.length,
        mediaGastos: 0,
        deputadosSuspeitos: deputados.filter(d => (d.scoreInvestigativo || 0) >= 50).length
      };
      
      estatisticas.mediaGastos = estatisticas.numDeputados > 0 ? estatisticas.totalGasto / estatisticas.numDeputados : 0;

      console.log(`[FirestoreService V3] Análise estruturada:`, {
        deputados: deputadosAnalise.length,
        deputadosSuspeitos: estatisticas.deputadosSuspeitos,
        volumeTotal: estatisticas.totalGasto
      });

      return {
        data: new Date().toISOString(),
        arquivo: `Firestore V3 - Dados Otimizados`,
        fonte: 'firestore-v3',
        periodo: { mes, ano },
        deputados: deputados,
        analise: {
          deputadosAnalise: deputadosAnalise,
          alertas: [], // Alertas podem ser gerados separadamente se necessário
          fornecedoresSuspeitos: [], // Fornecedores vêm de outra coleção
          estatisticas: estatisticas
        },
        despesasRaw: []
      };

    } catch (error) {
      console.error('[FirestoreService V3] Erro ao buscar dados completos:', error);
      throw error;
    }
  }

  /**
   * Versão simplificada que busca apenas deputados (para compatibilidade)
   */
  async buscarDadosSimples(opcoes?: {
    ano?: number;
    mes?: number | string;
    uf?: string;
    partido?: string;
  }) {
    try {
      const ano = opcoes?.ano || new Date().getFullYear();
      const mes = opcoes?.mes || 'todos';

      console.log(`Buscando APENAS deputados do Firestore - Ano: ${ano}, Mês: ${mes}`);

      // Buscar apenas os deputados, sem as despesas
      const deputados = await this.buscarDeputados({
        uf: opcoes?.uf,
        partido: opcoes?.partido,
      });

      if (deputados.length === 0) {
        throw new Error('Nenhum deputado encontrado');
      }

      // Retornar uma estrutura simplificada contendo apenas os deputados
      return {
        data: new Date().toISOString(),
        arquivo: `Firestore - Deputados`,
        fonte: 'firestore',
        periodo: { mes, ano },
        deputados: deputados, 
        analise: { deputadosAnalise: [], alertas: [], estatisticas: {} },
        despesasRaw: []
      };

    } catch (error) {
      console.error('Erro ao buscar dados de deputados:', error);
      throw error;
    }
  }

  /**
   * Converte valor para número
   */
  private parseValor(valor: any): number {
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string') {
      const parsed = parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.'));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  /**
   * Busca o perfil de um fornecedor diretamente da coleção pré-agregada.
   */
  async buscarPerfilFornecedor(cnpj: string): Promise<FornecedorCompleto | null> {
    try {
      console.log(`[Cache] Buscando perfil pré-agregado para o CNPJ: ${cnpj}`);
      const docRef = doc(db, 'perfisFornecedores', cnpj);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        // Adaptação para a interface FornecedorCompleto
        return {
          id: docSnap.id,
          cnpj: data.cnpj,
          nome: data.nome,
          totalRecebido: data.valorTotalGasto,
          numTransacoes: data.quantidadeTransacoes,
          deputadosAtendidos: data.deputadosAtendidos,
          categorias: data.categoriasGasto,
          mediaTransacao: data.valorTotalGasto / data.quantidadeTransacoes,
          indiceSuspeicao: 0, // O script de processamento pode adicionar isso no futuro
        };
      } else {
        console.log(`[Cache] Nenhum perfil pré-agregado encontrado para o CNPJ: ${cnpj}`);
        return null;
      }
    } catch (error) {
      console.error(`Erro ao buscar perfil do fornecedor ${cnpj}:`, error);
      return null;
    }
  }

  /**
   * Buscar fornecedores da estrutura V3 (coleção 'fornecedores')
   * IMPORTANTE: Dados são pré-calculados e otimizados pela estrutura V3
   */
  // Cache para fornecedores processados
  private fornecedoresCache: Map<string, { data: FornecedorCompleto[]; timestamp: number }> = new Map();

  /**
   * Método otimizado para buscar TODOS os fornecedores da estrutura V3
   * Usa dados pré-agregados do processador V3
   */
  async buscarTodosFornecedoresOtimizado(): Promise<FornecedorCompleto[]> {
    console.log('[FORNECEDORES V3] 🚀 ⭐ INICIANDO BUSCA OTIMIZADA DE FORNECEDORES ⭐')
    
    const cacheKey = 'todos-fornecedores-v3-otimizado';
    
    // Verificar cache primeiro
    const cached = this.fornecedoresCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
      console.log(`[FORNECEDORES V3] ✅ Cache hit - ${cached.data.length} fornecedores`);
      return cached.data;
    }

    console.log('[FORNECEDORES V3] 📊 Cache miss ou expirado, buscando no Firestore...')
    console.log(`[FORNECEDORES V3] 🔧 DB Status:`, {
      isConnected: !!db,
      appName: db?.app?.name,
      projectId: db?.app?.options?.projectId
    })

    try {
      console.log(`[FORNECEDORES V3] 🔄 Buscando fornecedores da estrutura V3...`);
      
      // Verificar se db está inicializado
      if (!db) {
        throw new Error('Firestore não está inicializado');
      }
      
      // Tentar primeiro a coleção 'fornecedores' (estrutura V3)
      console.log('[FORNECEDORES V3] 🎯 Tentando coleção "fornecedores"...')
      let fornecedoresRef = collection(db, 'fornecedores');
      let snapshot = await getDocs(fornecedoresRef);
      
      console.log(`[FORNECEDORES V3] 📊 Coleção "fornecedores": ${snapshot.size} documentos`)
      
      // Se não encontrar na coleção 'fornecedores', tentar 'perfisFornecedores' (fallback)
      if (snapshot.empty) {
        console.log(`[FORNECEDORES V3] ⚠️ Coleção 'fornecedores' vazia, tentando 'perfisFornecedores'...`);
        fornecedoresRef = collection(db, 'perfisFornecedores');
        snapshot = await getDocs(fornecedoresRef);
        console.log(`[FORNECEDORES V3] 📊 Coleção "perfisFornecedores": ${snapshot.size} documentos`)
      }
      
      if (snapshot.empty) {
        console.error('[FORNECEDORES V3] ❌ AMBAS AS COLEÇÕES ESTÃO VAZIAS!');
        console.error('[FORNECEDORES V3] 🔧 POSSÍVEIS CAUSAS: Banco não populado, erro de conexão, permissões');
        throw new Error('Nenhuma coleção de fornecedores encontrada no Firestore');
      }
      
      console.log(`[FORNECEDORES V3] 📄 ${snapshot.size} documentos encontrados`);
      
      const fornecedores: FornecedorCompleto[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        
        // Validar se tem dados essenciais (adaptado para ambas as estruturas)
        const nome = data.nome || 'Nome não informado';
        const totalRecebido = data.totalRecebido || data.valorTotalGasto || 0;
        const numTransacoes = data.numeroTransacoes || data.quantidadeTransacoes || 0;
        
        if (totalRecebido === 0) {
          console.warn(`[FORNECEDORES V3] ⚠️ Documento ${doc.id} sem valor total, pulando...`);
          return; // Pular documentos sem valor
        }
        
        const mediaTransacao = data.mediaTransacao || (totalRecebido / (numTransacoes || 1));
        
        // Usar score da V3 se disponível, senão calcular
        const scoreInvestigativo = data.scoreInvestigativo || this.calcularIndiceSuspeicao(data, mediaTransacao);
        
        // Determinar categoria de risco
        const categoriaRisco = data.categoriaRisco || (
          scoreInvestigativo >= 80 ? 'ORGANIZACAO_CRIMINOSA' :
          scoreInvestigativo >= 60 ? 'ALTO_RISCO' :
          scoreInvestigativo >= 40 ? 'SUSPEITO' : 'NORMAL'
        );
        
        const fornecedor: FornecedorCompleto = {
          id: doc.id,
          cnpj: data.cnpj || doc.id.replace(/\D/g, ''), // Limpar CNPJ ou usar ID
          nome: nome,
          totalRecebido: totalRecebido,
          numTransacoes: numTransacoes,
          deputadosAtendidos: data.deputadosTop?.map((d: any) => d.nome) || 
                             data.deputadosAtendidos || [],
          categorias: data.categoriasAtendidas || data.categoriasGasto || ['Não especificado'],
          mediaTransacao: mediaTransacao,
          indiceSuspeicao: scoreInvestigativo,
          // Campos específicos da V3
          categoriaRisco: categoriaRisco as any,
          alertasInvestigativos: data.padroesLavaJato || []
        };

        fornecedores.push(fornecedor);
      });

      // Ordenar por score investigativo (mais suspeitos primeiro), depois por valor
      const fornecedoresOrdenados = fornecedores
        .sort((a, b) => {
          if (b.indiceSuspeicao !== a.indiceSuspeicao) {
            return b.indiceSuspeicao - a.indiceSuspeicao;
          }
          return b.totalRecebido - a.totalRecebido;
        });

      console.log(`[FORNECEDORES V3] ✅ ${fornecedoresOrdenados.length} fornecedores processados`);
      console.log(`[FORNECEDORES V3] 📊 Top 3 por suspeição:`, fornecedoresOrdenados.slice(0, 3).map(f => ({
        nome: f.nome,
        valor: f.totalRecebido,
        score: f.indiceSuspeicao,
        categoria: f.categoriaRisco
      })));

      // Armazenar no cache
      this.fornecedoresCache.set(cacheKey, {
        data: fornecedoresOrdenados,
        timestamp: Date.now()
      });

      return fornecedoresOrdenados;

    } catch (error) {
      console.error('[FORNECEDORES V3] ❌ ⚠️ ERRO CRÍTICO NA BUSCA OTIMIZADA ⚠️');
      console.error('[FORNECEDORES V3] 🔍 Detalhes do erro:', {
        errorType: error?.constructor?.name,
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 5) : 'Stack não disponível'
      });
      
      // Tentar identificar o tipo de erro
      if (error instanceof Error) {
        if (error.message.includes('Firestore não está inicializado')) {
          console.error('[FORNECEDORES V3] 💥 FALHA: Firestore não inicializado');
          console.error('[FORNECEDORES V3] 🔧 SOLUÇÃO: Verificar configuração do Firebase');
        } else if (error.message.includes('permission-denied')) {
          console.error('[FORNECEDORES V3] 💥 FALHA: Permissões insuficientes');
          console.error('[FORNECEDORES V3] 🔧 SOLUÇÃO: Verificar regras de segurança do Firestore');
        } else if (error.message.includes('unavailable')) {
          console.error('[FORNECEDORES V3] 💥 FALHA: Serviço Firestore indisponível');
          console.error('[FORNECEDORES V3] 🔧 SOLUÇÃO: Verificar conectividade de rede');
        } else {
          console.error('[FORNECEDORES V3] 💥 FALHA: Erro não identificado');
        }
      }
      
      // Retornar array vazio como fallback, mas garantir que o erro seja conhecido
      console.warn('[FORNECEDORES V3] 🆘 Retornando array vazio como fallback');
      return [];
    }
  }

  async buscarTodosFornecedores(filtros: { 
    ano: number; 
    mes: string | 'todos'; 
    uf?: string; 
    partido?: string;
    offset?: number;
  }): Promise<FornecedorCompleto[]> {
    try {
      console.log(`[FORNECEDORES V3] 🔍 Iniciando busca com filtros:`, filtros);
      
      const cacheKey = JSON.stringify(filtros);
      
      // Verificar cache primeiro
      const cached = this.fornecedoresCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
        console.log(`[FORNECEDORES V3] ✅ Cache hit - retornando ${cached.data.length} fornecedores`);
        return cached.data;
      }

      // Usar o método otimizado que já busca da estrutura V3
      const todosFornecedores = await this.buscarTodosFornecedoresOtimizado();
      
      // Aplicar filtros cliente-side (mais eficiente que múltiplas queries)
      let fornecedoresFiltrados = todosFornecedores;
      
      // Filtro por UF (se especificado)
      if (filtros.uf) {
        fornecedoresFiltrados = fornecedoresFiltrados.filter(fornecedor => 
          fornecedor.deputadosAtendidos.some(dep => 
            typeof dep === 'string' && dep.includes(filtros.uf!)
          )
        );
      }
      
      // Aplicar offset
      const offset = filtros.offset || 0;
      const fornecedoresPaginados = fornecedoresFiltrados.slice(offset);

      console.log(`[FORNECEDORES V3] ✅ ${fornecedoresPaginados.length} fornecedores filtrados (${fornecedoresFiltrados.length} total)`);

      // Armazenar no cache
      this.fornecedoresCache.set(cacheKey, {
        data: fornecedoresPaginados,
        timestamp: Date.now()
      });
      
      return fornecedoresPaginados;

    } catch (error) {
      console.error('[FORNECEDORES V3] ❌ Erro ao buscar fornecedores:', error);
      return [];
    }
  }

  /**
   * DEDUPLICAÇÃO: Remover transações duplicadas com base em critérios únicos
   * Critério: deputadoId + dataDocumento + valorLiquido + tipoDespesa
   */
  private deduplicarTransacoes(transacoes: any[]): any[] {
    const chavesPorTransacao = new Map<string, any>();
    let duplicatasDetectadas = 0;
    
    transacoes.forEach((transacao, _index) => {
      // Criar chave única baseada em campos críticos
      const deputadoId = transacao.deputadoId || transacao.idDeputado || 'sem-deputado';
      const valorLiquido = transacao.valorLiquido || transacao.vlrLiquido || transacao.valorDocumento || transacao.vlrDocumento || 0;
      const tipoDespesa = transacao.tipoDespesa || transacao.txtDescricao || transacao.categoria || '';
      
      // Normalizar data para string
      let dataStr = 'sem-data';
      const dataDocumento = transacao.dataDocumento || transacao.datEmissao || transacao.dataEmissao;
      if (dataDocumento) {
        try {
          const data = dataDocumento.toDate ? dataDocumento.toDate() : new Date(dataDocumento);
          dataStr = data.toISOString().split('T')[0]; // YYYY-MM-DD
        } catch (error) {
          console.warn('Erro ao processar data na deduplicação:', error);
        }
      }
      
      // Chave de deduplicação: deputado + data + valor + tipo
      const chaveUnica = `${deputadoId}_${dataStr}_${valorLiquido}_${tipoDespesa}`;
      
      if (chavesPorTransacao.has(chaveUnica)) {
        duplicatasDetectadas++;
        
        // Log detalhado da duplicata (apenas primeiras 5 para não spammar)
        if (duplicatasDetectadas <= 5) {
          console.warn(`[DEDUPLICAÇÃO] Duplicata ${duplicatasDetectadas}:`, {
            chave: chaveUnica,
            transacaoOriginal: {
              id: chavesPorTransacao.get(chaveUnica).id,
              deputado: chavesPorTransacao.get(chaveUnica).deputadoNome,
              valor: chavesPorTransacao.get(chaveUnica).valorLiquido || chavesPorTransacao.get(chaveUnica).vlrLiquido
            },
            transacaoDuplicada: {
              id: transacao.id,
              deputado: transacao.deputadoNome,
              valor: transacao.valorLiquido || transacao.vlrLiquido
            }
          });
        }
      } else {
        // Primeira ocorrência - manter
        chavesPorTransacao.set(chaveUnica, transacao);
      }
    });
    
    if (duplicatasDetectadas > 5) {
      console.warn(`[DEDUPLICAÇÃO] ... e mais ${duplicatasDetectadas - 5} duplicatas não exibidas`);
    }
    
    console.log(`[DEDUPLICAÇÃO] ✅ Resultado: ${chavesPorTransacao.size} únicas de ${transacoes.length} originais (${duplicatasDetectadas} duplicatas removidas)`);
    
    return Array.from(chavesPorTransacao.values());
  }

  /**
   * Limpar cache de fornecedores e transações
   */
  clearCache(): void {
    this.fornecedoresCache.clear();
    this.transacoesCache.clear();
    console.log('[FirestoreService] 🗑️ Cache de fornecedores e transações limpo');
  }

  /**
   * Método combinado otimizado para buscar fornecedor + transações
   * Executa ambas as consultas em paralelo
   */
  async buscarFornecedorComTransacoes(cnpj: string, ano: number, mes: string = 'todos'): Promise<{
    fornecedor: any | null;
    transacoes: any[];
  }> {
    const timerId = `firestoreService-${cnpj}-${Date.now()}`;
    try {
      console.time(timerId);
      console.log(`[FirestoreService v3] 🚀 Busca combinada OTIMIZADA para ${cnpj}`);

      // 1. Buscar fornecedor primeiro (rápido)
      const fornecedor = await this.buscarFornecedorPorCNPJ(cnpj);
      
      if (!fornecedor) {
        console.warn(`[FirestoreService v3] ⚠️ Fornecedor não encontrado: ${cnpj}`);
        console.timeEnd(timerId);
        return { fornecedor: null, transacoes: [] };
      }

      // 2. ✅ UNIFICADO: Buscar transações da estrutura unificada despesas/fornecedores primeiro
      let transacoes: any[] = [];
      let usouEstruturaNova = false;
      
      try {
        transacoes = await this.buscarTransacoesFornecedorUnificado(cnpj, ano, mes);
        if (transacoes.length > 0) {
          usouEstruturaNova = true;
          console.log(`[FirestoreService UNIFICADO] ✅ Estrutura unificada encontrou ${transacoes.length} transações`);
        }
      } catch (error) {
        console.warn(`[FirestoreService v3] ⚠️ Erro na busca da nova estrutura:`, error);
      }

      // 3. Se não encontrou transações na nova estrutura, usar método antigo como fallback
      if (transacoes.length === 0) {
        console.log(`[FirestoreService v3] 🔄 Fallback para busca na estrutura antiga...`);
        
        if (fornecedor.relacionamentoDeputados && Array.isArray(fornecedor.relacionamentoDeputados)) {
          console.log(`[FirestoreService v3] 🎯 Busca direcionada em ${fornecedor.relacionamentoDeputados.length} deputados específicos`);
          
          // Buscar apenas nos deputados que têm relacionamento com este fornecedor
          const deputadosIds = fornecedor.relacionamentoDeputados.map((rel: any) => rel.deputadoId).filter(Boolean);
          
          for (const deputadoId of deputadosIds) {
            try {
              const anoRef = doc(db, 'despesas', deputadoId, 'anos', ano.toString());
              const anoSnapshot = await getDoc(anoRef);
              
              if (anoSnapshot.exists()) {
                const anoData = anoSnapshot.data();
                if (anoData.despesas && Array.isArray(anoData.despesas)) {
                  const cnpjDecodificado = decodeURIComponent(cnpj);
                  const cnpjLimpo = cnpjDecodificado.replace(/\D/g, '');
                  
                  // Filtrar despesas deste fornecedor específico
                  const despesasDeputado = anoData.despesas.filter((despesa: any) => {
                    const cnpjCpfFornecedor = despesa.cnpjCpfFornecedor || '';
                    const cnpjCpfFornecedorLimpo = cnpjCpfFornecedor.replace(/\D/g, '');
                    return cnpjCpfFornecedor === cnpj || cnpjCpfFornecedor === cnpjDecodificado || cnpjCpfFornecedorLimpo === cnpjLimpo;
                  });
                  
                  if (despesasDeputado.length > 0) {
                    transacoes.push(...despesasDeputado);
                  }
                }
              }
            } catch (error) {
              console.warn(`[FirestoreService v3] ⚠️ Erro ao buscar deputado ${deputadoId}:`, error);
            }
          }
          
          console.log(`[FirestoreService v3] ✅ Busca direcionada encontrou ${transacoes.length} transações`);
        } else {
          console.log(`[FirestoreService v3] ⚠️ Fornecedor sem relacionamentoDeputados, usando busca completa...`);
          console.log(`[FirestoreService v3] 🔍 Debug fornecedor:`, {
            temRelacionamentoDeputados: !!fornecedor.relacionamentoDeputados,
            tipoRelacionamento: typeof fornecedor.relacionamentoDeputados,
            ehArray: Array.isArray(fornecedor.relacionamentoDeputados),
            tamanhoArray: fornecedor.relacionamentoDeputados?.length || 0,
            chavesDisponives: Object.keys(fornecedor || {})
          });
          // Fallback para busca completa (método anterior)
          transacoes = await this.buscarTransacoesFornecedor(cnpj, ano, mes);
        }
        
        console.log(`[FirestoreService v3] 📊 Resultado do fallback: ${transacoes.length} transações encontradas`);
      }
      
      // Filtrar por mês se necessário (só se não foi filtrado na nova estrutura)
      if (mes && mes !== 'todos' && transacoes.length > 0) {
        const mesNumerico = parseInt(mes);
        const transacoesAntes = transacoes.length;
        transacoes = transacoes.filter(t => {
          // Verificar se já tem o campo mes ou extrair da data
          if (t.mes !== undefined) {
            return t.mes === mesNumerico;
          }
          // Fallback: extrair mês da dataDocumento
          if (t.dataDocumento) {
            const data = t.dataDocumento.toDate ? t.dataDocumento.toDate() : new Date(t.dataDocumento);
            return data.getMonth() + 1 === mesNumerico;
          }
          return false;
        });
        console.log(`[FirestoreService v3] 📅 Filtro de mês ${mes}: ${transacoesAntes} → ${transacoes.length} transações`);
      }
      
      // DEDUPLICAÇÃO PREVENTIVA: Aplicar também aqui para remover duplicatas entre estruturas
      if (transacoes.length > 0) {
        const transacoesAntes = transacoes.length;
        transacoes = this.deduplicarTransacoes(transacoes);
        const duplicatasRemovidas = transacoesAntes - transacoes.length;
        
        if (duplicatasRemovidas > 0) {
          console.warn(`[FirestoreService v3] ⚠️ DUPLICATAS ENTRE ESTRUTURAS REMOVIDAS: ${duplicatasRemovidas} de ${transacoesAntes}`);
        }
      }
      
      // Ordenar por valor
      transacoes.sort((a, b) => (b.valorLiquido || 0) - (a.valorLiquido || 0));

      console.timeEnd(timerId);
      console.log(`[FirestoreService v3] ✅ Busca combinada concluída: fornecedor encontrado, ${transacoes.length} transações`);

      return { fornecedor, transacoes };

    } catch (error) {
      console.error(`[FirestoreService v3] ❌ Erro na busca combinada para ${cnpj}:`, error);
      // Limpar timer em caso de erro
      try { console.timeEnd(timerId); } catch {}
      return { fornecedor: null, transacoes: [] };
    }
  }

  /**
   * ✅ ESTRUTURA UNIFICADA: Buscar transações do fornecedor
   * Acessa a nova estrutura: fornecedores/{cnpj}/transacoes/{ano-mes}
   * ATUALIZADO para a estrutura unificada implementada
   */
  async buscarTransacoesFornecedorUnificado(cnpj: string, ano: number, mes: string = 'todos'): Promise<any[]> {
    try {
      console.log(`[FirestoreService UNIFICADO] 🔍 Buscando transações na nova estrutura - CNPJ: ${cnpj}, Ano: ${ano}, Mês: ${mes}`);
      
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      const todasTransacoes: any[] = [];
      
      if (mes !== 'todos') {
        // ✅ NOVA ESTRUTURA: Buscar mês específico em fornecedores/{cnpj}/transacoes/{ano-mes}
        const chaveTransacao = `${ano}-${mes.padStart(2, '0')}`;
        console.log(`[FirestoreService UNIFICADO] 📂 Buscando: fornecedores/${cnpjLimpo}/transacoes/${chaveTransacao}`);
        
        const transacaoRef = doc(db, 'fornecedores', cnpjLimpo, 'transacoes', chaveTransacao);
        const transacaoSnapshot = await getDoc(transacaoRef);
        
        if (transacaoSnapshot.exists()) {
          const transacaoData = transacaoSnapshot.data();
          if (transacaoData.transacoes && Array.isArray(transacaoData.transacoes)) {
            todasTransacoes.push(...transacaoData.transacoes);
            console.log(`[FirestoreService UNIFICADO] ✅ ${transacaoData.transacoes.length} transações em ${mes}/${ano}`);
          }
        }
      } else {
        // ✅ NOVA ESTRUTURA: Buscar TODOS os meses do ano em fornecedores/{cnpj}/transacoes/
        console.log(`[FirestoreService UNIFICADO] 📂 Buscando todas as transações de ${ano} em fornecedores/${cnpjLimpo}/transacoes/`);
        
        const transacoesRef = collection(db, 'fornecedores', cnpjLimpo, 'transacoes');
        const queryAno = query(transacoesRef, where('__name__', '>=', `${ano}-01`), where('__name__', '<=', `${ano}-12`));
        const querySnapshot = await getDocs(queryAno);
        
        if (!querySnapshot.empty) {
          console.log(`[FirestoreService UNIFICADO] ✅ Encontrados ${querySnapshot.docs.length} meses com transações em ${ano}`);
          
          let transacoesNoAno = 0;
          querySnapshot.docs.forEach(transacaoDoc => {
            const transacaoData = transacaoDoc.data();
            if (transacaoData.transacoes && Array.isArray(transacaoData.transacoes)) {
              todasTransacoes.push(...transacaoData.transacoes);
              transacoesNoAno += transacaoData.transacoes.length;
              console.log(`[FirestoreService UNIFICADO] ✅ ${transacaoDoc.id}: ${transacaoData.transacoes.length} transações`);
            }
          });
          
          console.log(`[FirestoreService UNIFICADO] ✅ Total: ${transacoesNoAno} transações em ${ano}`);
        }
      }
      
      if (todasTransacoes.length === 0) {
        console.log(`[FirestoreService UNIFICADO] ℹ️ Estrutura unificada não possui dados para ${cnpj} em ${ano}/${mes} - tentando fallback...`);
        return [];
      }
      
      console.log(`[FirestoreService UNIFICADO] ✅ Total encontrado: ${todasTransacoes.length} transações`);
      return todasTransacoes;
      
    } catch (error) {
      console.error(`[FirestoreService UNIFICADO] ❌ Erro ao buscar transações do fornecedor ${cnpj}:`, error);
      return [];
    }
  }

  // Método auxiliar para calcular índice de suspeição
  private calcularIndiceSuspeicao(data: any, mediaTransacao: number): number {
    // ALGORITMO INVESTIGATIVO BASEADO NA LAVA JATO E PADRÕES DA PF
    let score = 0;
    const numDeputados = data.deputadosAtendidos?.length || 0;
    const valorTotal = data.valorTotalGasto || 0;
    const numTransacoes = data.quantidadeTransacoes || 0;

    // =================================================================
    // 1. ANÁLISE DE CONCENTRAÇÃO (Padrão Operador Financeiro)
    // =================================================================
    if (numDeputados <= 2 && valorTotal > 100000) {
      score += 45; // CRÍTICO: Muito dinheiro, poucos clientes (operador financeiro)
    } else if (numDeputados <= 5 && valorTotal > 500000) {
      score += 35; // ALTO: Concentração suspeita
    } else if (numDeputados <= 3) {
      score += 25; // MÉDIO: Poucos clientes
    }

    // =================================================================
    // 2. ANÁLISE DE SUPERFATURAMENTO (Padrão Lava Jato: 1-5% dos contratos)
    // =================================================================
    if (mediaTransacao > 50000) {
      score += 30; // Valores muito altos por transação
    } else if (mediaTransacao > 20000) {
      score += 20; // Valores altos
    }

    // =================================================================
    // 3. ANÁLISE DE VOLUME VS ESTRUTURA (Fornecedor Fantasma)
    // =================================================================
    if (valorTotal > 1000000 && numDeputados <= 3) {
      score += 25; // Milhões de reais com pouquíssimos clientes
    }

    // =================================================================
    // 4. ANÁLISE DE EFICIÊNCIA SUSPEITA (Poucas transações, muito dinheiro)
    // =================================================================
    if (numTransacoes > 0) {
      const eficiencia = valorTotal / numTransacoes;
      if (eficiencia > 100000 && numTransacoes < 10) {
        score += 20; // Muito dinheiro em poucas transações
      }
    }

    // =================================================================
    // 5. ANÁLISE DE CATEGORIAS MÚLTIPLAS (Diversificação suspeita)
    // =================================================================
    const categorias = data.categoriasGasto?.length || 1;
    if (categorias > 8 && numDeputados < 10) {
      score += 15; // Muitas categorias diferentes para poucos clientes
    }

    // =================================================================
    // 6. THRESHOLDS ESPECÍFICOS DA LAVA JATO
    // =================================================================
    
    // Threshold 1: "Operador de Cartel" (padrão construtoras Lava Jato)
    if (valorTotal > 2000000 && numDeputados >= 10 && mediaTransacao > 30000) {
      score += 20; // Perfil de grande operador
    }

    // Threshold 2: "Concentração Monopolística" 
    if (numDeputados === 1 && valorTotal > 200000) {
      score += 30; // Relação exclusiva suspeita
    }

    // Threshold 3: "Volume de Lavagem" (baseado em casos reais)
    if (valorTotal > 5000000) {
      score += 15; // Volume compatível com lavagem de dinheiro
    }

    // =================================================================
    // 7. SCORES DINÂMICOS (baseados em percentis)
    // =================================================================
    
    // Se está no top 1% de volume mas bottom 10% de clientes = SUSPEITO
    // Nota: Seria calculado com dados reais em produção
    
    // Se tem crescimento > 300% ano a ano = SUSPEITO
    // Nota: Requer dados temporais
    
    return Math.min(score, 100);
  }

  /**
   * MÉTODO INVESTIGATIVO AVANÇADO
   * Aplica algoritmos da Lava Jato para detecção de esquemas sofisticados
   */
  private calcularScoreInvestigativoAvancado(data: any): {
    score: number;
    alertas: string[];
    categoria: 'NORMAL' | 'SUSPEITO' | 'ALTO_RISCO' | 'ORGANIZACAO_CRIMINOSA';
  } {
    const alertas: string[] = [];
    let score = this.calcularIndiceSuspeicao(data, data.mediaTransacao || 0);

    // =================================================================
    // DETECÇÃO DE PADRÕES ESPECÍFICOS DA LAVA JATO
    // =================================================================

    const numDeputados = data.deputadosAtendidos?.length || 0;
    const valorTotal = data.valorTotalGasto || 0;
    const mediaTransacao = data.mediaTransacao || 0;

    // Padrão 1: "Cartel de Preços"
    if (this.detectarValoresRedondosSuspeitos(data)) {
      score += 15;
      alertas.push('Padrão de valores redondos suspeito (possível cartel)');
    }

    // Padrão 2: "Operador Financeiro de Esquema"
    if (numDeputados <= 3 && valorTotal > 1000000) {
      score += 25;
      alertas.push('Perfil compatível com operador financeiro de esquema');
    }

    // Padrão 3: "Superfaturamento Sistemático"
    if (mediaTransacao > 100000 && numDeputados < 5) {
      score += 20;
      alertas.push('Indícios de superfaturamento sistemático');
    }

    // Padrão 4: "Fornecedor Fantasma"
    if (numDeputados === 1 && valorTotal > 500000) {
      score += 30;
      alertas.push('Possível fornecedor fantasma (relação exclusiva)');
    }

    // Classificação final
    let categoria: 'NORMAL' | 'SUSPEITO' | 'ALTO_RISCO' | 'ORGANIZACAO_CRIMINOSA';
    
    if (score >= 80) categoria = 'ORGANIZACAO_CRIMINOSA';
    else if (score >= 60) categoria = 'ALTO_RISCO';
    else if (score >= 40) categoria = 'SUSPEITO';
    else categoria = 'NORMAL';

    return { score: Math.min(score, 100), alertas, categoria };
  }

  /**
   * Detecta padrões de valores redondos suspeitos
   */
  private detectarValoresRedondosSuspeitos(data: any): boolean {
    // Em produção, analisaria as transações individuais
    // Por ora, usa heurística baseada na média
    const media = data.mediaTransacao || 0;
    const valorTotal = data.valorTotalGasto || 0;
    
    // Se valores são múltiplos exatos de 1000, é suspeito
    return (media % 1000 === 0 && media > 5000) || (valorTotal % 10000 === 0 && valorTotal > 50000);
  }

  /**
   * Busca detalhes de um fornecedor, combinando o perfil pré-agregado com as transações em tempo real.
   */
  async buscarFornecedorDetalhes(cnpj: string, ano: number): Promise<FornecedorDetalhado | null> {
    try {
      console.log(`[Cache] Buscando detalhes para o fornecedor CNPJ: ${cnpj}, Ano: ${ano}`);

      // 1. Buscar o perfil pré-agregado (rápido)
      const perfil = await this.buscarPerfilFornecedor(cnpj);
      if (!perfil) {
        // Se não houver perfil, talvez seja um fornecedor novo. Poderíamos cair para o método antigo.
        // Por enquanto, vamos apenas retornar nulo para consistência.
        console.warn(`Nenhum perfil pré-agregado encontrado para ${cnpj}. A busca em tempo real não será executada.`);
        return null;
      }

      // 2. Buscar as transações individuais (ainda necessário para a lista detalhada)
      const deputados = await this.buscarDeputados({}); // Idealmente, isso também seria otimizado
      const transacoes: (DespesaFirestore & { nomeDeputado?: string })[] = [];

      for (const deputado of deputados) {
        const despesas = await this.buscarDespesasDeputado(deputado.id, ano, 'todos');
        for (const despesa of despesas) {
          if (despesa.cnpjCpfFornecedor?.trim() === cnpj) {
            transacoes.push({ ...despesa, nomeDeputado: deputado.nome || deputado.nomeCivil || deputado.id });
          }
        }
      }

      // 3. Combinar o perfil com as transações
      return {
        ...perfil,
        transacoes: transacoes,
      };

    } catch (error) {
      console.error(`Erro ao buscar detalhes do fornecedor ${cnpj}:`, error);
      return null;
    }
  }

  /**
   * Busca ranking de despesas de forma otimizada.
   * 1. Busca IDs de deputados que têm dados de despesa.
   * 2. Para cada ID, busca os detalhes do deputado e suas despesas.
   * 3. Calcula o total e retorna o ranking ordenado.
   */
  async buscarRankingDespesas(opcoes: {
    ano: number;
    mes: number | string;
    tipoDespesa?: string;
    uf?: string;
  }) {
    try {
      // Etapa 1: Buscar deputados, aplicando filtro de UF se fornecido.
      console.log(`[FirestoreService V2] Iniciando busca de ranking. Filtros:`, opcoes);
      const deputados = await this.buscarDeputados({ uf: opcoes.uf });

      if (!deputados || deputados.length === 0) {
        console.log('[FirestoreService V2] Nenhum deputado encontrado para os filtros.');
        return [];
      }
      console.log(`[FirestoreService V2] ${deputados.length} deputados encontrados. Calculando despesas...`);

      // Etapa 2: Para cada deputado, buscar despesas e calcular o total.
      const rankingPromises = deputados.map(async (deputado) => {
        const despesas = await this.buscarDespesasDeputado(
          deputado.id,
          opcoes.ano,
          opcoes.mes
        );

        const despesasFiltradas = opcoes.tipoDespesa
          ? despesas.filter(d => d.tipoDespesa === opcoes.tipoDespesa)
          : despesas;
        
        const valorTotal = despesasFiltradas.reduce((sum, d) => sum + this.parseValor(d.valorLiquido), 0);

        return {
          id: deputado.id,
          nome: deputado.nome || deputado.nomeCivil || 'Nome não informado',
          partido: deputado.siglaPartido || 'N/A',
          uf: deputado.siglaUf || 'N/A',
          valorTotal,
          foto: deputado.urlFoto,
        };
      });

      const rankingCompletos = await Promise.all(rankingPromises);

      // Etapa 3: Filtrar deputados sem despesas e ordenar o ranking final.
      const rankingFinal = rankingCompletos
        .filter(d => d.valorTotal > 0)
        .sort((a, b) => b.valorTotal - a.valorTotal);
      
      console.log(`[FirestoreService V2] Ranking final calculado com ${rankingFinal.length} deputados.`);
      return rankingFinal;

    } catch (error) {
      console.error('[FirestoreService V2] Erro ao buscar ranking:', error);
      throw error;
    }
  }

  /**
   * Buscar fornecedor específico por CNPJ
   * Implementa busca normalizada com fallback para diferentes formatos
   */
  async buscarFornecedorPorCNPJ(cnpj: string): Promise<any | null> {
    try {
      console.log(`[FirestoreService] 🔍 Buscando fornecedor por CNPJ: ${cnpj}`);
      
      // ✅ UNIFICADO: Tentar primeiro buscar da estrutura unificada despesas/fornecedores
      const perfilCompleto = await this.buscarPerfilFornecedorUnificado(cnpj);
      if (perfilCompleto) {
        console.log(`[FirestoreService UNIFICADO] ✅ Encontrado na estrutura unificada despesas/fornecedores`);
        return perfilCompleto;
      }
      
      // Fallback para coleção antiga perfisFornecedores
      const perfisRef = collection(db, 'perfisFornecedores');
      
      // Normalizar CNPJ (sem formatação)
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      
      // Tentar buscar com CNPJ formatado original
      let q = query(perfisRef, where('cnpj', '==', cnpj));
      let snapshot = await getDocs(q);
      
      // Se não encontrou, tentar com CNPJ sem formatação
      if (snapshot.empty && cnpjLimpo !== cnpj) {
        console.log(`[FirestoreService] 🔄 Tentando busca com CNPJ limpo: ${cnpjLimpo}`);
        q = query(perfisRef, where('cnpj', '==', cnpjLimpo));
        snapshot = await getDocs(q);
      }
      
      if (snapshot.empty) {
        console.warn(`[FirestoreService] ⚠️ Fornecedor não encontrado em nenhum formato: ${cnpj} / ${cnpjLimpo}`);
        return null;
      }
      
      const doc = snapshot.docs[0];
      const data = doc.data();
      
      // Aplicar algoritmos investigativos
      const analiseInvestigativa = this.calcularScoreInvestigativoAvancado(data);
      
      return {
        id: doc.id,
        cnpj: data.cnpj || cnpj,
        nome: data.nome || 'Nome não informado',
        totalRecebido: data.valorTotalGasto || 0,
        numTransacoes: data.quantidadeTransacoes || 0,
        deputadosAtendidos: data.deputadosAtendidos || [],
        deputadosNomes: data.deputadosNomes || [],
        categorias: data.categoriasGasto || ['Não especificado'],
        mediaTransacao: data.mediaTransacao || 0,
        valorMedioTransacao: data.mediaTransacao || 0,
        maiorTransacao: data.maiorTransacao || 0,
        menorTransacao: data.menorTransacao || 0,
        indiceSuspeicao: analiseInvestigativa.score,
        scoreSuspeicao: analiseInvestigativa.score,
        alertas: analiseInvestigativa.alertas,
        razoesSuspeita: analiseInvestigativa.alertas,
        categoriaRisco: analiseInvestigativa.categoria,
        alertasInvestigativos: analiseInvestigativa.alertas,
        deputadosPorValor: data.deputadosPorValor || {}
      };
      
    } catch (error) {
      console.error(`[FirestoreService] ❌ Erro ao buscar fornecedor ${cnpj}:`, error);
      return null;
    }
  }

  // Cache para transações de fornecedores
  private transacoesCache: Map<string, { data: any[]; timestamp: number }> = new Map();
  private readonly TRANSACOES_CACHE_DURATION = 10 * 60 * 1000; // 10 minutos

  /**
   * Buscar transações de um fornecedor específico - VERSÃO CORRIGIDA
   * Busca na estrutura correta: /despesas/{deputadoId}/anos/{ano}/despesas[array]
   */
  async buscarTransacoesFornecedor(cnpj: string, ano: number, mes: string = 'todos'): Promise<any[]> {
    const cacheKey = `${cnpj}-${ano}-${mes}`;
    const cached = this.transacoesCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.TRANSACOES_CACHE_DURATION) {
      console.log(`[FirestoreService v3] ⚡ Cache hit - ${cached.data.length} transações para ${cnpj}`);
      return cached.data;
    }

    try {
      console.time(`buscarTransacoesFornecedor-${cnpj}`);
      console.log(`[FirestoreService v3] 🔍 Buscando transações do fornecedor ${cnpj} - ${ano}/${mes}`);
      console.log(`[FirestoreService v3] 📍 Estrutura correta: /despesas/{deputadoId}/anos/${ano}/despesas[array]`);

      // Normalizar CNPJ (sem formatação)
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      const cnpjsParaBuscar = [cnpj, cnpjLimpo].filter((c, i, arr) => arr.indexOf(c) === i); // Remove duplicatas
      
      console.log(`[FirestoreService v3] 🔍 Buscando CNPJs: ${cnpjsParaBuscar.join(', ')}`);
      
      const todasTransacoes: any[] = [];
      
      // Buscar em todos os documentos de deputados para o ano específico
      const despesasRef = collection(db, 'despesas');
      const despesasSnapshot = await getDocs(despesasRef);
      
      console.log(`[FirestoreService v3] 📊 Analisando ${despesasSnapshot.docs.length} deputados...`);
      
      let deputadosAnalisados = 0;
      let deputadosComDados = 0;
      
      for (const deputadoDoc of despesasSnapshot.docs) {
        deputadosAnalisados++;
        
        try {
          // Buscar ano específico
          const anoRef = doc(db, 'despesas', deputadoDoc.id, 'anos', ano.toString());
          const anoSnapshot = await getDoc(anoRef);
          
          if (anoSnapshot.exists()) {
            const anoData = anoSnapshot.data();
            if (anoData.despesas && Array.isArray(anoData.despesas)) {
              deputadosComDados++;
              
              // Filtrar despesas por CNPJ
              const despesasDeputado = anoData.despesas.filter((despesa: any) => {
                const cnpjCpfFornecedor = despesa.cnpjCpfFornecedor || '';
                return cnpjsParaBuscar.includes(cnpjCpfFornecedor);
              });
              
              if (despesasDeputado.length > 0) {
                console.log(`[FirestoreService v3] ✅ Encontradas ${despesasDeputado.length} transações no deputado ${deputadoDoc.id}`);
                todasTransacoes.push(...despesasDeputado);
              }
            }
          }
        } catch (error) {
          // Ignorar erros de deputados específicos
          if (deputadosAnalisados <= 5) {
            console.warn(`[FirestoreService v3] ⚠️ Erro ao analisar deputado ${deputadoDoc.id}:`, error);
          }
        }
        
        // Log de progresso a cada 50 deputados
        if (deputadosAnalisados % 50 === 0) {
          console.log(`[FirestoreService v3] 📊 Progresso: ${deputadosAnalisados}/${despesasSnapshot.docs.length} deputados analisados, ${todasTransacoes.length} transações encontradas`);
        }
      }
      
      console.log(`[FirestoreService v3] 📊 Análise completa: ${deputadosAnalisados} deputados, ${deputadosComDados} com dados, ${todasTransacoes.length} transações encontradas`);
      
      // Filtrar por mês se necessário
      let transacoesFiltradas = todasTransacoes;
      if (mes && mes !== 'todos') {
        const mesNumerico = parseInt(mes);
        transacoesFiltradas = todasTransacoes.filter(t => t.mes === mesNumerico);
        console.log(`[FirestoreService v3] 📅 Filtro de mês ${mes}: ${transacoesFiltradas.length} transações`);
      }
      
      // Ordenar por valor
      transacoesFiltradas.sort((a, b) => (b.valorLiquido || 0) - (a.valorLiquido || 0));
      
      this.transacoesCache.set(cacheKey, {
        data: transacoesFiltradas,
        timestamp: Date.now()
      });
      
      console.timeEnd(`buscarTransacoesFornecedor-${cnpj}`);
      console.log(`[FirestoreService v3] ✅ ${transacoesFiltradas.length} transações finais encontradas para ${cnpj}`);
      
      // Log de amostra das transações encontradas
      if (transacoesFiltradas.length > 0) {
        console.log(`[FirestoreService v3] 📋 Amostra das primeiras transações:`, 
          transacoesFiltradas.slice(0, 3).map(t => ({
            deputado: t.deputadoNome,
            valor: t.valorLiquido,
            data: t.dataDocumento,
            categoria: t.tipoDespesa
          }))
        );
      }
      
      return transacoesFiltradas;

    } catch (error) {
      console.error(`[FirestoreService v3] ❌ Erro ao buscar transações do fornecedor ${cnpj}:`, error);
      return [];
    }
  }

  /**
   * NOVO: Busca fornecedores relacionados ao deputado de forma otimizada
   * Usa os dados pré-calculados salvos no documento do deputado (V3)
   */
  async buscarFornecedoresRelacionadosOtimizado(deputadoId: string): Promise<any[]> {
    try {
      console.log(`🚀 [OTIMIZADO] Buscando fornecedores relacionados para deputado ${deputadoId}`);
      
      // Buscar documento principal do deputado na estrutura V3
      const deputadoRef = doc(db, 'despesas', deputadoId);
      const deputadoSnap = await getDoc(deputadoRef);
      
      if (!deputadoSnap.exists()) {
        console.log(`⚠️ Deputado ${deputadoId} não encontrado na estrutura V3`);
        return [];
      }
      
      const data = deputadoSnap.data();
      
      // Verificar se tem fornecedores relacionados otimizados
      if (data.deputado?.fornecedoresRelacionados) {
        console.log(`✅ ${data.deputado.fornecedoresRelacionados.length} fornecedores relacionados encontrados (dados otimizados)`);
        
        // Retornar dados já processados e otimizados
        return data.deputado.fornecedoresRelacionados.map((fornecedor: any) => ({
          nome: fornecedor.nome,
          cnpj: fornecedor.cnpj,
          valor: fornecedor.totalGasto,
          transacoes: fornecedor.numeroTransacoes,
          categorias: fornecedor.categorias || [],
          valorMedio: fornecedor.mediaTransacao,
          maiorTransacao: fornecedor.maiorTransacao,
          menorTransacao: fornecedor.menorTransacao,
          primeiraTransacao: fornecedor.primeiraTransacao,
          ultimaTransacao: fornecedor.ultimaTransacao,
          scoreRisco: fornecedor.scoreRisco,
          alertas: fornecedor.alertas || [],
          // Campos extras para compatibilidade
          nomeFornecedor: fornecedor.nome,
          cnpjCpfFornecedor: fornecedor.cnpj,
          totalGasto: fornecedor.totalGasto,
          numeroTransacoes: fornecedor.numeroTransacoes
        }));
      }
      
      console.log(`⚠️ Deputado ${deputadoId} ainda não possui dados otimizados de fornecedores`);
      console.log('💡 Execute o processador V3 para gerar dados otimizados');
      
      // Fallback: buscar fornecedores da forma tradicional se dados otimizados não existirem
      return this.buscarFornecedoresDeputadoTradicional(deputadoId);
      
    } catch (error) {
      console.error(`❌ Erro ao buscar fornecedores relacionados otimizados para ${deputadoId}:`, error);
      
      // Em caso de erro, tentar fallback tradicional
      return this.buscarFornecedoresDeputadoTradicional(deputadoId);
    }
  }

  /**
   * Método tradicional para buscar fornecedores (fallback)
   */
  private async buscarFornecedoresDeputadoTradicional(deputadoId: string): Promise<any[]> {
    try {
      console.log(`🔄 [FALLBACK] Buscando fornecedores de forma tradicional para deputado ${deputadoId}`);
      
      // Buscar despesas do deputado e processar fornecedores
      const despesas = await this.buscarDespesasDeputado(deputadoId, new Date().getFullYear());
      
      if (despesas.length === 0) {
        return [];
      }
      
      // Agrupar fornecedores manualmente
      const fornecedoresMap: Record<string, any> = {};
      
      despesas.forEach(despesa => {
        const nome = despesa.nomeFornecedor || 'Não informado';
        const cnpj = despesa.cnpjCpfFornecedor || '';
        const valor = parseFloat(despesa.valorLiquido?.toString() || despesa.valorDocumento?.toString() || '0');
        
        const chave = `${nome}|${cnpj}`;
        
        if (!fornecedoresMap[chave]) {
          fornecedoresMap[chave] = {
            nome,
            cnpj,
            valor: 0,
            transacoes: 0,
            categorias: new Set<string>(),
            valores: []
          };
        }
        
        fornecedoresMap[chave].valor += valor;
        fornecedoresMap[chave].transacoes += 1;
        fornecedoresMap[chave].valores.push(valor);
        
        if (despesa.tipoDespesa) {
          fornecedoresMap[chave].categorias.add(despesa.tipoDespesa);
        }
      });
      
      // Converter para array final
      const fornecedores = Object.values(fornecedoresMap).map((f: any) => ({
        nome: f.nome,
        cnpj: f.cnpj,
        valor: f.valor,
        transacoes: f.transacoes,
        categorias: Array.from(f.categorias),
        valorMedio: f.valor / f.transacoes,
        maiorTransacao: Math.max(...f.valores),
        menorTransacao: Math.min(...f.valores),
        scoreRisco: 0, // Não calculado no fallback
        alertas: []
      })).sort((a, b) => b.valor - a.valor);
      
      console.log(`✅ [FALLBACK] ${fornecedores.length} fornecedores processados tradicionalmente`);
      return fornecedores;
      
    } catch (error) {
      console.error(`❌ Erro no fallback tradicional para ${deputadoId}:`, error);
      return [];
    }
  }

  /**
   * Verificar status das coleções no Firestore
   */
  async verificarStatusColecoes(): Promise<{
    deputados: number;
    fornecedores: number;
    hasData: boolean;
  }> {
    try {
      console.log('🔍 Verificando status das coleções no Firestore...');
      
      // Verificar deputados
      const deputadosRef = collection(db, 'deputados');
      const deputadosSnapshot = await getDocs(query(deputadosRef, limit(1)));
      const temDeputados = deputadosSnapshot.size;
      
      // Verificar fornecedores
      const fornecedoresRef = collection(db, 'perfisFornecedores');
      const fornecedoresSnapshot = await getDocs(query(fornecedoresRef, limit(1)));
      const temFornecedores = fornecedoresSnapshot.size;
      
      const status = {
        deputados: temDeputados,
        fornecedores: temFornecedores,
        hasData: temDeputados > 0 || temFornecedores > 0
      };
      
      console.log('📊 Status das coleções:', status);
      return status;
      
    } catch (error) {
      console.error('❌ Erro ao verificar status das coleções:', error);
      return { deputados: 0, fornecedores: 0, hasData: false };
    }
  }

  private static perfilFornecedoresPromise: Promise<PerfilFornecedorCompleto[]> | null = null;

  /**
   * Buscar todos os perfis completos de fornecedores da nova coleção
   * Implementa paginação para processar todos os 15000+ fornecedores
   * ✅ PROTEÇÃO CONTRA CHAMADAS SIMULTÂNEAS
   */
  async buscarPerfisFornecedoresCompletos(): Promise<PerfilFornecedorCompleto[]> {
    console.log('[PerfilFornecedores] 🚀 ⭐ INICIANDO BUSCA DE PERFIS FORNECEDORES COMPLETOS ⭐')
    
    // Se já existe uma promise em andamento, reutilizá-la
    if (FirestoreService.perfilFornecedoresPromise) {
      console.log('[PerfilFornecedores] ⏳ Reutilizando promise em andamento...');
      try {
        const result = await FirestoreService.perfilFornecedoresPromise;
        console.log(`[PerfilFornecedores] ✅ Promise reutilizada com sucesso - ${result?.length || 0} perfis`);
        return result;
      } catch (error) {
        console.error('[PerfilFornecedores] ❌ Erro na promise reutilizada:', error);
        // Limpar promise com erro e tentar novamente
        FirestoreService.perfilFornecedoresPromise = null;
      }
    }

    const cacheKey = 'perfis-fornecedores-completos';
    
    // Verificar cache primeiro
    const cached = this.fornecedoresCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
      console.log(`[PerfilFornecedores] ✅ Cache hit - ${cached.data.length} perfis completos`);
      return cached.data as unknown as PerfilFornecedorCompleto[];
    }

    console.log('[PerfilFornecedores] 📊 Cache miss ou expirado, iniciando busca no Firestore...')
    console.log(`[PerfilFornecedores] 🔧 DB Status:`, {
      isConnected: !!db,
      appName: db?.app?.name,
      projectId: db?.app?.options?.projectId
    })

    // Criar nova promise e armazenar
    FirestoreService.perfilFornecedoresPromise = this.executarBuscaPerfisFornecedores(cacheKey);
    
    try {
      console.log('[PerfilFornecedores] ⏳ Aguardando execução da busca...')
      const result = await FirestoreService.perfilFornecedoresPromise;
      console.log(`[PerfilFornecedores] ✅ BUSCA CONCLUÍDA COM SUCESSO - ${result?.length || 0} perfis obtidos`)
      return result;
    } catch (error) {
      console.error('[PerfilFornecedores] ❌ ERRO NA BUSCA DE PERFIS:', {
        errorType: error?.constructor?.name,
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 3) : 'Stack não disponível'
      });
      throw error;
    } finally {
      // Limpar a promise após conclusão (sucesso ou erro)
      console.log('[PerfilFornecedores] 🧹 Limpando promise armazenada')
      FirestoreService.perfilFornecedoresPromise = null;
    }
  }

  // ⚡ CONTROLE GLOBAL DE QUERIES ATIVAS para evitar Target ID conflicts
  private activeQueries = new Map<string, { controller: AbortController, timestamp: number }>()
  private docQueries = new Map<string, { promise: Promise<any>, timestamp: number }>()
  
  private async executarBuscaPerfisFornecedores(cacheKey: string): Promise<PerfilFornecedorCompleto[]> {
    // ⚡ DECLARAR QUERYID NO ESCOPO PRINCIPAL
    const queryId = `${cacheKey}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log('[PerfilFornecedores] 🔄 Buscando TODOS os perfis completos de fornecedores com paginação...');
      console.log(`[PerfilFornecedores] 🆕 Iniciando query: ${queryId}`);
      
      // ⚡ CANCELAR QUERY ANTERIOR SE EXISTIR
      if (this.activeQueries.has(cacheKey)) {
        const activeQuery = this.activeQueries.get(cacheKey);
        console.log(`[PerfilFornecedores] ⏹️ Cancelando query anterior para ${cacheKey} (idade: ${Date.now() - activeQuery!.timestamp}ms)`);
        activeQuery!.controller.abort();
        this.activeQueries.delete(cacheKey);
        
        // Aguardar mais tempo para garantir que o Target ID seja liberado
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`[PerfilFornecedores] ✅ Query anterior cancelada, prosseguindo com nova query`);
      }
      
      // ⚡ CRIAR NOVO CONTROLLER PARA ESTA QUERY
      const abortController = new AbortController();
      console.log(`[PerfilFornecedores] 🎯 Registrando controller para query: ${queryId}`);
      this.activeQueries.set(cacheKey, { controller: abortController, timestamp: Date.now() });
      
      // ✅ VERIFICAR CONECTIVIDADE FIREBASE PRIMEIRO
      if (!db) {
        this.activeQueries.delete(cacheKey);
        throw new Error('Firestore não inicializado');
      }
      
      // ✅ ESTRUTURA UNIFICADA: Buscar diretamente na coleção fornecedores/{cnpj}
      const fornecedoresRef = collection(db, 'fornecedores');
      const batchSize = 500; // Batch size otimizado para processar mais fornecedores por vez
      const maxBatches = 100; // Reduzido já que cada batch é maior (500 x 100 = 50.000)
      const allPerfis: PerfilFornecedorCompleto[] = [];
      let lastDoc: QueryDocumentSnapshot | null = null;
      let batchCount = 0;
      let querySnapshot;
      
      do {
        // ConstruirQuery com paginação
        let currentQuery = query(fornecedoresRef, limit(batchSize));
        if (lastDoc) {
          currentQuery = query(fornecedoresRef, startAfter(lastDoc), limit(batchSize));
        }
        
        console.log(`[PerfilFornecedores] 📦 Processando batch ${batchCount + 1} (${allPerfis.length} perfis carregados)...`);
        
        try {
          // ⚡ OTIMIZAÇÃO: Usar getDocs com timeout adequado
          const queryPromise = getDocs(currentQuery);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000) // Timeout aumentado para 15s
          );
          
          querySnapshot = await Promise.race([queryPromise, timeoutPromise]) as QuerySnapshot;
          const batchPerfis = querySnapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id
          })) as unknown as PerfilFornecedorCompleto[];
          
          allPerfis.push(...batchPerfis);
          console.log(`[PerfilFornecedores] ✅ Batch ${batchCount + 1} concluído: +${batchPerfis.length} perfis (total: ${allPerfis.length})`);
        } catch (error) {
          if (error.message === 'Query timeout') {
            console.warn(`[PerfilFornecedores] ⚠️ Timeout no batch ${batchCount + 1}, continuando com próximo batch. Perfis carregados: ${allPerfis.length}`);
            // Não quebrar o loop, apenas continuar com o próximo batch
            querySnapshot = null;
          } else {
            console.error(`[PerfilFornecedores] ❌ Erro no batch ${batchCount + 1}:`, error);
            break; // Quebrar apenas em erros reais, não timeouts
          }
        }
        
        // Atualizar lastDoc para próximo batch (apenas se querySnapshot foi definido)
        if (querySnapshot && querySnapshot.docs.length > 0) {
          lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
        } else {
          lastDoc = null; // Não há mais documentos ou ocorreu erro
        }
        
        batchCount++;
        
        // Log de progresso a cada 5 batches
        if (batchCount % 5 === 0) {
          console.log(`[PerfilFornecedores] 📊 Progresso: ${allPerfis.length} perfis processados em ${batchCount} batches`);
        }
        
        // Continue até não haver mais documentos ou atingir limite máximo
        // CORREÇÃO: Remover condição de batchSize para não parar prematuramente
      } while (lastDoc && querySnapshot && querySnapshot.docs.length > 0 && batchCount < maxBatches);
      
      // Log final detalhado
      if (batchCount >= maxBatches) {
        console.warn(`[PerfilFornecedores] ⚠️ Atingiu limite máximo de ${maxBatches} batches`);
        console.warn(`[PerfilFornecedores] 📊 Resultado: ${allPerfis.length} perfis carregados`);
        console.warn(`[PerfilFornecedores] 💡 Considere aumentar maxBatches se necessário carregar mais fornecedores`);
      } else {
        console.log(`[PerfilFornecedores] ✅ Carregamento completo: ${allPerfis.length} perfis em ${batchCount} batches`);
        console.log(`[PerfilFornecedores] 🎯 Motivo da parada: ${!lastDoc ? 'Sem mais documentos' : !querySnapshot ? 'QuerySnapshot nulo' : querySnapshot.docs.length === 0 ? 'Batch vazio' : 'Condição de parada não identificada'}`);
      }
      
      // Armazenar no cache
      this.fornecedoresCache.set(cacheKey, {
        data: allPerfis as any,
        timestamp: Date.now()
      });
      
      console.log(`[PerfilFornecedores] ✅ PROCESSAMENTO COMPLETO: ${allPerfis.length} perfis completos carregados em ${batchCount} batches`);
      console.log(`[PerfilFornecedores] 📊 Distribuição de scores:`, {
        comScore: allPerfis.filter(p => p.scores?.scoreGeral && p.scores.scoreGeral > 0).length,
        scoreAlto: allPerfis.filter(p => p.scores?.scoreGeral && p.scores.scoreGeral >= 70).length,
        organizacaoCriminosa: allPerfis.filter(p => p.classificacaoLavaJato === 'ORGANIZACAO_CRIMINOSA').length
      });
      
      // ⚡ CLEANUP: Remover query ativa do controle
      console.log(`[PerfilFornecedores] 🧹 Limpando query ${queryId} (${allPerfis.length} perfis carregados)`);
      this.activeQueries.delete(cacheKey);
      
      return allPerfis;
      
    } catch (error) {
      console.error('[PerfilFornecedores] ❌ Erro ao buscar perfis completos:', error);
      console.warn('[PerfilFornecedores] 🆘 Retornando array vazio para ativar fallback no FornecedoresService');
      
      // ⚡ CLEANUP: Remover query ativa em caso de erro
      console.log(`[PerfilFornecedores] 🧹 Limpando query ${queryId} por erro`);
      this.activeQueries.delete(cacheKey);
      
      return []; // Retornar array vazio para ativar o fallback no FornecedoresService
    }
  }

  /**
   * ⚡ WRAPPER SEGURO para getDoc - evita Target ID conflicts
   * Usa cache de promises para evitar múltiplas queries simultâneas
   */
  async buscarDocumentoSeguro(caminho: string): Promise<any> {
    const cacheKey = `doc_${caminho}`;
    const CACHE_TTL = 2 * 60 * 1000; // 2 minutos
    
    // Verificar se já existe uma query em andamento
    const cached = this.docQueries.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`🔄 [DocQuery] Reutilizando promise para ${caminho}`);
      return cached.promise;
    }
    
    // Criar nova promise e armazenar no cache
    const promise = this.executarBuscaDocumento(caminho);
    this.docQueries.set(cacheKey, { promise, timestamp: Date.now() });
    
    // Limpar cache após conclusão
    promise.finally(() => {
      setTimeout(() => {
        this.docQueries.delete(cacheKey);
      }, 1000);
    });
    
    return promise;
  }
  
  private async executarBuscaDocumento(caminho: string): Promise<any> {
    try {
      console.log(`📄 [DocQuery] Buscando documento: ${caminho}`);
      
      if (!db) {
        throw new Error('Firestore não inicializado');
      }
      
      const { doc, getDoc } = await import('firebase/firestore');
      const docRef = doc(db, ...caminho.split('/'));
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        console.log(`✅ [DocQuery] Documento encontrado: ${caminho}`);
        return docSnap.data();
      } else {
        console.log(`⚠️ [DocQuery] Documento não existe: ${caminho}`);
        return null;
      }
    } catch (error) {
      console.error(`❌ [DocQuery] Erro ao buscar ${caminho}:`, error);
      throw error;
    }
  }

  /**
   * Buscar perfil completo específico por CNPJ
   * ATUALIZADO: Nova estrutura unificada fornecedores/{cnpj}
   */
  async buscarPerfilFornecedorUnificado(cnpj: string): Promise<PerfilFornecedorCompleto | null> {
    try {
      console.log(`[Fornecedores UNIFICADO] 🔍 Buscando perfil completo para CNPJ: ${cnpj}`);
      
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      // ✅ ESTRUTURA UNIFICADA: fornecedores/{cnpj}
      const docRef = doc(db, 'fornecedores', cnpjLimpo);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const perfil = { ...docSnap.data(), id: docSnap.id } as unknown as PerfilFornecedorCompleto;
        console.log(`[Fornecedores UNIFICADO] ✅ Perfil completo encontrado para ${cnpj}`);
        return perfil;
      } else {
        // ✅ Só mostrar warning se o banco não estiver vazio
        const bancoVazio = await this.isBancoVazio();
        if (!bancoVazio) {
          console.warn(`[Fornecedores UNIFICADO] ⚠️ Perfil não encontrado para CNPJ: ${cnpj}`);
        }
        return null;
      }
      
    } catch (error) {
      console.error(`[PerfilFornecedores] ❌ Erro ao buscar perfil ${cnpj}:`, error);
      throw error;
    }
  }

  /**
   * Busca transações diretamente por categoria
   */
  async buscarTransacoesPorCategoria(categoria: string, ano?: number): Promise<any[]> {
    try {
      console.log(`🔍 [buscarTransacoesPorCategoria] Buscando transações para categoria: "${categoria}", ano: ${ano || 'todos'}`);
      
      const todasTransacoes: any[] = [];
      
      // ESTRATÉGIA SIMPLIFICADA: Usar o serviço unificado como as outras páginas
      console.log(`📋 [Estratégia SIMPLIFICADA] Buscando via fornecedoresService.buscarFornecedoresUnificado...`);
      
      try {
        // Importar o service dinamicamente
        const { fornecedoresService } = await import('@/services/fornecedores-service');
        
        // Buscar fornecedores como a FornecedoresPage faz
        const anosParaBuscar = ano ? [ano] : Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - i); // 2025 até 2015
        console.log(`📅 [Estratégia SIMPLIFICADA] Testando anos: ${anosParaBuscar.slice(0, 5).join(', ')}...`);
        
        let fornecedoresEncontrados = 0;
        
        for (const anoAtual of anosParaBuscar) {
          try {
            console.log(`📅 Buscando fornecedores do ano ${anoAtual}...`);
            
            const response = await fornecedoresService.buscarFornecedoresUnificado({
              ano: anoAtual,
              mes: 'todos',
              limite: 5000, // Buscar todos
              offset: 0,
              apenasComScore: false
            });
            
            console.log(`👥 Ano ${anoAtual}: ${response.fornecedores.length} fornecedores encontrados`);
            
            if (response.fornecedores.length > 0) {
              // Filtrar por categoria
              const fornecedoresDaCategoria = response.fornecedores.filter(fornecedor => {
                // Verificar se atende a categoria
                if (!fornecedor.categorias || !Array.isArray(fornecedor.categorias)) {
                  return false;
                }
                
                return fornecedor.categorias.some(cat => {
                  if (!cat || typeof cat !== 'string') return false;
                  
                  const catNormalizada = cat.toUpperCase().trim();
                  const categoriaNormalizada = categoria.toUpperCase().trim();
                  
                  // Correspondência para locação
                  if (categoriaNormalizada.includes('LOCAÇÃO') || categoriaNormalizada.includes('LOCACAO')) {
                    return catNormalizada.includes('LOCAÇÃO') || 
                           catNormalizada.includes('LOCACAO') || 
                           catNormalizada.includes('FRETAMENTO') ||
                           catNormalizada.includes('VEÍCULO') ||
                           catNormalizada.includes('VEICULO');
                  }
                  
                  // Correspondência exata ou parcial
                  return catNormalizada.includes(categoriaNormalizada.substring(0, 10));
                });
              });
              
              console.log(`🎯 Ano ${anoAtual}: ${fornecedoresDaCategoria.length} fornecedores da categoria locação`);
              
              // Para cada fornecedor da categoria, buscar suas transações
              for (const fornecedor of fornecedoresDaCategoria.slice(0, 20)) { // Limitar para performance
                try {
                  const resultadoTransacoes = await this.buscarFornecedorComTransacoes(
                    fornecedor.cnpj, 
                    anoAtual, 
                    'todos'
                  );
                  
                  if (resultadoTransacoes.transacoes && resultadoTransacoes.transacoes.length > 0) {
                    // Adicionar todas as transações (já são da categoria pelo filtro do fornecedor)
                    resultadoTransacoes.transacoes.forEach(transacao => {
                      todasTransacoes.push({
                        ...transacao,
                        fonte: 'fornecedores_unificado',
                        nomeFornecedor: fornecedor.nome,
                        cnpjCpfFornecedor: fornecedor.cnpj,
                        ano: anoAtual,
                        categoria: categoria // Garantir categoria
                      });
                    });
                    
                    console.log(`✅ ${fornecedor.nome} (${anoAtual}): ${resultadoTransacoes.transacoes.length} transações`);
                    fornecedoresEncontrados++;
                  }
                } catch (transacaoError) {
                  console.debug(`⚠️ Erro transações ${fornecedor.cnpj}: ${transacaoError.message}`);
                }
              }
            }
          } catch (anoError) {
            console.debug(`⚠️ Erro no ano ${anoAtual}: ${anoError.message}`);
          }
        }
        
        console.log(`📊 [Estratégia SIMPLIFICADA] Total: ${todasTransacoes.length} transações de ${fornecedoresEncontrados} fornecedores`);
        
      } catch (error0) {
        console.warn(`⚠️ [Estratégia SIMPLIFICADA] Falhou: ${error0.message}`);
      }
      
      // ESTRATÉGIA 1: Buscar na coleção 'transacoes' (estrutura principal) - como fallback
      if (todasTransacoes.length === 0) {
        console.log(`📋 [Estratégia 1 - FALLBACK] Buscando em 'transacoes'...`);
        try {
          const q1 = query(
            collection(db, 'transacoes'),
            where('categoria', '==', categoria)
          );
          
          const querySnapshot1 = await getDocs(q1);
          
          querySnapshot1.forEach((doc) => {
            const data = doc.data();
            todasTransacoes.push({
              id: doc.id,
              fonte: 'transacoes',
              ...data
            });
          });
          
          console.log(`📊 [Estratégia 1] Encontradas ${querySnapshot1.size} transações em 'transacoes'`);
        } catch (error1) {
          console.warn(`⚠️ [Estratégia 1] Falhou: ${error1.message}`);
        }
      }
      
      // ESTRATÉGIA 2: Buscar na estrutura despesas/{deputadoId}/anos/{ano} para múltiplos anos
      console.log(`📋 [Estratégia 2] Buscando na estrutura 'despesas'...`);
      try {
        // Primeiro, descobrir deputados (usar estratégia collectionGroup mais eficiente)
        const { collectionGroup } = await import('firebase/firestore');
        const dadosCollectionGroup = collectionGroup(db, 'dados');
        const limitedQuery = query(dadosCollectionGroup, limit(500)); // Aumentar para garantir todos os deputados
        const deputadosSnapshot = await getDocs(limitedQuery);
        
        const deputadosIds = new Set<string>();
        deputadosSnapshot.docs.forEach(doc => {
          const pathParts = doc.ref.path.split('/');
          if (pathParts.length >= 2 && pathParts[0] === 'despesas') {
            deputadosIds.add(pathParts[1]);
          }
        });
        
        console.log(`👥 [Estratégia 2] Descobertos ${deputadosIds.size} deputados`);
        
        // Anos para buscar - expandir para 10 anos ou todos os anos especificados
        const anosParaBuscar = ano ? [ano] : Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);
        
        console.log(`📅 [Estratégia 2] Buscando anos: ${anosParaBuscar.join(', ')}`);
        
        let totalTransacoesEncontradas = 0;
        
        for (const deputadoId of Array.from(deputadosIds).slice(0, 50)) { // Limitar para não exceder limites do Firestore
          for (const anoEstrutura of anosParaBuscar) {
            try {
              const anosRef = collection(db, 'despesas', deputadoId, 'anos');
              const anoDocRef = doc(anosRef, anoEstrutura.toString());
              const anoSnapshot = await getDoc(anoDocRef);
              
              if (anoSnapshot.exists()) {
                const dadosAno = anoSnapshot.data();
                const despesas = dadosAno.despesas || [];
                
                // Filtrar por categoria
                const despesasCategoria = despesas.filter((despesa: any) => {
                  const categorias = [
                    despesa.categoria,
                    despesa.tipoDespesa,
                    despesa.txtDescricao,
                    despesa.descricao
                  ];
                  
                  return categorias.some(cat => 
                    cat && typeof cat === 'string' && 
                    cat.toLowerCase().includes(categoria.toLowerCase()) ||
                    categoria.toLowerCase().includes(cat.toLowerCase())
                  );
                });
                
                despesasCategoria.forEach((despesa: any) => {
                  todasTransacoes.push({
                    id: `${deputadoId}_${anoEstrutura}_${despesa.numDocumento || Math.random()}`,
                    fonte: 'despesas_estrutura',
                    deputadoId: deputadoId,
                    ano: anoEstrutura,
                    ...despesa
                  });
                  totalTransacoesEncontradas++;
                });
              }
            } catch (deputadoError) {
              // Continuar se falhar para um deputado específico
              console.debug(`⚠️ Deputado ${deputadoId}, ano ${anoEstrutura}: ${deputadoError.message}`);
            }
          }
        }
        
        console.log(`📊 [Estratégia 2] Encontradas ${totalTransacoesEncontradas} transações na estrutura 'despesas'`);
      } catch (error2) {
        console.warn(`⚠️ [Estratégia 2] Falhou: ${error2.message}`);
      }
      
      // ESTRATÉGIA 3: Buscar com campos alternativos de categoria e variações do nome
      console.log(`📋 [Estratégia 3] Buscando com campos alternativos e variações...`);
      try {
        const camposCategoria = ['tipoDespesa', 'txtDescricao', 'descricao', 'tipoGasto'];
        
        // Variações do nome da categoria para tentar
        const variacoesCategoria = [
          categoria, // Original
          categoria.replace('LOCAÇÃO', 'LOCACAO'), // Sem acentos
          'LOCACAO OU FRETAMENTO DE VEICULOS AUTOMOTORES', // Sem acentos completo
          'LOCAÇÃO DE VEÍCULOS', // Versão curta
          'LOCACAO DE VEICULOS', // Versão curta sem acentos
          'FRETAMENTO DE VEÍCULOS', // Apenas fretamento
          'FRETAMENTO DE VEICULOS' // Apenas fretamento sem acentos
        ];
        
        for (const campo of camposCategoria) {
          for (const variacao of variacoesCategoria) {
            try {
              const q3 = query(
                collection(db, 'transacoes'),
                where(campo, '==', variacao)
              );
              
              const querySnapshot3 = await getDocs(q3);
              
              querySnapshot3.forEach((doc) => {
                const data = doc.data();
                // Evitar duplicatas
                const jaExiste = todasTransacoes.some(t => t.id === doc.id);
                if (!jaExiste) {
                  todasTransacoes.push({
                    id: doc.id,
                    fonte: `transacoes_${campo}_${variacao.substring(0, 10)}`,
                    ...data
                  });
                }
              });
              
              if (querySnapshot3.size > 0) {
                console.log(`📊 [Estratégia 3] Encontradas ${querySnapshot3.size} transações com '${campo}' = '${variacao}'`);
              }
            } catch (queryError) {
              // Continue para próxima variação
            }
          }
        }
      } catch (error3) {
        console.warn(`⚠️ [Estratégia 3] Falhou: ${error3.message}`);
      }
      
      // ESTRATÉGIA 4: Buscar por termos parciais (contém palavras-chave)
      console.log(`📋 [Estratégia 4] Buscando por termos parciais...`);
      try {
        const termosChave = ['LOCAÇÃO', 'LOCACAO', 'FRETAMENTO', 'VEÍCULO', 'VEICULO'];
        
        for (const termo of termosChave) {
          try {
            // Usar range query para buscar strings que contenham o termo
            const qRange = query(
              collection(db, 'transacoes'),
              where('categoria', '>=', termo),
              where('categoria', '<=', termo + '\uf8ff'),
              limit(20)
            );
            
            const rangeSnapshot = await getDocs(qRange);
            
            rangeSnapshot.forEach((doc) => {
              const data = doc.data();
              const jaExiste = todasTransacoes.some(t => t.id === doc.id);
              if (!jaExiste) {
                todasTransacoes.push({
                  id: doc.id,
                  fonte: `range_${termo}`,
                  ...data
                });
              }
            });
            
            if (rangeSnapshot.size > 0) {
              console.log(`📊 [Estratégia 4] Encontradas ${rangeSnapshot.size} transações com termo '${termo}'`);
            }
          } catch (rangeError) {
            console.debug(`⚠️ Range query falhou para '${termo}': ${rangeError.message}`);
          }
        }
      } catch (error4) {
        console.warn(`⚠️ [Estratégia 4] Falhou: ${error4.message}`);
      }
      
      console.log(`📊 [buscarTransacoesPorCategoria] TOTAL encontradas: ${todasTransacoes.length} transações para "${categoria}"`);
      
      // Se não pediu ano específico, retornar todas
      if (!ano) {
        return todasTransacoes;
      }
      
      // Filtrar localmente por ano se especificado
      const transacoesFiltradas = todasTransacoes.filter(t => {
        // Primeiro verificar se já tem o ano na estrutura
        if (t.ano === ano) return true;
        
        // Verificar múltiplos campos de data
        const campos = [
          t.dataDocumento, 
          t.data, 
          t.timestamp, 
          t.dtEmissao,
          t.dataEmissao,
          t.dtCompetencia,
          t.dataCompetencia,
          t.datEmissao,
          t.datDocumento
        ];
        
        for (const campo of campos) {
          if (campo) {
            let anoTransacao;
            
            if (typeof campo === 'string') {
              // Extrair ano de string (vários formatos)
              const yearMatch = campo.match(/(\d{4})/);
              anoTransacao = yearMatch ? parseInt(yearMatch[1]) : null;
            } else if (campo.toDate) {
              // Firestore Timestamp
              anoTransacao = campo.toDate().getFullYear();
            } else if (campo instanceof Date) {
              anoTransacao = campo.getFullYear();
            } else if (typeof campo === 'number' && campo > 2000 && campo < 2050) {
              // Campo já é um ano
              anoTransacao = campo;
            } else if (campo && typeof campo === 'object' && campo.seconds) {
              // Firestore Timestamp object format
              anoTransacao = new Date(campo.seconds * 1000).getFullYear();
            }
            
            if (anoTransacao === ano) {
              return true;
            }
          }
        }
        
        // Fallback: verificar se tem campo 'ano' direto
        return t.year === ano || t.anoCompetencia === ano || t.numAno === ano;
      });
      
      console.log(`🎯 [buscarTransacoesPorCategoria] Após filtro por ano ${ano}: ${transacoesFiltradas.length} de ${todasTransacoes.length} transações`);
      
      // Debug: mostrar distribuição por anos e fontes se encontrou poucas transações
      if (transacoesFiltradas.length === 0 || transacoesFiltradas.length < 10) {
        console.log('🔍 [DEBUG] Análise detalhada das transações encontradas...');
        
        const distribuicaoAnos = new Map();
        const distribuicaoFontes = new Map();
        
        todasTransacoes.forEach(t => {
          // Contabilizar fontes
          const fonte = t.fonte || 'desconhecida';
          distribuicaoFontes.set(fonte, (distribuicaoFontes.get(fonte) || 0) + 1);
          
          // Contabilizar anos
          const campos = [t.dataDocumento, t.data, t.timestamp, t.dtEmissao, t.ano];
          let anoEncontrado = 'indefinido';
          
          for (const campo of campos) {
            if (campo && typeof campo === 'string') {
              const yearMatch = campo.match(/(\d{4})/);
              if (yearMatch) {
                anoEncontrado = yearMatch[1];
                break;
              }
            } else if (typeof campo === 'number' && campo > 2000 && campo < 2050) {
              anoEncontrado = campo.toString();
              break;
            }
          }
          
          distribuicaoAnos.set(anoEncontrado, (distribuicaoAnos.get(anoEncontrado) || 0) + 1);
        });
        
        console.log(`📊 Distribuição por fontes:`, Object.fromEntries(distribuicaoFontes));
        console.log(`📊 Distribuição por anos:`, Object.fromEntries(distribuicaoAnos));
        
        // Mostrar algumas transações de exemplo
        if (todasTransacoes.length > 0) {
          console.log(`📝 Exemplo de transação encontrada:`, {
            id: todasTransacoes[0].id,
            fonte: todasTransacoes[0].fonte,
            categoria: todasTransacoes[0].categoria || todasTransacoes[0].tipoDespesa,
            dataDocumento: todasTransacoes[0].dataDocumento,
            ano: todasTransacoes[0].ano,
            keys: Object.keys(todasTransacoes[0]).slice(0, 10)
          });
        }
      }
      
      return transacoesFiltradas;
    } catch (error) {
      console.error(`❌ [buscarTransacoesPorCategoria] Erro geral ao buscar transações para categoria "${categoria}":`, error);
      return [];
    }
  }

  /**
   * Busca transações temporais de um fornecedor específico
   * Para análise de relacionamento monogâmico
   * ATUALIZADO: Multiple fallback strategies
   */
  async buscarTransacoesTemporaisFornecedor(cnpj: string): Promise<any[]> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const cacheKey = `transactions_${cnpjLimpo}`;
    
    // DIAGNÓSTICO: Desabilitando cache temporariamente para investigação completa
    console.log(`🚀 [DIAGNÓSTICO FORÇADO] Iniciando busca SEM CACHE para ${cnpj}`);
    
    // Skip cache e throttling durante diagnóstico
    // const cachedResult = transactionCache.get<any[]>(cacheKey);
    // if (cachedResult !== null) {
    //   transactionLogThrottle.throttledLog(`cache_${cnpjLimpo}`, `🎯 [TransacoesTemporal] Cache hit para ${cnpj}`);
    //   return cachedResult;
    // }

    // Skip known failures durante diagnóstico
    // if (transactionCache.isKnownFailure(cnpjLimpo)) {
    //   transactionLogThrottle.throttledWarn(`failure_${cnpjLimpo}`, `⚠️ [TransacoesTemporal] CNPJ ${cnpj} já conhecido como sem transações`);
    //   return [];
    // }

    try {
      const cnpjFormatado = cnpj;
      let transacoesTemporal: any[] = [];
      const diagnosticLog: string[] = [];
      
      // DIAGNÓSTICO: Log de início com detalhes
      console.log(`🔍 [DIAGNÓSTICO] Iniciando busca detalhada para CNPJ: ${cnpj}`);
      console.log(`📋 [DIAGNÓSTICO] CNPJ Limpo: ${cnpjLimpo} | CNPJ Formatado: ${cnpjFormatado}`);
      
      // ESTRATÉGIA 1: Buscar no perfil do fornecedor primeiro (mais eficiente)
      try {
        const perfilFornecedor = await this.buscarPerfilFornecedorUnificado(cnpjLimpo);
        if (perfilFornecedor && perfilFornecedor.relacionamentoDeputados) {
          console.log(`✅ [DIAGNÓSTICO] Perfil encontrado: ${perfilFornecedor.nome}`);
          console.log(`📊 [DIAGNÓSTICO] Relacionamentos: ${perfilFornecedor.relacionamentoDeputados.length}`);
          
          // DIAGNÓSTICO FORÇADO: Usar alert para garantir visibilidade
          if (cnpj === '08.876.018/0001-63') {
            alert(`DIAGNÓSTICO CNPJ ${cnpj}:\n\nPerfil: ${perfilFornecedor.nome}\nRelacionamentos: ${perfilFornecedor.relacionamentoDeputados.length}\n\nVer console para mais detalhes...`);
          }
          
          diagnosticLog.push(`Perfil encontrado com ${perfilFornecedor.relacionamentoDeputados.length} relacionamentos`);
          
          perfilFornecedor.relacionamentoDeputados.forEach((rel: any, relIndex: number) => {
            console.log(`\n👤 [DIAGNÓSTICO DETALHADO] Relacionamento ${relIndex + 1}:`);
            console.log(`   - Deputado ID: ${rel.deputadoId || 'AUSENTE'}`);
            console.log(`   - Deputado Nome: ${rel.deputadoNome || rel.nomeDeputado || 'AUSENTE'}`);
            console.log(`   - Tem transacoes field: ${rel.transacoes ? 'SIM' : 'NÃO'}`);
            console.log(`   - É Array: ${Array.isArray(rel.transacoes) ? 'SIM' : 'NÃO'}`);
            console.log(`   - Quantidade transações: ${rel.transacoes?.length || 0}`);
            
            // Log dos campos disponíveis no relacionamento
            const camposRel = Object.keys(rel);
            console.log(`   - Campos disponíveis: ${camposRel.join(', ')}`);
            
            // DIAGNÓSTICO FORÇADO: Alert com estrutura detalhada para o primeiro CNPJ
            if (cnpj === '08.876.018/0001-63' && relIndex === 0) {
              const alertContent = `ESTRUTURA RELACIONAMENTO ${relIndex + 1}:
              
Deputado ID: ${rel.deputadoId || 'AUSENTE'}
Deputado Nome: ${rel.deputadoNome || rel.nomeDeputado || 'AUSENTE'}
Tem transacoes: ${rel.transacoes ? 'SIM' : 'NÃO'}
É Array: ${Array.isArray(rel.transacoes) ? 'SIM' : 'NÃO'}
Qtd transações: ${rel.transacoes?.length || 0}

Campos disponíveis:
${camposRel.join(', ')}

${rel.transacoes?.length > 0 ? `Primeira transação: ${JSON.stringify(rel.transacoes[0], null, 2)}` : 'Sem transações'}`;
              
              alert(alertContent);
            }
            
            // Investigar se há outros campos com transações
            const possiveisCamposTransacao = camposRel.filter(campo => 
              campo.toLowerCase().includes('transac') || 
              campo.toLowerCase().includes('despesa') ||
              campo.toLowerCase().includes('gasto')
            );
            if (possiveisCamposTransacao.length > 0) {
              console.log(`   - Possíveis campos de transação: ${possiveisCamposTransacao.join(', ')}`);
            }
            
            if (rel.transacoes && Array.isArray(rel.transacoes)) {
              console.log(`   ✅ Array de transações encontrado com ${rel.transacoes.length} itens`);
              
              if (rel.transacoes.length > 0) {
                // Log da estrutura da primeira transação
                const primeiraTransacao = rel.transacoes[0];
                console.log(`   📄 Estrutura primeira transação:`, Object.keys(primeiraTransacao));
                console.log(`   📄 Dados primeira transação:`, primeiraTransacao);
              }
              
              rel.transacoes.forEach((trans: any, transIndex: number) => {
                const dataDocumento = trans.dataDocumento || trans.datEmissao || trans.data;
                const valor = parseFloat(trans.valorLiquido || trans.valor || 0);
                
                console.log(`     💰 Transação ${transIndex + 1}:`);
                console.log(`       - Data: ${dataDocumento || 'AUSENTE'}`);
                console.log(`       - Valor: ${valor}`);
                console.log(`       - Deputado válido: ${rel.deputadoId ? 'SIM' : 'NÃO'}`);
                console.log(`       - Valor > 0: ${valor > 0 ? 'SIM' : 'NÃO'}`);
                
                if (dataDocumento) {
                  const transacao = {
                    id: trans.id || `${rel.deputadoId}-${trans.valor}-${dataDocumento}`,
                    data: new Date(dataDocumento),
                    valor: parseFloat(trans.valorLiquido || trans.valor || 0),
                    deputadoId: rel.deputadoId,
                    deputadoNome: rel.deputadoNome || rel.nomeDeputado,
                    cnpjCpfFornecedor: cnpjLimpo,
                    nomeFornecedor: perfilFornecedor.nome,
                    categoria: trans.tipoDespesa || trans.categoria || 'Não especificado',
                    mes: trans.numMes || new Date(dataDocumento).getMonth() + 1,
                    ano: trans.numAno || new Date(dataDocumento).getFullYear(),
                    valorGlosa: parseFloat(trans.valorGlosa || 0),
                    tipoDocumento: trans.tipoDocumento,
                    numeroDocumento: trans.numDocumento
                  };
                  
                  if (transacao.deputadoId && transacao.valor > 0) {
                    console.log(`       ✅ Transação ACEITA e adicionada`);
                    transacoesTemporal.push(transacao);
                  } else {
                    console.log(`       ❌ Transação REJEITADA - deputadoId: ${!!transacao.deputadoId}, valor: ${transacao.valor}`);
                  }
                } else {
                  console.log(`       ❌ Transação REJEITADA - sem data`);
                }
              });
            } else {
              console.log(`   ❌ Campo 'transacoes' não é um array válido`);
              
              // Tentar outras estruturas possíveis
              if (rel.despesas && Array.isArray(rel.despesas)) {
                console.log(`   🔍 Encontrado campo 'despesas' com ${rel.despesas.length} itens`);
              }
              if (rel.gastos && Array.isArray(rel.gastos)) {
                console.log(`   🔍 Encontrado campo 'gastos' com ${rel.gastos.length} itens`);
              }
            }
          });
        } else {
          console.log(`❌ [DIAGNÓSTICO] Perfil NÃO encontrado para CNPJ ${cnpjLimpo}`);
          diagnosticLog.push('Perfil não encontrado');
        }
      } catch (error) {
        console.log(`❌ [DIAGNÓSTICO] Erro na busca do perfil: ${error.message}`);
        diagnosticLog.push(`Erro perfil: ${error.message}`);
      }

      // OTIMIZAÇÃO 3: Early bailout se encontrou transações
      if (transacoesTemporal.length > 0) {
        transacoesTemporal.sort((a, b) => a.data.getTime() - b.data.getTime());
        unifiedCacheService.setTransaction(cacheKey, transacoesTemporal);
        console.log(`✅ [DIAGNÓSTICO] ${transacoesTemporal.length} transações encontradas via perfil`);
        return transacoesTemporal;
      }
      
      // ESTRATÉGIA 2: Buscar na coleção despesas com MÚLTIPLOS CAMPOS
      console.log(`🔎 [DIAGNÓSTICO] Iniciando busca em coleção despesas...`);
      
      const camposParaTentar = [
        'cnpjCpfFornecedor',
        'cnpjCpfFornecedor', 
        'fornecedorCnpj',
        'cnpj',
        'cpfCnpjFornecedor',
        'numCnpjCpf'
      ];

      const versoesCNPJ = [cnpjLimpo, cnpjFormatado];
      
      for (const campo of camposParaTentar) {
        for (const cnpjVersao of versoesCNPJ) {
          try {
            const q = query(
              collection(db, 'despesas'), 
              where(campo, '==', cnpjVersao), 
              limit(50)
            );
            const querySnapshot = await getDocs(q);
            
            console.log(`🔍 [DIAGNÓSTICO] Campo ${campo} com CNPJ ${cnpjVersao}: ${querySnapshot.size} documentos`);
            
            if (querySnapshot.size > 0) {
              console.log(`✅ [DIAGNÓSTICO] ENCONTRADOS DADOS! Processando ${querySnapshot.size} documentos...`);
              
              querySnapshot.forEach((doc) => {
                const data = doc.data();
                console.log(`📄 [DIAGNÓSTICO] Documento: ${doc.id}`);
                console.log(`   - Fornecedor: ${data.nomeFornecedor || data.nomeFornecedor || data.fornecedor || 'N/A'}`);
                console.log(`   - Deputado: ${data.txNomeParlamentar || data.nomeDeputado || data.deputado || 'N/A'}`);
                console.log(`   - Valor: ${data.valorLiquido || data.vlrLiquido || data.valorDocumento || 'N/A'}`);
                
                const dataDocumento = data.dataDocumento || data.datEmissao || data.data;
                if (dataDocumento) {
                  const transacao = {
                    id: doc.id,
                    data: new Date(dataDocumento),
                    valor: parseFloat(data.valorLiquido || data.vlrLiquido || data.valorDocumento || 0),
                    deputadoId: data.deputadoId || data.nuDeputadoId || data.idDeputado,
                    deputadoNome: data.txNomeParlamentar || data.nomeDeputado || data.deputado,
                    cnpjCpfFornecedor: cnpjLimpo,
                    nomeFornecedor: data.nomeFornecedor || data.nomeFornecedor || data.fornecedor,
                    categoria: data.tipoDespesa || data.txtDescricao || data.categoria,
                    mes: data.numMes || new Date(dataDocumento).getMonth() + 1,
                    ano: data.numAno || new Date(dataDocumento).getFullYear(),
                    valorGlosa: parseFloat(data.valorGlosa || data.vlrGlosa || 0),
                    tipoDocumento: data.tipoDocumento || data.indTipoDocumento,
                    numeroDocumento: data.numDocumento || data.txtNumero
                  };
                  
                  if (transacao.deputadoId && transacao.valor > 0) {
                    transacoesTemporal.push(transacao);
                  }
                }
              });
              
              diagnosticLog.push(`${querySnapshot.size} docs encontrados em campo ${campo}`);
              
              if (transacoesTemporal.length > 0) {
                console.log(`🎯 [DIAGNÓSTICO] SUCESSO! ${transacoesTemporal.length} transações válidas extraídas`);
                break; // Early bailout
              }
            }
          } catch (queryError) {
            console.log(`❌ [DIAGNÓSTICO] Erro no campo ${campo}: ${queryError.message}`);
            diagnosticLog.push(`Erro campo ${campo}: ${queryError.message}`);
          }
        }
        if (transacoesTemporal.length > 0) break; // Break outer loop too
      }

      // ESTRATÉGIA 3: Buscar por nome se ainda não encontrou
      if (transacoesTemporal.length === 0) {
        console.log(`🔍 [DIAGNÓSTICO] Tentando busca por nome do fornecedor...`);
        try {
          const perfilFornecedor = await this.buscarPerfilFornecedorUnificado(cnpjLimpo);
          if (perfilFornecedor && perfilFornecedor.nome) {
            const nomeFornecedor = perfilFornecedor.nome;
            console.log(`📝 [DIAGNÓSTICO] Buscando por nome: ${nomeFornecedor}`);
            
            const qNome = query(
              collection(db, 'despesas'), 
              where('nomeFornecedor', '==', nomeFornecedor),
              limit(50)
            );
            
            const querySnapshot = await getDocs(qNome);
            console.log(`🔍 [DIAGNÓSTICO] Busca por nome retornou: ${querySnapshot.size} documentos`);
            
            if (querySnapshot.size > 0) {
              querySnapshot.forEach((doc) => {
                const data = doc.data();
                const dataDocumento = data.dataDocumento || data.datEmissao || data.data;
                if (dataDocumento) {
                  const transacao = {
                    id: doc.id,
                    data: new Date(dataDocumento),
                    valor: parseFloat(data.valorLiquido || data.vlrLiquido || data.valorDocumento || 0),
                    deputadoId: data.deputadoId || data.nuDeputadoId || data.idDeputado,
                    deputadoNome: data.txNomeParlamentar || data.nomeDeputado || data.deputado,
                    cnpjCpfFornecedor: cnpjLimpo,
                    nomeFornecedor: nomeFornecedor,
                    categoria: data.tipoDespesa || data.txtDescricao || data.categoria,
                    mes: data.numMes || new Date(dataDocumento).getMonth() + 1,
                    ano: data.numAno || new Date(dataDocumento).getFullYear(),
                    valorGlosa: parseFloat(data.valorGlosa || data.vlrGlosa || 0),
                    tipoDocumento: data.tipoDocumento || data.indTipoDocumento,
                    numeroDocumento: data.numDocumento || data.txtNumero
                  };
                  
                  if (transacao.deputadoId && transacao.valor > 0) {
                    transacoesTemporal.push(transacao);
                  }
                }
              });
            }
          }
        } catch (error) {
          console.log(`❌ [DIAGNÓSTICO] Erro na busca por nome: ${error.message}`);
          diagnosticLog.push(`Erro nome: ${error.message}`);
        }
      }

      // RESULTADO FINAL COM DIAGNÓSTICO COMPLETO
      transacoesTemporal.sort((a, b) => a.data.getTime() - b.data.getTime());
      
      console.log(`📊 [DIAGNÓSTICO FINAL] CNPJ: ${cnpj}`);
      console.log(`📋 [DIAGNÓSTICO FINAL] Tentativas: ${diagnosticLog.join(', ')}`);
      console.log(`📈 [DIAGNÓSTICO FINAL] Transações encontradas: ${transacoesTemporal.length}`);
      
      if (transacoesTemporal.length > 0) {
        // Skip cache durante diagnóstico
        // transactionCache.set(cacheKey, transacoesTemporal, 10 * 60 * 1000);
        console.log(`✅ [DIAGNÓSTICO FINAL] SUCESSO - ${transacoesTemporal.length} transações para ${cnpj}`);
        
        // Log das primeiras transações para verificação
        if (transacoesTemporal.length > 0) {
          console.log(`📄 [DIAGNÓSTICO FINAL] Exemplo de transação:`);
          console.log(`   - Data: ${transacoesTemporal[0]?.data?.toISOString()?.slice(0, 10)}`);
          console.log(`   - Deputado: ${transacoesTemporal[0]?.deputadoNome}`);
          console.log(`   - Valor: R$ ${transacoesTemporal[0]?.valor}`);
        }
      } else {
        // Skip cache during diagnostic
        // transactionCache.markAsFailed(cnpjLimpo);
        // ✅ Só mostrar warning se o banco não estiver vazio
        const bancoVazio = await this.isBancoVazio();
        if (!bancoVazio) {
          console.warn(`⚠️ [DIAGNÓSTICO FINAL] FALHOU - NENHUMA TRANSAÇÃO ENCONTRADA para ${cnpj}`);
          console.warn(`📋 [DIAGNÓSTICO FINAL] Resumo tentativas: ${diagnosticLog.join(' | ')}`);
        }
      }
      
      return transacoesTemporal;
      
    } catch (error) {
      console.error(`❌ [DIAGNÓSTICO FINAL] Erro geral ao buscar transações para CNPJ ${cnpj}:`, error);
      return [];
    }
  }

  /**
   * Detecta períodos consecutivos de relacionamento exclusivo
   * Implementa a lógica de 4 meses consecutivos ou 8 meses em um ano
   */
  async analisarRelacionamentoMonogamicoFornecedor(cnpj: string): Promise<{
    temRelacionamento: boolean;
    criterioAtendido: '4_meses_consecutivos' | '8_meses_ano' | 'ambos' | 'nenhum';
    deputadoExclusivo?: string;
    periodoMaisLongo?: string;
    mesesConsecutivos?: number;
    resumoAnalise?: string;
  }> {
    try {
      console.log(`🔍 [RelacionamentoMonogamico] Analisando fornecedor ${cnpj}...`);
      
      const transacoes = await this.buscarTransacoesTemporaisFornecedor(cnpj);
      
      if (transacoes.length === 0) {
        // CORREÇÃO: NÃO assumir relacionamento apenas porque há 1 deputado no perfil
        // Se não há transações válidas, NÃO há relacionamento monogâmico detectável
        // ✅ Só mostrar warning se o banco não estiver vazio
        const bancoVazio = await this.isBancoVazio();
        if (!bancoVazio) {
          console.warn(`⚠️ [RelacionamentoMonogamico] CNPJ ${cnpj}: Perfil existe mas sem transações temporais válidas`);
        }
        
        // INVESTIGAÇÃO: Verificar se existe perfil para debug
        const perfilFornecedor = await this.buscarPerfilFornecedorUnificado(cnpj.replace(/\D/g, ''));
        
        if (perfilFornecedor && perfilFornecedor.relacionamentoDeputados) {
          const numRelacionamentos = perfilFornecedor.relacionamentoDeputados.length;
          
          // Log detalhado para diagnóstico
          console.warn(`📊 [RelacionamentoMonogamico] CNPJ ${cnpj}: Perfil tem ${numRelacionamentos} relacionamentos mas sem transações extraíveis`);
          
          if (numRelacionamentos === 1) {
            const rel = perfilFornecedor.relacionamentoDeputados[0];
            console.warn(`🔍 [RelacionamentoMonogamico] Relacionamento único: Deputado ${rel.deputadoNome || rel.nomeDeputado}, Transações: ${rel.transacoes?.length || 0}`);
            
            // Verificar se tem transações mas não são válidas
            if (rel.transacoes && Array.isArray(rel.transacoes) && rel.transacoes.length > 0) {
              console.warn(`❌ [RelacionamentoMonogamico] ${rel.transacoes.length} transações existem mas são inválidas (sem data/valor/deputado)`);
              
              // Log da primeira transação para debug
              const primeiraTransacao = rel.transacoes[0];
              console.warn(`📄 [RelacionamentoMonogamico] Exemplo transação inválida:`, {
                temData: !!(primeiraTransacao.dataDocumento || primeiraTransacao.datEmissao || primeiraTransacao.data),
                temValor: !!(primeiraTransacao.valorLiquido || primeiraTransacao.valor),
                valorNumerico: parseFloat(primeiraTransacao.valorLiquido || primeiraTransacao.valor || 0),
                temDeputado: !!rel.deputadoId,
                estrutura: Object.keys(primeiraTransacao)
              });
            }
          }
          
          return {
            temRelacionamento: false, // CORREÇÃO: Sem transações válidas = sem relacionamento
            criterioAtendido: 'nenhum',
            resumoAnalise: `Perfil encontrado com ${numRelacionamentos} relacionamentos, mas sem transações temporais válidas para análise monogâmica`
          };
        }
        
        return {
          temRelacionamento: false,
          criterioAtendido: 'nenhum',
          resumoAnalise: 'Nenhuma transação encontrada e perfil não localizado'
        };
      }
      
      // Organizar transações por mês/ano
      const transacoesPorMes = new Map<string, { deputados: Set<string>, total: number }>();
      
      transacoes.forEach(t => {
        const mesAno = `${t.ano}-${t.mes.toString().padStart(2, '0')}`;
        
        if (!transacoesPorMes.has(mesAno)) {
          transacoesPorMes.set(mesAno, { deputados: new Set(), total: 0 });
        }
        
        const mesData = transacoesPorMes.get(mesAno)!;
        mesData.deputados.add(t.deputadoId);
        mesData.total += t.valor;
      });
      
      // Detectar meses com apenas 1 deputado (exclusivos)
      const mesesExclusivos = new Map<string, string>(); // mes -> deputadoId
      
      for (const [mesAno, dados] of transacoesPorMes) {
        if (dados.deputados.size === 1) {
          const deputadoUnico = Array.from(dados.deputados)[0];
          mesesExclusivos.set(mesAno, deputadoUnico);
        }
      }
      
      if (mesesExclusivos.size === 0) {
        return {
          temRelacionamento: false,
          criterioAtendido: 'nenhum',
          resumoAnalise: 'Nenhum mês exclusivo detectado'
        };
      }
      
      // Analisar períodos consecutivos
      const mesesOrdenados = Array.from(mesesExclusivos.keys()).sort();
      let maiorSequencia = 0;
      let sequenciaAtual = 1;
      let deputadoMaiorSequencia = '';
      let inicioMaiorSequencia = '';
      let fimMaiorSequencia = '';
      let deputadoAtual = mesesExclusivos.get(mesesOrdenados[0])!;
      
      for (let i = 1; i < mesesOrdenados.length; i++) {
        const mesAnterior = mesesOrdenados[i - 1];
        const mesAtual = mesesOrdenados[i];
        const deputadoMesAtual = mesesExclusivos.get(mesAtual)!;
        
        // Verificar se são consecutivos e mesmo deputado
        if (this.saoMesesConsecutivos(mesAnterior, mesAtual) && deputadoAtual === deputadoMesAtual) {
          sequenciaAtual++;
        } else {
          // Fim da sequência atual
          if (sequenciaAtual > maiorSequencia) {
            maiorSequencia = sequenciaAtual;
            deputadoMaiorSequencia = deputadoAtual;
            inicioMaiorSequencia = mesesOrdenados[i - sequenciaAtual];
            fimMaiorSequencia = mesAnterior;
          }
          sequenciaAtual = 1;
          deputadoAtual = deputadoMesAtual;
        }
      }
      
      // Verificar última sequência
      if (sequenciaAtual > maiorSequencia) {
        maiorSequencia = sequenciaAtual;
        deputadoMaiorSequencia = deputadoAtual;
        inicioMaiorSequencia = mesesOrdenados[mesesOrdenados.length - sequenciaAtual];
        fimMaiorSequencia = mesesOrdenados[mesesOrdenados.length - 1];
      }
      
      // Analisar meses por ano
      const mesesPorAno = new Map<number, { meses: Set<string>, deputado: string }>();
      
      for (const [mesAno, deputadoId] of mesesExclusivos) {
        const ano = parseInt(mesAno.split('-')[0]);
        
        if (!mesesPorAno.has(ano)) {
          mesesPorAno.set(ano, { meses: new Set(), deputado: deputadoId });
        }
        
        const dadosAno = mesesPorAno.get(ano)!;
        
        // Se mudou de deputado no mesmo ano, não conta
        if (dadosAno.deputado !== deputadoId) {
          continue;
        }
        
        dadosAno.meses.add(mesAno);
      }
      
      const maiorNumMesesNoAno = Math.max(...Array.from(mesesPorAno.values()).map(d => d.meses.size), 0);
      
      // Determinar critério atendido
      const tem4MesesConsecutivos = maiorSequencia >= 4;
      const tem8MesesNoAno = maiorNumMesesNoAno >= 8;
      
      let criterioAtendido: '4_meses_consecutivos' | '8_meses_ano' | 'ambos' | 'nenhum';
      
      if (tem4MesesConsecutivos && tem8MesesNoAno) {
        criterioAtendido = 'ambos';
      } else if (tem4MesesConsecutivos) {
        criterioAtendido = '4_meses_consecutivos';
      } else if (tem8MesesNoAno) {
        criterioAtendido = '8_meses_ano';
      } else {
        criterioAtendido = 'nenhum';
      }
      
      const temRelacionamento = tem4MesesConsecutivos || tem8MesesNoAno;
      
      // Buscar nome do deputado
      let nomeDeputado = deputadoMaiorSequencia;
      const primeiraTransacao = transacoes.find(t => t.deputadoId === deputadoMaiorSequencia);
      if (primeiraTransacao?.deputadoNome) {
        nomeDeputado = primeiraTransacao.deputadoNome;
      }
      
      const resumoAnalise = temRelacionamento 
        ? `Relacionamento exclusivo com ${nomeDeputado} (${maiorSequencia} meses consecutivos, ${maiorNumMesesNoAno} meses/ano)`
        : `Sem relacionamento monogâmico (${maiorSequencia} meses consecutivos máximo)`;
      
      console.log(`✅ [RelacionamentoMonogamico] ${cnpj}: ${resumoAnalise}`);
      
      return {
        temRelacionamento,
        criterioAtendido,
        deputadoExclusivo: temRelacionamento ? nomeDeputado : undefined,
        periodoMaisLongo: temRelacionamento ? `${inicioMaiorSequencia} a ${fimMaiorSequencia}` : undefined,
        mesesConsecutivos: maiorSequencia,
        resumoAnalise
      };
      
    } catch (error) {
      console.error(`❌ [RelacionamentoMonogamico] Erro ao analisar ${cnpj}:`, error);
      return {
        temRelacionamento: false,
        criterioAtendido: 'nenhum',
        resumoAnalise: `Erro na análise: ${error.message}`
      };
    }
  }
  
  /**
   * Verifica se dois meses são consecutivos (formato YYYY-MM)
   */
  private saoMesesConsecutivos(mes1: string, mes2: string): boolean {
    const [ano1, mesNum1] = mes1.split('-').map(Number);
    const [ano2, mesNum2] = mes2.split('-').map(Number);
    
    const data1 = new Date(ano1, mesNum1 - 1);
    const data2 = new Date(ano2, mesNum2 - 1);
    
    // Adicionar 1 mês à primeira data
    data1.setMonth(data1.getMonth() + 1);
    
    return data1.getFullYear() === data2.getFullYear() && 
           data1.getMonth() === data2.getMonth();
  }

  /**
   * Busca todos os deputados disponíveis no sistema
   * Método otimizado para uso no cálculo de médias
   */
  async buscarTodosDeputados(): Promise<DeputadoFirestore[]> {
    try {
      console.log('🔍 [buscarTodosDeputados] Buscando todos os deputados...');
      
      // Usar o método existente sem filtros para buscar todos os deputados
      const deputados = await this.buscarDeputados({ limite: 50000 }); // Processar todos os deputados
      
      console.log(`✅ [buscarTodosDeputados] Encontrados ${deputados.length} deputados`);
      return deputados;
      
    } catch (error) {
      console.error('❌ [buscarTodosDeputados] Erro ao buscar todos os deputados:', error);
      return [];
    }
  }

  /**
   * Busca todas as transações de todos os fornecedores do sistema
   * Método para a aba de transações globais na página de fornecedores
   */
  async buscarTodasTransacoesFornecedores(filtros?: {
    ano?: number
    mes?: number
    limite?: number
  }): Promise<any[]> {
    try {
      console.log('🔍 [buscarTodasTransacoesFornecedores] Iniciando busca global OTIMIZADA...', filtros);
      
      let todasTransacoes: any[] = [];
      
      // ESTRATÉGIA 1: Buscar na nova estrutura de fornecedores primeiro (mais organizada)
      try {
        console.log('🎯 [ESTRATÉGIA 1] Buscando na estrutura fornecedores/{cnpj}/transacoes...');
        
        const fornecedoresRef = collection(db, 'fornecedores');
        const fornecedoresSnapshot = await getDocs(fornecedoresRef); // ✅ REMOVIDO LIMITE ARTIFICIAL - buscar TODOS os fornecedores
        
        console.log(`📊 [ESTRATÉGIA 1] Encontrados ${fornecedoresSnapshot.size} fornecedores na base`);
        
        let transacoesDaEstruturaNova = 0;
        let processedSuppliers = 0;
        
        // Processar fornecedores em lotes para melhor performance
        const LOTE_SIZE = 10;
        const fornecedoresDocs = fornecedoresSnapshot.docs;
        
        for (let i = 0; i < fornecedoresDocs.length; i += LOTE_SIZE) {
          const loteAraProcessar = fornecedoresDocs.slice(i, i + LOTE_SIZE);
          
          const promessasLote = loteAraProcessar.map(async (fornecedorDoc) => {
            try {
              const cnpjLimpo = fornecedorDoc.id;
              const transacoesRef = collection(db, 'fornecedores', cnpjLimpo, 'transacoes');
              
              // Aplicar filtros específicos na query se fornecidos
              let queryConstraints = [];
              
              if (filtros?.ano && filtros?.mes) {
                // Buscar mês específico
                const chaveAnoMes = `${filtros.ano}-${filtros.mes.toString().padStart(2, '0')}`;
                queryConstraints.push(where('__name__', '==', chaveAnoMes));
              } else if (filtros?.ano) {
                // Buscar ano completo
                queryConstraints.push(
                  where('__name__', '>=', `${filtros.ano}-01`),
                  where('__name__', '<=', `${filtros.ano}-12`)
                );
              }
              
              const transacoesQuery = query(transacoesRef, ...queryConstraints, limit(50));
              const transacoesSnapshot = await getDocs(transacoesQuery);
              
              const transacoesFornecedor: any[] = [];
              
              transacoesSnapshot.forEach(transacaoDoc => {
                const transacaoData = transacaoDoc.data();
                
                if (transacaoData.transacoes && Array.isArray(transacaoData.transacoes)) {
                  // Transações da estrutura nova com mapeamento correto dos campos
                  transacoesFornecedor.push(...transacaoData.transacoes.map((t: any) => ({
                    ...t,
                    id: t.id || `${cnpjLimpo}-${transacaoDoc.id}-${transacaoData.transacoes.indexOf(t)}`,
                    // Mapear campos corretos da DespesaOptimizada
                    nomeDeputado: t.deputadoNome || t.nomeDeputado || 'Não informado',
                    idDeputado: t.deputadoId || t.idDeputado || '',
                    nomeFornecedor: t.nomeFornecedor || 'Não informado',
                    cnpjCpfFornecedor: t.cnpjCpfFornecedor || cnpjLimpo,
                    valorLiquido: parseFloat(t.valorLiquido || t.valor || 0),
                    tipoDespesa: t.tipoDespesa || t.categoria || 'Não informado',
                    dataDocumento: t.dataDocumento || t.data,
                    numDocumento: t.numDocumento || t.numeroDocumento || '',
                    urlDocumento: t.urlDocumento || '',
                    tipoDocumento: t.tipoDocumento || '',
                    ano: t.ano || parseInt(transacaoDoc.id.split('-')[0]),
                    mes: t.mes || parseInt(transacaoDoc.id.split('-')[1]),
                    fonte: 'estrutura_fornecedores'
                  })));
                }
              });
              
              return transacoesFornecedor;
              
            } catch (error) {
              console.warn(`⚠️ [ESTRATÉGIA 1] Erro ao processar fornecedor ${fornecedorDoc.id}:`, error);
              return [];
            }
          });
          
          const resultadosLote = await Promise.all(promessasLote);
          
          // Adicionar resultados do lote
          resultadosLote.forEach(transacoesFornecedor => {
            todasTransacoes.push(...transacoesFornecedor);
            if (transacoesFornecedor.length > 0) {
              transacoesDaEstruturaNova += transacoesFornecedor.length;
            }
          });
          
          processedSuppliers += loteAraProcessar.length;
          console.log(`📊 [ESTRATÉGIA 1] Processados ${processedSuppliers}/${fornecedoresDocs.length} fornecedores (${transacoesDaEstruturaNova} transações da estrutura nova)`);
          
          // Early break se já temos muitas transações
          if (todasTransacoes.length >= 10000) {
            console.log(`🎯 [ESTRATÉGIA 1] Early break: ${todasTransacoes.length} transações já coletadas`);
            break;
          }
        }
        
        console.log(`✅ [ESTRATÉGIA 1] Coletadas ${transacoesDaEstruturaNova} transações da estrutura de fornecedores`);
        
      } catch (fornecedoresError) {
        console.warn('⚠️ [ESTRATÉGIA 1] Falha na estrutura de fornecedores:', fornecedoresError);
      }
      
      // ESTRATÉGIA 2: Complementar com collection group da estrutura de deputados
      try {
        console.log('🎯 [ESTRATÉGIA 2] Complementando com collection group da estrutura de deputados...');
        
        const despesasQuery = collectionGroup(db, 'despesas');
        let queryConstraints = [limit(filtros?.limite || 8000)]; // Aumentar limite significativamente
        
        const despesasSnapshot = await getDocs(query(despesasQuery, ...queryConstraints));
        
        console.log(`📊 [ESTRATÉGIA 2] Collection group encontrou ${despesasSnapshot.size} documentos`);
        
        let transacoesDaEstruturaAntiga = 0;
        
        despesasSnapshot.forEach(doc => {
          const data = doc.data();
          
          // Extrair informações da transação com mapeamento robusto
          const transacao = {
            id: doc.id,
            dataDocumento: data.dataDocumento || data.datEmissao,
            // Múltiplas tentativas para nome do fornecedor
            nomeFornecedor: data.nomeFornecedor || data.nomeFornecedor || 'Não informado',
            cnpjCpfFornecedor: data.cnpjCpfFornecedor || data.cnpjCpfFornecedor || '',
            valorLiquido: parseFloat(data.valorLiquido || data.vlrLiquido || data.valor || 0),
            tipoDespesa: data.tipoDespesa || data.txtDescricao || data.categoria || 'Não informado',
            tipoDocumento: data.tipoDocumento || data.indTipoDocumento || '',
            numDocumento: data.numDocumento || data.txtNumero || data.numeroDocumento || '',
            urlDocumento: data.urlDocumento || '',
            
            // Múltiplas tentativas para informações do deputado
            nomeDeputado: data.txNomeParlamentar || data.nomeDeputado || data.deputadoNome || data.deputado || 'Não informado',
            idDeputado: data.nuDeputadoId || data.deputadoId || data.idDeputado || doc.ref.path.split('/')[1] || '',
            
            // Campos calculados com tratamento robusto de data
            ano: data.numAno || data.ano || (data.dataDocumento ? (() => {
              try {
                const date = data.dataDocumento instanceof Date ? data.dataDocumento : data.dataDocumento.toDate();
                return date.getFullYear();
              } catch {
                return new Date().getFullYear();
              }
            })() : new Date().getFullYear()),
            mes: data.numMes || data.mes || (data.dataDocumento ? (() => {
              try {
                const date = data.dataDocumento instanceof Date ? data.dataDocumento : data.dataDocumento.toDate();
                return date.getMonth() + 1;
              } catch {
                return new Date().getMonth() + 1;
              }
            })() : new Date().getMonth() + 1),
            
            fonte: 'estrutura_deputados'
          };
          
          // Validar dados mínimos e aplicar filtros
          if (transacao.nomeFornecedor && transacao.valorLiquido > 0) {
            // Aplicar filtros se especificados
            let incluir = true;
            
            if (filtros?.ano && transacao.ano !== filtros.ano) {
              incluir = false;
            }
            
            if (filtros?.mes && transacao.mes !== filtros.mes) {
              incluir = false;
            }
            
            if (incluir) {
              todasTransacoes.push(transacao);
              transacoesDaEstruturaAntiga++;
            }
          }
        });
        
        console.log(`✅ [ESTRATÉGIA 2] Coletadas ${transacoesDaEstruturaAntiga} transações da estrutura de deputados`);
        
      } catch (collectionGroupError) {
        console.warn('⚠️ [ESTRATÉGIA 2] Collection group falhou:', collectionGroupError);
      }
      
      // ESTRATÉGIA 3 (FALLBACK): Se ainda temos poucas transações, buscar por deputados específicos
      if (todasTransacoes.length < 1000) {
        console.log('🔄 [ESTRATÉGIA 3] Complementando com busca direta por deputados...');
        
        // Buscar mais deputados (aumentar de 20 para 100)
        const deputadosComplementares = await this.buscarDeputados({ limite: 100 });
        console.log(`📋 [ESTRATÉGIA 3] Processando ${deputadosComplementares.length} deputados complementares`);
        
        let deputadosProcessados = 0;
        let transacoesComplementares = 0;
        
        // Processar em lotes maiores para melhor performance
        const LOTE_SIZE = 15;
        for (let i = 0; i < deputadosComplementares.length; i += LOTE_SIZE) {
          const loteDeputados = deputadosComplementares.slice(i, i + LOTE_SIZE);
          
          const promessasLote = loteDeputados.map(async (deputado) => {
            try {
              const transacoesDeputado = await this.buscarTransacoesDeputadoRapido(
                deputado.id, 
                filtros?.ano, 
                filtros?.mes
              );
              
              // Adicionar informações do deputado às transações com mapeamento robusto
              return transacoesDeputado.map((transacao: any) => ({
                ...transacao,
                // Garantir que os campos padrão estejam preenchidos
                id: transacao.id || `${deputado.id}-${Date.now()}-${Math.random()}`,
                nomeDeputado: deputado.nome || deputado.nomeCivil || 'Não informado',
                idDeputado: deputado.id,
                partidoDeputado: deputado.siglaPartido,
                ufDeputado: deputado.siglaUf,
                // Mapear campos de fornecedor se não estiverem presentes
                nomeFornecedor: transacao.nomeFornecedor || transacao.nomeFornecedor || 'Não informado',
                cnpjCpfFornecedor: transacao.cnpjCpfFornecedor || transacao.cnpjCpfFornecedor || '',
                valorLiquido: parseFloat(transacao.valorLiquido || transacao.vlrLiquido || transacao.valor || 0),
                tipoDespesa: transacao.tipoDespesa || transacao.txtDescricao || transacao.categoria || 'Não informado',
                dataDocumento: transacao.dataDocumento || transacao.datEmissao || transacao.data,
                numDocumento: transacao.numDocumento || transacao.txtNumero || transacao.numeroDocumento || '',
                urlDocumento: transacao.urlDocumento || '',
                tipoDocumento: transacao.tipoDocumento || transacao.indTipoDocumento || '',
                ano: transacao.ano || (transacao.dataDocumento ? new Date(transacao.dataDocumento).getFullYear() : new Date().getFullYear()),
                mes: transacao.mes || (transacao.dataDocumento ? new Date(transacao.dataDocumento).getMonth() + 1 : new Date().getMonth() + 1),
                fonte: 'busca_direta_deputados'
              }));
            } catch (error) {
              console.warn(`⚠️ [ESTRATÉGIA 3] Erro ao processar deputado ${deputado.id}:`, error);
              return [];
            }
          });
          
          const resultadosLote = await Promise.all(promessasLote);
          
          // Adicionar transações do lote ao resultado final
          resultadosLote.forEach(transacoesDeputado => {
            todasTransacoes.push(...transacoesDeputado);
            transacoesComplementares += transacoesDeputado.length;
          });
          
          deputadosProcessados += loteDeputados.length;
          
          console.log(`📊 [ESTRATÉGIA 3] Processados ${deputadosProcessados}/${deputadosComplementares.length} deputados (${transacoesComplementares} transações complementares)`);
          
          // Early exit se já temos transações suficientes
          if (todasTransacoes.length >= 15000) {
            console.log(`🎯 [ESTRATÉGIA 3] Early exit: ${todasTransacoes.length} transações já coletadas`);
            break;
          }
        }
        
        console.log(`✅ [ESTRATÉGIA 3] Coletadas ${transacoesComplementares} transações complementares`);
      }
      
      console.log(`📈 [buscarTodasTransacoesFornecedores] Total antes da deduplicação: ${todasTransacoes.length} transações`);
      
      // Aplicar limite se especificado (antes da deduplicação para ser mais eficiente)
      if (filtros?.limite && filtros.limite > 0 && todasTransacoes.length > filtros.limite) {
        todasTransacoes = todasTransacoes
          .sort((a, b) => (b.valorLiquido || 0) - (a.valorLiquido || 0))
          .slice(0, filtros.limite * 2); // Pegar o dobro antes da deduplicação
        console.log(`🔢 [buscarTodasTransacoesFornecedores] Pré-limite aplicado: ${todasTransacoes.length} transações`);
      }
      
      // Remover duplicatas de forma inteligente
      const transacoesUnicas = this.deduplicarTransacoesGlobaisOtimizado(todasTransacoes);
      
      // Aplicar limite final se necessário
      let resultadoFinal = transacoesUnicas;
      if (filtros?.limite && filtros.limite > 0 && resultadoFinal.length > filtros.limite) {
        resultadoFinal = resultadoFinal
          .sort((a, b) => (b.valorLiquido || 0) - (a.valorLiquido || 0))
          .slice(0, filtros.limite);
        console.log(`🎯 [buscarTodasTransacoesFornecedores] Limite final aplicado: ${resultadoFinal.length} transações`);
      }
      
      const estatisticas = {
        totalUnico: resultadoFinal.length,
        totalAntesDuplicacao: todasTransacoes.length,
        fornecedoresUnicos: new Set(resultadoFinal.map(t => t.cnpjCpfFornecedor)).size,
        deputadosUnicos: new Set(resultadoFinal.map(t => t.idDeputado)).size,
        valorTotal: resultadoFinal.reduce((sum, t) => sum + (t.valorLiquido || 0), 0)
      };
      
      console.log(`✅ [buscarTodasTransacoesFornecedores] BUSCA CONCLUÍDA:`, estatisticas);
      
      return resultadoFinal;
      
    } catch (error) {
      console.error('❌ [buscarTodasTransacoesFornecedores] Erro crítico na busca global:', error);
      return [];
    }
  }

  /**
   * Busca transações de um deputado específico - versão rápida
   */
  private async buscarTransacoesDeputadoRapido(deputadoId: string, ano?: number, mes?: number): Promise<any[]> {
    try {
      const transacoes: any[] = [];
      
      // Buscar apenas 2024 se não especificar ano (para ser mais rápido)
      const anosParaBuscar = ano ? [ano] : [2024, 2023];
      
      for (const anoAtual of anosParaBuscar) {
        try {
          const despesasRef = collection(db, `deputados/${deputadoId}/despesas/${anoAtual}/despesas`);
          const despesasQuery = despesasRef; // ✅ REMOVIDO LIMITE ARTIFICIAL - buscar TODAS as despesas
          const despesasSnapshot = await getDocs(despesasQuery);
          
          despesasSnapshot.forEach(doc => {
            const data = doc.data();
            
            // Aplicar filtro de mês se especificado
            if (mes) {
              const mesTransacao = data.mes || (data.dataDocumento ? new Date(data.dataDocumento).getMonth() + 1 : null);
              if (mesTransacao !== mes) return;
            }
            
            transacoes.push({
              ...data,
              id: doc.id,
              ano: anoAtual,
              mes: data.mes || (data.dataDocumento ? new Date(data.dataDocumento).getMonth() + 1 : null)
            });
          });
          
          // Se achou transações e não pediu ano específico, não precisa buscar outros anos
          if (transacoes.length > 0 && !ano) {
            break;
          }
        } catch (anoError) {
          // Ano pode não existir, continuar para próximo
          continue;
        }
      }
      
      return transacoes;
      
    } catch (error) {
      console.warn(`⚠️ [buscarTransacoesDeputadoRapido] Erro ao buscar transações do deputado ${deputadoId}:`, error);
      return [];
    }
  }

  /**
   * Busca transações de um deputado específico - versão completa
   */
  private async buscarTransacoesDeputado(deputadoId: string, ano?: number, mes?: number): Promise<any[]> {
    try {
      const transacoes: any[] = [];
      
      if (ano) {
        // Buscar ano específico
        const despesasRef = collection(db, `deputados/${deputadoId}/despesas/${ano}/despesas`);
        const despesasSnapshot = await getDocs(despesasRef);
        
        despesasSnapshot.forEach(doc => {
          const data = doc.data();
          
          // Aplicar filtro de mês se especificado
          if (mes) {
            const mesTransacao = data.mes || (data.dataDocumento ? new Date(data.dataDocumento).getMonth() + 1 : null);
            if (mesTransacao !== mes) return;
          }
          
          transacoes.push({
            ...data,
            id: doc.id,
            ano: ano,
            mes: data.mes || (data.dataDocumento ? new Date(data.dataDocumento).getMonth() + 1 : null)
          });
        });
      } else {
        // Buscar todos os anos disponíveis
        const deputadoRef = collection(db, `deputados/${deputadoId}/despesas`);
        const anosSnapshot = await getDocs(deputadoRef);
        
        for (const anoDoc of anosSnapshot.docs) {
          const anoAtual = parseInt(anoDoc.id);
          const despesasRef = collection(db, `deputados/${deputadoId}/despesas/${anoAtual}/despesas`);
          const despesasSnapshot = await getDocs(despesasRef);
          
          despesasSnapshot.forEach(doc => {
            const data = doc.data();
            
            // Aplicar filtro de mês se especificado
            if (mes) {
              const mesTransacao = data.mes || (data.dataDocumento ? new Date(data.dataDocumento).getMonth() + 1 : null);
              if (mesTransacao !== mes) return;
            }
            
            transacoes.push({
              ...data,
              id: doc.id,
              ano: anoAtual,
              mes: data.mes || (data.dataDocumento ? new Date(data.dataDocumento).getMonth() + 1 : null)
            });
          });
        }
      }
      
      return transacoes;
      
    } catch (error) {
      console.warn(`⚠️ [buscarTransacoesDeputado] Erro ao buscar transações do deputado ${deputadoId}:`, error);
      return [];
    }
  }

  /**
   * Remove duplicatas das transações globais
   */
  private deduplicarTransacoesGlobais(transacoes: any[]): any[] {
    const transacoesUnicas = new Map<string, any>();
    
    transacoes.forEach(transacao => {
      // Criar chave única baseada em campos-chave
      const chave = [
        transacao.nomeDeputado || transacao.deputadoNome,
        transacao.nomeFornecedor,
        transacao.valorLiquido || transacao.valor,
        transacao.dataDocumento || transacao.data,
        transacao.numDocumento || transacao.numeroDocumento
      ].filter(Boolean).join('|');
      
      // Manter apenas a primeira ocorrência
      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.set(chave, transacao);
      }
    });
    
    const resultado = Array.from(transacoesUnicas.values());
    const duplicatasRemovidas = transacoes.length - resultado.length;
    
    if (duplicatasRemovidas > 0) {
      console.log(`🧹 [deduplicarTransacoesGlobais] ${duplicatasRemovidas} duplicatas removidas (${transacoes.length} → ${resultado.length})`);
    }
    
    return resultado;
  }

  /**
   * Remove duplicatas das transações globais - VERSÃO OTIMIZADA
   * Considera diferentes fontes de dados e prioriza qualidade dos dados
   */
  private deduplicarTransacoesGlobaisOtimizado(transacoes: any[]): any[] {
    const transacoesUnicas = new Map<string, any>();
    const prioridadeFonte: Record<string, number> = {
      'estrutura_fornecedores': 3, // Maior prioridade (dados mais organizados)
      'estrutura_deputados': 2,   // Prioridade média
      'busca_direta_deputados': 1 // Menor prioridade
    };
    
    transacoes.forEach(transacao => {
      // Criar múltiplas chaves de deduplicação para maior robustez
      const chaves = [];
      
      // Chave principal (mais restritiva)
      const chavePrincipal = [
        transacao.idDeputado,
        transacao.cnpjCpfFornecedor,
        transacao.valorLiquido || transacao.valor,
        transacao.numDocumento || transacao.numeroDocumento,
        transacao.dataDocumento
      ].filter(Boolean).join('|');
      
      chaves.push(chavePrincipal);
      
      // Chave secundária (menos restritiva para pegar duplicatas com pequenas variações)
      const chaveSecundaria = [
        transacao.nomeDeputado || transacao.deputadoNome,
        transacao.nomeFornecedor,
        Math.round((transacao.valorLiquido || transacao.valor || 0) * 100) / 100, // Arredondar centavos
        transacao.dataDocumento
      ].filter(Boolean).join('|');
      
      chaves.push(chaveSecundaria);
      
      // Verificar se alguma das chaves já existe
      let chaveExistente = null;
      for (const chave of chaves) {
        if (transacoesUnicas.has(chave)) {
          chaveExistente = chave;
          break;
        }
      }
      
      if (chaveExistente) {
        // Duplicata encontrada - manter o de maior prioridade
        const transacaoExistente = transacoesUnicas.get(chaveExistente);
        const prioridadeExistente = prioridadeFonte[transacaoExistente.fonte] || 0;
        const prioridadeNova = prioridadeFonte[transacao.fonte] || 0;
        
        if (prioridadeNova > prioridadeExistente) {
          // Nova transação tem prioridade maior - substituir
          transacoesUnicas.set(chaveExistente, transacao);
        }
        // Senão manter a existente
      } else {
        // Não é duplicata - adicionar usando a chave principal
        transacoesUnicas.set(chavePrincipal, transacao);
      }
    });
    
    const resultado = Array.from(transacoesUnicas.values());
    const duplicatasRemovidas = transacoes.length - resultado.length;
    
    if (duplicatasRemovidas > 0) {
      console.log(`🧹 [deduplicarTransacoesGlobaisOtimizado] ${duplicatasRemovidas} duplicatas removidas (${transacoes.length} → ${resultado.length})`);
      
      // Log de estatísticas por fonte
      const estatisticasFonte: Record<string, number> = {};
      resultado.forEach(t => {
        const fonte = t.fonte || 'desconhecida';
        estatisticasFonte[fonte] = (estatisticasFonte[fonte] || 0) + 1;
      });
      console.log(`📊 [deduplicarTransacoesGlobaisOtimizado] Distribuição por fonte:`, estatisticasFonte);
    }
    
    return resultado;
  }
}

// Exportar instância única
export const firestoreService = new FirestoreService();
