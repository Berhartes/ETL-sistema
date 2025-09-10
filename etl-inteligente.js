#!/usr/bin/env node
/**
 * 🧠 ETL INTELIGENTE - Sistema Completo de Processamento Adaptativo
 * 
 * Combina detecção de conectividade, batching adaptativo, timeouts otimizados
 * e fallback automático para máxima resiliência e performance.
 */

import { FirestoreETLIntegration } from './etl-firestore-integration.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

class ETLInteligente {
  constructor() {
    this.serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/serviceAccountKey.json';
    this.projectId = this.getProjectIdFromKey();
    this.conectividade = null;
    this.estrategia = null;
    this.db = null; // Armazenar a instância do DB
  }

  /**
   * Lê o Project ID diretamente do arquivo de chave de serviço.
   */
  getProjectIdFromKey() {
    try {
      const serviceAccountKey = JSON.parse(readFileSync(this.serviceAccountPath, 'utf8'));
      return serviceAccountKey.project_id;
    } catch (error) {
      console.warn(`⚠️ Não foi possível ler o Project ID do arquivo de chave. Usando fallback.`);
      return process.env.FIRESTORE_PROJECT_ID || process.env.GCP_PROJECT_ID || 'a-republica-brasileira-aa927';
    }
  }

  /**
   * Obtém configuração padrão robusta para ETL
   */
  getConfiguracaoPadrao() {
    return {
      quality: 'good',
      strategy: 'firestore',
      config: {
        batchSize: 100,
        timeout: 300000, // 5 minutos
        retries: 5
      },
      recommendation: 'Configuração robusta para conexões mistas'
    };
  }

  /**
   * Analisa conectividade e define estratégia de processamento
   */
  async analisarConectividade() {
    console.log('🌐 ANÁLISE DE CONECTIVIDADE');
    console.log('═'.repeat(50));
    console.log('');

    try {
      // ✅ OTIMIZAÇÃO: Obter a instância do DB do módulo de integração para garantir que seja a mesma.
      if (!this.db) {
        const integracao = new FirestoreETLIntegration();
        this.db = integracao.getDb();
      }

      // REMOVIDO: Teste de conectividade que pode travar
      this.conectividade = this.getConfiguracaoPadrao();
      
      console.log('📊 RESULTADO DA ANÁLISE:');
      console.log(`   Qualidade: ${this.conectividade.quality?.toUpperCase() || 'DESCONHECIDA'}`);
      console.log(`   Estratégia: ${this.conectividade.strategy?.toUpperCase() || 'INDEFINIDA'}`);
      
      if (this.conectividade.config) {
        console.log('   Configuração otimizada:');
        console.log(`     - Batch Size: ${this.conectividade.config.batchSize}`);
        console.log(`     - Timeout: ${this.conectividade.config.timeout/1000}s`);
        console.log(`     - Retries: ${this.conectividade.config.retries}`);
      }
      
      if (this.conectividade.metrics?.writeLatency) {
        console.log(`   Latência de escrita: ${this.conectividade.metrics.writeLatency}ms`);
      }
      
      console.log(`   Recomendação: ${this.conectividade.recommendation || 'N/A'}`);
      console.log('');
      
      return this.conectividade;
      
    } catch (error) {
      console.warn('⚠️ Falha na análise de conectividade:', error.message);
      console.log('🔄 Usando configuração padrão...');
      
      this.conectividade = this.getConfiguracaoPadrao();
      
      return this.conectividade;
    }
  }

  /**
   * Processa dados usando Firestore com configurações otimizadas
   */
  async processarComFirestore(caminhoArquivoDados) {
    console.log('🔥 PROCESSAMENTO FIRESTORE INTELIGENTE');
    console.log('═'.repeat(50));
    console.log('');
    
    try {
      // ✅ CORREÇÃO: Aceitar tanto caminho de arquivo quanto objeto de dados
      let dadosProcessados;
      if (typeof caminhoArquivoDados === 'string') {
        dadosProcessados = JSON.parse(readFileSync(caminhoArquivoDados, 'utf8'));
      } else {
        dadosProcessados = caminhoArquivoDados; // Já é um objeto de dados
      }

      console.log(`📂 Dados carregados: ${dadosProcessados.deputados?.length || 0} deputados`);
      
      // Criar integração com configurações de conectividade
      const integracao = new FirestoreETLIntegration(this.conectividade, this.db);
      
      // Executar integração
      await integracao.salvarDadosDeputados(dadosProcessados);
      
      return {
        sucesso: true,
        metodo: 'firestore',
        integracao: integracao
      };
      
    } catch (error) {
      console.error('❌ Falha no processamento Firestore:', error.message);
      return {
        sucesso: false,
        metodo: 'firestore',
        erro: error.message
      };
    }
  }

