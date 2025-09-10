import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  getDoc,
  limit,
  collectionGroup
} from 'firebase/firestore';

import { FirestoreBase } from '../base/firestore-base.js';
import { firestoreCache } from '../base/firestore-cache.js';
import { transactionLogThrottle } from '../../log-throttle.js';

// Interface para deputado no Firestore (Estrutura V3)
export interface DeputadoFirestore {
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

export interface FiltrosDeputados {
  uf?: string;
  partido?: string;
  limite?: number;
}

export class DeputadosService extends FirestoreBase {
  
  /**
   * Buscar deputados com filtros opcionais
   */
  async buscarDeputados(filtros?: FiltrosDeputados): Promise<DeputadoFirestore[]> {
    const cacheKey = `deputados_${JSON.stringify(filtros || {})}`;
    
    return await firestoreCache.getOrSet(
      cacheKey,
      () => this.executarBuscaDeputados(filtros),
      'deputados',
      15 * 60 * 1000 // Cache por 15 minutos
    );
  }

  /**
   * Executar busca de deputados no Firestore
   */
  private async executarBuscaDeputados(filtros?: FiltrosDeputados): Promise<DeputadoFirestore[]> {
    try {
      console.log('🔍 Buscando deputados no Firestore (Estrutura V3)...');
      console.log('🔍 Filtros aplicados:', filtros);
      
      const db = this.getDb();
      let deputadosIds: string[] = [];
      
      console.log('🚀 Usando estratégia avançada: collectionGroup para descobrir todos os deputados...');
      
      try {
        // Usar collectionGroup para buscar todos os documentos na subcoleção 'dados'
        const dadosCollectionGroup = collectionGroup(db, 'dados');
        const querySnapshot = await getDocs(dadosCollectionGroup);
        
        console.log(`📊 Encontrados ${querySnapshot.docs.length} documentos na collectionGroup 'dados'`);
        
        // Extrair IDs únicos dos deputados
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
        console.log(`🎯 Descobertos ${deputadosIds.length} deputados únicos via collectionGroup`);
        
      } catch (error) {
        console.warn('⚠️ Erro ao usar collectionGroup, usando método de fallback:', error);
        deputadosIds = await this.getFallbackDeputadosIds();
      }
      
      return await this.processarDeputados(deputadosIds, filtros);
      
    } catch (error) {
      console.error('❌ Erro na busca de deputados:', error);
      
      const bancoVazio = await this.isBancoVazio();
      if (!bancoVazio) {
        (transactionLogThrottle as any).warn('Erro na busca de deputados', { error: error instanceof Error ? error.message : 'Erro desconhecido' });
      }
      
      return [];
    }
  }

  /**
   * Processar lista de IDs de deputados
   */
  private async processarDeputados(deputadosIds: string[], filtros?: FiltrosDeputados): Promise<DeputadoFirestore[]> {
    const deputados: DeputadoFirestore[] = [];
    let deputadosComDados = 0;
    let deputadosSemDados = 0;
    
    const db = this.getDb();
    
    for (const deputadoId of deputadosIds) {
      try {
        // Buscar dados do deputado na estrutura V3: despesas/{deputadoId}/dados/info
        const dadosRef = doc(db, 'despesas', deputadoId, 'dados', 'info');
        const dadosSnapshot = await getDoc(dadosRef);
        
        if (dadosSnapshot.exists()) {
          const deputadoData = dadosSnapshot.data();
          deputadosComDados++;
          
          // Aplicar filtros se fornecidos
          if (filtros?.uf && deputadoData.siglaUf !== filtros.uf) {
            continue;
          }
          if (filtros?.partido && deputadoData.siglaPartido !== filtros.partido) {
            continue;
          }
          
          const deputado: DeputadoFirestore = {
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
            // Dados pessoais
            dataNascimento: deputadoData.dataNascimento,
            dataFalecimento: deputadoData.dataFalecimento,
            sexo: deputadoData.sexo,
            escolaridade: deputadoData.escolaridade,
            ufNascimento: deputadoData.ufNascimento,
            municipioNascimento: deputadoData.municipioNascimento,
            urlWebsite: deputadoData.urlWebsite,
            email: deputadoData.email,
            // Métricas calculadas
            totalGastos: deputadoData.totalGastos,
            scoreInvestigativo: deputadoData.scoreInvestigativo,
            indicadorConformidade: deputadoData.indicadorConformidade,
            numeroTransacoes: deputadoData.numeroTransacoes,
            numeroFornecedores: deputadoData.numeroFornecedores,
            ultimaAtualizacao: deputadoData.ultimaAtualizacao
          };
          
          deputados.push(deputado);
          
          // Aplicar limite se especificado
          if (filtros?.limite && deputados.length >= filtros.limite) {
            break;
          }
        } else {
          deputadosSemDados++;
        }
      } catch (error) {
        deputadosSemDados++;
        console.error(`❌ Erro ao buscar dados do deputado ${deputadoId}:`, error);
      }
    }

    console.log(`📊 Resumo final buscarDeputados:`, {
      deputadosIdsDescobertas: deputadosIds.length,
      deputadosComDados,
      deputadosSemDados,
      deputadosProcessados: deputados.length
    });

    return deputados;
  }