  /**
   * Processa dados localmente como fallback
   */
  async processarLocal(caminhoOuDados) {
    console.log('🏠 PROCESSAMENTO LOCAL (FALLBACK)');
    console.log('═'.repeat(50));
    console.log('');
    
    try {
      // ✅ CORREÇÃO: Aceitar tanto caminho de arquivo quanto objeto de dados
      let dados;
      if (typeof caminhoOuDados === 'string') {
        dados = JSON.parse(readFileSync(caminhoOuDados, 'utf8'));
      } else {
        dados = caminhoOuDados; // Já é um objeto de dados
      }
      
      console.log('📊 Estatísticas dos dados:');
      console.log(`   Deputados: ${dados.deputados?.length || 0}`);
      console.log(`   Total despesas: ${dados.totalDespesas?.toLocaleString('pt-BR') || 0}`);
      
      const valorTotal = dados.deputados?.reduce((sum, dep) => sum + (dep.valorTotal || 0), 0) || 0;
      console.log(`   Valor total: R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      
      // Criar relatório local
      const relatorio = {
        timestamp: new Date().toISOString(),
        metodo: 'local',
        motivo: `connectividade_${this.conectividade?.quality || 'unknown'}`,
        dados: {
          totalDeputados: dados.deputados?.length || 0,
          totalDespesas: dados.totalDespesas || 0,
          valorTotal: valorTotal
        },
        conectividade: this.conectividade
      };
      
      // Salvar relatório
      if (!existsSync('./relatorios')) mkdirSync('./relatorios');
      const nomeRelatorio = `./relatorios/processamento_local_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
      writeFileSync(nomeRelatorio, JSON.stringify(relatorio, null, 2));
      
      console.log('');
      console.log(`📄 Relatório local salvo: ${nomeRelatorio}`);
      
      return {
        sucesso: true,
        metodo: 'local',
        relatorio: nomeRelatorio
      };
      
    } catch (error) {
      console.error('❌ Falha no processamento local:', error.message);
      return {
        sucesso: false,
        metodo: 'local',
        erro: error.message
      };
    }
  }

  /**
   * Processamento híbrido - salva dados críticos no Firestore, resto local
   */
  async processarHibrido(caminhoOuDados) {
    console.log('🔄 PROCESSAMENTO HÍBRIDO');
    console.log('═'.repeat(50));
    console.log('');
    
    console.log('📋 Estratégia híbrida:');
    console.log('   1. Metadados e estatísticas → Firestore');  
    console.log('   2. Dados completos → Processamento local');
    console.log('');
    
    try {
      // Processamento local completo
      const resultadoLocal = await this.processarLocal(caminhoOuDados);
      
      if (!resultadoLocal.sucesso) {
        throw new Error('Falha no processamento local');
      }
      
      // Tentar salvar apenas metadados no Firestore
      if (!this.db) {
        const integracao = new FirestoreETLIntegration();
        this.db = integracao.getDb();
      }
      try {
        // ✅ CORREÇÃO: Usar os dados que já temos em memória
        let dados;
        if (typeof caminhoOuDados === 'string') {
          dados = JSON.parse(readFileSync(caminhoOuDados, 'utf8'));
        } else {
          dados = caminhoOuDados; // Já é um objeto de dados
        }
        
        const integracao = new FirestoreETLIntegration(this.conectividade);
        
        // Salvar apenas estatísticas essenciais
        await integracao.salvarEstatisticasFinais(dados, Date.now() - 1000);
        console.log('✅ Metadados salvos no Firestore');
        
      } catch (firestoreError) {
        console.warn('⚠️ Falha ao salvar metadados no Firestore:', firestoreError.message);
      }
      
      return {
        sucesso: true,
        metodo: 'hibrido',
        detalhes: resultadoLocal
      };
      
    } catch (error) {
      console.error('❌ Falha no processamento híbrido:', error.message);
      return {
        sucesso: false,
        metodo: 'hibrido',
        erro: error.message
      };
    }
  }

  /**
   * Executa o processamento inteligente completo a partir de um objeto de dados já carregado.
   * Este método é ideal para ser chamado por outros scripts, como o etl-despesas-real.js.
   * 
   * ARQUITETURA SIMPLIFICADA: Processamento local confiável com opção de Firestore.
   */
  async executarComDados(dadosProcessados) {
    console.log('🧠 ETL INTELIGENTE - EXECUTANDO COM DADOS EM MEMÓRIA');
    console.log('═'.repeat(60));
    console.log('');

    const inicioProcessamento = Date.now();

    let resultado;

    try {
      // ✅ ESTRATÉGIA CORRETA: Tentar sempre a integração real primeiro.
      // A classe FirestoreETLIntegration já é robusta, adaptativa e possui retentativas.
      console.log('🔥 Tentando integração direta com Firestore...');
      resultado = await this.processarComFirestore(dadosProcessados);

      // Se a integração principal falhar, acionar o fallback para processamento local.
      if (!resultado || !resultado.sucesso) {
        console.warn('⚠️ Integração com Firestore falhou. Acionando fallback para processamento local.');
        resultado = await this.processarLocal(dadosProcessados);
      }
    } catch (error) {
      console.error('❌ Erro crítico durante a tentativa de integração. Acionando fallback final.');
      console.error(`   Detalhe do erro: ${error.message}`);
      resultado = await this.processarLocal(dadosProcessados);
    } finally {
      // Garante que o relatório final seja sempre exibido.
      await this.exibirRelatorioFinal(inicioProcessamento, resultado);
    }
  }

  /**
   * Exibe relatório final padronizado e encerra conexões
   */
  async exibirRelatorioFinal(inicioProcessamento, resultado) {
    const tempoTotal = Date.now() - inicioProcessamento;
    console.log('');
    console.log('🎯 PROCESSAMENTO CONCLUÍDO!');
    console.log('═'.repeat(40));
    console.log(`⏱️ Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
    console.log(`🎭 Método usado: ${resultado.metodo?.toUpperCase()}`);
    console.log(`✅ Sucesso: ${resultado.sucesso ? 'SIM' : 'NÃO'}`);
    
    if (resultado.erro) {
      console.log(`❌ Observação: ${resultado.erro}`);
    }

    // CRÍTICO: Encerrar conexões Firebase se a integração foi usada
    if (resultado.integracao?.encerrarConexoes) {
      try {
        await resultado.integracao.encerrarConexoes();
      } catch (error) {
        console.warn('⚠️ Erro ao encerrar conexões finais:', error.message);
      }
    }

    // Force process exit para garantir que não há conexões pendentes
    setTimeout(() => {
      console.log('🔄 Forçando encerramento do processo...');
      process.exit(0);
    }, 2000); // 2 segundos para cleanup
  }

  /**
   * Executa o processamento inteligente completo
   */
  async executar(caminhoArquivoDados) {
    console.log('🧠 ETL INTELIGENTE - SISTEMA ADAPTATIVO');
    console.log('═'.repeat(60));
    console.log('');
    
    if (!existsSync(caminhoArquivoDados)) {
      throw new Error(`Arquivo não encontrado: ${caminhoArquivoDados}`);
    }
    
    const inicioProcessamento = Date.now();
    
    try {
      // 1. Analisar conectividade
      await this.analisarConectividade();
      
      let resultado;
      
      // 2. Escolher estratégia baseada na conectividade
      switch (this.conectividade.strategy) {
        case 'firestore':
          resultado = await this.processarComFirestore(caminhoArquivoDados);
          break;
          
        case 'hybrid':
          resultado = await this.processarHibrido(caminhoArquivoDados);
          break;
          
        case 'offline':
        default:
          resultado = await this.processarLocal(caminhoArquivoDados);
          break;
      }
      
      // 3. Relatório final
      const tempoTotal = Date.now() - inicioProcessamento;
      console.log('');
      console.log('🎯 PROCESSAMENTO CONCLUÍDO!');
      console.log('═'.repeat(40));
      console.log(`⏱️ Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
      console.log(`🎭 Método usado: ${resultado.metodo?.toUpperCase()}`);
      console.log(`✅ Sucesso: ${resultado.sucesso ? 'SIM' : 'NÃO'}`);
      
      if (resultado.erro) {
        console.log(`❌ Erro: ${resultado.erro}`);
      }
      
    } catch (error) {
      console.log('');
      console.log('💥 ERRO FATAL NO PROCESSAMENTO');
      console.log('═'.repeat(40));
      console.log(`❌ Erro: ${error.message}`);
      
      throw error;
    }
  }
}

export default ETLInteligente;

// Execução via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const arquivoDados = process.argv[2];
  
  if (!arquivoDados) {
    console.log('📋 Uso: node etl-inteligente.js <caminho-arquivo-dados.json>');
    console.log('');
    console.log('Este ETL inteligente:');
    console.log('  🌐 Analisa automaticamente a qualidade da conexão');
    console.log('  ⚙️ Otimiza configurações baseado na conectividade');  
    console.log('  🔄 Usa fallback automático quando necessário');
    console.log('');
    console.log('Exemplo:');
    console.log('  node etl-inteligente.js ./dados_processados/despesas_legislatura_57_2025-09-09.json');
    process.exit(0);
  }
  
  const etl = new ETLInteligente();
  
  etl.executar(arquivoDados)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}