  /**
   * Buscar deputado específico por ID
   */
  async buscarDeputadoCompleto(deputadoId: string): Promise<DeputadoFirestore | null> {
    const cacheKey = `deputado_completo_${deputadoId}`;
    
    return await firestoreCache.getOrSet(
      cacheKey,
      async () => {
        try {
          console.log(`🔍 Buscando deputado ${deputadoId} na estrutura V3...`);
          
          const db = this.getDb();
          const deputadoSnap = await getDoc(doc(db, 'despesas', deputadoId, 'dados', 'info'));
          
          if (!deputadoSnap.exists()) {
            const bancoVazio = await this.isBancoVazio();
            if (!bancoVazio) {
              console.warn(`⚠️ Deputado ${deputadoId} não encontrado na estrutura V3`);
            }
            return null;
          }
          
          const data = deputadoSnap.data();
          
          return {
            id: deputadoId,
            ...data
          } as DeputadoFirestore;
          
        } catch (error) {
          console.error(`❌ Erro ao buscar deputado ${deputadoId}:`, error);
          return null;
        }
      },
      'deputados',
      30 * 60 * 1000 // Cache por 30 minutos
    );
  }

  /**
   * Contar deputados reais no sistema
   */
  async contarDeputadosReais(): Promise<number> {
    try {
      console.log('🔢 Iniciando contagem de deputados reais no Firestore...');
      
      // Usar buscarDeputados sem filtro e contar APENAS deputados com dados reais
      const todosDadosDeputados = await this.buscarDeputados({ limite: 10000 });
      
      // Filtrar apenas deputados com dados reais (têm transações, gastos, etc.)
      const deputadosReais = todosDadosDeputados.filter(deputado => 
        deputado.totalGastos !== undefined && 
        deputado.totalGastos > 0 &&
        deputado.numeroTransacoes !== undefined && 
        deputado.numeroTransacoes > 0
      );
      
      const total = deputadosReais.length;
      
      console.log(`📊 Filtro aplicado: ${todosDadosDeputados.length} total → ${total} deputados reais com dados`);
      console.log(`🎯 Critério: deputados com totalGastos > 0 e numeroTransacoes > 0`);
      
      console.log(`✅ Total de deputados reais encontrados: ${total}`);
      return total;
      
    } catch (error) {
      console.error('❌ Erro ao contar deputados reais:', error);
      return 0;
    }
  }

  /**
   * Buscar APENAS deputados com dados reais (não sintéticos)
   */
  async buscarDeputadosReais(filtros?: FiltrosDeputados): Promise<DeputadoFirestore[]> {
    try {
      console.log('🎯 Buscando apenas deputados com dados reais...');
      
      // Buscar todos os deputados
      const todosDadosDeputados = await this.buscarDeputados({ 
        ...filtros, 
        limite: filtros?.limite || 10000 
      });
      
      // Filtrar apenas deputados com dados reais
      const deputadosReais = todosDadosDeputados.filter(deputado => 
        deputado.totalGastos !== undefined && 
        deputado.totalGastos > 0 &&
        deputado.numeroTransacoes !== undefined && 
        deputado.numeroTransacoes > 0
      );
      
      console.log(`📊 Filtro dados reais: ${todosDadosDeputados.length} total → ${deputadosReais.length} deputados reais`);
      return deputadosReais;
      
    } catch (error) {
      console.error('❌ Erro ao buscar deputados reais:', error);
      return [];
    }
  }

  /**
   * Buscar todos os deputados (método de compatibilidade)
   */
  async buscarTodosDeputados(): Promise<DeputadoFirestore[]> {
    try {
      console.log('🔍 Buscando todos os deputados...');
      const deputados = await this.buscarDeputados({ limite: 50000 });
      console.log(`✅ Encontrados ${deputados.length} deputados`);
      return deputados;
    } catch (error) {
      console.error('❌ Erro ao buscar todos os deputados:', error);
      return [];
    }
  }

  /**
   * IDs de fallback quando collectionGroup falhar
   */
  private async getFallbackDeputadosIds(): Promise<string[]> {
    // Lista expandida de IDs conhecidos e ranges
    const deputadosIds = ['107970', '109429', '121948'];
    
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
    return deputadosIds;
  }

  /**
   * Debug estrutura de deputado específico
   */
  async debugDeputadoEstrutura(deputadoId: string): Promise<void> {
    try {
      console.log(`🔍 [DEBUG] Analisando estrutura do deputado ${deputadoId}...`);
      
      const db = this.getDb();
      
      // Verificar documento principal
      const docPrincipalRef = doc(db, 'deputados', deputadoId);
      const docPrincipalSnap = await getDoc(docPrincipalRef);
      
      if (docPrincipalSnap.exists()) {
        console.log(`✅ [DEBUG] Documento principal exists: deputados/${deputadoId}`);
        console.log(`📄 [DEBUG] Dados:`, docPrincipalSnap.data());
      } else {
        console.log(`❌ [DEBUG] Documento principal NÃO existe: deputados/${deputadoId}`);
      }
      
      // Verificar dados V3
      const dadosRef = doc(db, 'despesas', deputadoId, 'dados', 'info');
      const dadosSnap = await getDoc(dadosRef);
      
      if (dadosSnap.exists()) {
        console.log(`✅ [DEBUG] Dados V3 exists: despesas/${deputadoId}/dados/info`);
        console.log(`📄 [DEBUG] Dados V3:`, dadosSnap.data());
      } else {
        console.log(`❌ [DEBUG] Dados V3 NÃO existem: despesas/${deputadoId}/dados/info`);
      }
      
    } catch (error) {
      console.error(`❌ [DEBUG] Erro ao analisar estrutura do deputado ${deputadoId}:`, error);
    }
  }
}

export const deputadosService = new DeputadosService();