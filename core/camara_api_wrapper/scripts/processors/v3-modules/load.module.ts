/**
 * Módulo de Carregamento para o Processador V3
 * Responsável por salvar os dados transformados no Firestore
 * 
 * MODERNIZADO: Agora usa BulkWriterManager para operações otimizadas
 */

import { 
  DespesaOptimizada, 
  DeputadoOptimizado, 
  // FornecedorOptimizado, // REMOVIDO: Interface eliminada - usar PerfilFornecedorCompleto
  RankingOptimizado, 
  AlertaInvestigativo, 
  EstatisticasGlobais,
  PerfilConsumidorDeputado,
  HistoricoAnualDeputado
} from '../../types/firestore.types.js';
import { PerfilFornecedorCompleto } from '../../types/perfil-fornecedor.types.js';
import { ETLResult } from '../../types/etl.types.js';
// REMOVIDO: import { createBatchManager } from '../../utils/storage/index.js';
import { createOptimizedBulkWriter, BulkWriterManager } from '../../utils/storage/firestore/bulk-writer.js';
import { createAdaptiveBulkWriter, AdaptiveBulkWriterManager } from '../../utils/storage/firestore/adaptive-bulk-writer.js';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { TransformedData } from './transform.module.js';
import { IntegrityController } from '../../utils/deduplication/integrity-controller.js';
import { getDeduplicationConfig } from '../../utils/deduplication/deduplication-configs.js';
import { quickMonitor, simpleProgress } from '../../utils/migration-monitor.js';
import { logger } from '../../utils/logging/index.js';

// Interface para dados completos a serem carregados
export interface LoadData extends TransformedData {
  rankings: RankingOptimizado[];
  alertas: AlertaInvestigativo[];
  estatisticas: EstatisticasGlobais;
}

/**
 * V3LoadModule - Módulo de Carregamento Unificado
 * 
 * Responsável por toda a lógica de salvamento dos dados transformados no Firestore,
 * garantindo a estrutura hierárquica correta com subcoleções anuais.
 */
export class V3LoadModule {
  private context: any;
  private integrityController: IntegrityController;

  constructor(context: any) {
    this.context = context;
    this.integrityController = new IntegrityController(getDeduplicationConfig('FORNECEDORES'));
  }

  private emitProgress(status: any, percentage: number, message: string) {
    this.context.emitProgress?.(status, percentage, message);
  }

  async load(data: LoadData): Promise<ETLResult> {
    const { ProcessingStatus } = await import('../../types/etl.types.js');
    const startTime = Date.now();
    
    // 🚀 ADAPTIVE: Usar AdaptiveBulkWriterManager inteligente que se adapta às condições
    const bulkWriter = createAdaptiveBulkWriter({
      enableMetrics: true,
      maxOperationsPerBatch: 250,    // Reduzido para configuração mais defensiva
      maxConcurrentBatches: 8,       // Reduzido para evitar saturação
      enableRetryLogging: this.context.options.verbose,
      minBatchSize: 50,              // Tamanho mínimo para adaptação
      maxBatchSize: 300,             // Tamanho máximo para adaptação
      targetSuccessRate: 95,         // Meta de 95% de sucesso
      adaptationSensitivity: 3       // Sensibilidade de adaptação
    });

    this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Iniciando carregamento adaptativo com AdaptiveBulkWriter');

    await this.salvarDadosDeputados(data, bulkWriter);
    await this.salvarDadosFornecedores(data, bulkWriter);
    await this.salvarMetadados(data, bulkWriter);

    this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Executando commit final com AdaptiveBulkWriter');
    const batchResults = await bulkWriter.commit();

    // 📊 ADAPTIVE REPORT: Gerar relatório de adaptação pós-commit
    if (this.context.options.debug) {
      bulkWriter.generateAdaptationReport();
    }

    const tempoTotal = Math.round((Date.now() - startTime) / 1000);
    
    // ✅ LOG ESTRUTURADO: Log de debug otimizado
    if (this.context.options.debug) {
      this.logProcessingSummary(data, tempoTotal);
    }

    return {
      sucessos: batchResults?.sucessos || 0,
      falhas: batchResults?.falhas || 0,
      avisos: 0,
      tempoProcessamento: tempoTotal,
      destino: 'Firestore (AdaptiveBulkWriter Inteligente - Estrutura Hierárquica V3+)',
      legislatura: this.context.options.legislatura!,
      detalhes: {
        deputadosSalvos: data.deputados.length,
        despesasSalvas: data.despesas.length,
        fornecedoresSalvos: data.fornecedores.length,
        rankingsSalvos: 0,
        alertasSalvos: 0,
        estatisticasIntegradas: 1,
        // 🎯 NOVA MÉTRICA: Performance do AdaptiveBulkWriter
        operacoesPorSegundo: batchResults?.operacoesPorSegundo || 0,
        // 🧠 ADAPTIVE METRICS: Métricas de adaptação inteligente
        configuracaoAdaptada: bulkWriter.getMetrics().adaptationCount > 0,
        batchSizeFinal: bulkWriter.getMetrics().currentBatchSize,
        concorrenciaFinal: bulkWriter.getMetrics().currentConcurrency
      }
    };
  }

  private async salvarDadosDeputados(data: LoadData, bulkWriter: AdaptiveBulkWriterManager | BulkWriterManager): Promise<void> {
    this.emitProgress({ CARREGANDO: 'CARREGANDO' }.CARREGANDO, 20, `Salvando ${data.deputados.length} deputados...`);
    
    // 📊 FASE 2: Monitorar migração nas despesas antes do salvamento
    simpleProgress(data.despesas, 'Load-Deputados-Despesas');

    const despesasPorDeputado = new Map<string, DespesaOptimizada[]>();
    for (const despesa of data.despesas) {
      if (!despesasPorDeputado.has(despesa.deputadoId)) {
        despesasPorDeputado.set(despesa.deputadoId, []);
      }
      despesasPorDeputado.get(despesa.deputadoId)!.push(despesa);
    }

    for (const deputado of data.deputados) {
      if (!deputado.id) continue;

      const despesasDeputado = despesasPorDeputado.get(deputado.id) || [];
      const valorTotal = despesasDeputado.reduce((sum, d) => sum + (d.valorLiquido || 0), 0);
      const fornecedoresUnicos = [...new Set(despesasDeputado.map(d => d.cnpjCpfFornecedor).filter(Boolean))];
      const anosAtivos = [...new Set(despesasDeputado.map(d => d.ano).filter(Boolean))];

      const pathDeputado = `monitorgastos/despesas/lista/${deputado.id}`;
      const db = getFirestore();
      const docRef = db.doc(pathDeputado);
      
      // 🚀 OTIMIZADO: Usar BulkWriter em vez de await individual
      bulkWriter.set(docRef, {
        dados: {
          id: deputado.id,
          nome: deputado.nome,
          siglaPartido: deputado.siglaPartido,
          siglaUf: deputado.siglaUf,
          valorTotalGeral: valorTotal,
          totalDespesas: despesasDeputado.length,
          numeroFornecedoresUnicos: fornecedoresUnicos.length,
          anosAtivos: anosAtivos.sort(),
          lastUpdate: Timestamp.now(),
        }
      }, { merge: true });

      const despesasPorAno = new Map<number, DespesaOptimizada[]>();
      for (const despesa of despesasDeputado) {
        // ✅ VALIDAÇÃO: Ignora despesas com ano inválido para evitar o erro '.../anos/undefined'
        const ano = despesa.ano;
        if (typeof ano === 'number' && ano > 1900) {
          if (!despesasPorAno.has(ano)) {
            despesasPorAno.set(ano, []);
          }
          despesasPorAno.get(ano)!.push(despesa);
        } else {
          this.context.logger.warn(`⚠️ Despesa para deputado ${deputado.id} com ano inválido foi ignorada: ${ano}`);
        }
      }

      for (const [ano, despesasDoAno] of despesasPorAno.entries()) {
        const pathAno = `${pathDeputado}/anos/${ano}`;
        const valorTotalAno = despesasDoAno.reduce((sum, d) => sum + (d.valorLiquido || 0), 0);
        const docAno = {
          dados: {
            ano,
            totalDespesas: despesasDoAno.length,
            valorTotal: valorTotalAno,
            despesas: despesasDoAno,
          }
        };

        // 🚨 CONTROLE DE TAMANHO (SHARDING): Se o documento do ano for muito grande, fragmente por mês.
        if (JSON.stringify(docAno).length > 950 * 1024) { // ~950KB para segurança
          this.context.logger.warn(`⚠️ Documento do ano ${ano} para Dep. ${deputado.id} é muito grande. Fragmentando por mês...`);

          // ✅ OTIMIZAÇÃO: Salva documento placeholder sem array de despesas para evitar duplicação
          const docRefAno = db.doc(pathAno);
          bulkWriter.set(docRefAno, {
            dados: {
              ano,
              totalDespesas: despesasDoAno.length,
              valorTotal: valorTotalAno,
              isSharded: true, // Flag indicando que os dados estão fragmentados nos meses
            }
          }, { merge: true });

          const despesasPorMes = new Map<number, DespesaOptimizada[]>();
          for (const despesa of despesasDoAno) {
            const mes = despesa.mes;
            if (typeof mes !== 'number' || mes < 1 || mes > 12) {
              this.context.logger.warn(`⚠️ Despesa para Dep. ${deputado.id} com mês inválido foi ignorada: ${mes}`);
              continue;
            }
            if (!despesasPorMes.has(mes)) {
              despesasPorMes.set(mes, []);
            }
            despesasPorMes.get(mes)!.push(despesa);
          }

          for (const [mes, despesasDoMes] of despesasPorMes.entries()) {
            const pathMes = `${pathAno}/meses/${mes}`;
            const valorTotalMes = despesasDoMes.reduce((sum, d) => sum + (d.valorLiquido || 0), 0);
            const docRefMes = db.doc(pathMes);
            bulkWriter.set(docRefMes, {
              dados: { ano, mes, totalDespesas: despesasDoMes.length, valorTotal: valorTotalMes, despesas: despesasDoMes }
            }, { merge: true });
          }
        } else {
          // Salva o documento do ano normalmente se o tamanho for aceitável
          const docRefAno = db.doc(pathAno);
          bulkWriter.set(docRefAno, docAno, { merge: true });
        }
      }
    }
  }

  private async salvarDadosFornecedores(data: LoadData, bulkWriter: AdaptiveBulkWriterManager | BulkWriterManager): Promise<void> {
    this.emitProgress({ CARREGANDO: 'CARREGANDO' }.CARREGANDO, 50, `Salvando ${data.fornecedores.length} fornecedores com BulkWriter...`);
    
    const db = getFirestore();

    for (const fornecedor of data.fornecedores) {
      const cnpj = fornecedor.identificacao.cnpj;
      if (!cnpj) continue;

      const despesasFornecedor = data.despesas.filter(d => d.cnpjCpfFornecedor === fornecedor.identificacao.cnpj);
      const totalRecebido = despesasFornecedor.reduce((sum, d) => sum + (d.valorLiquido || 0), 0);
      const deputadosUnicos = [...new Set(despesasFornecedor.map(d => d.deputadoId).filter(Boolean))];

      const pathFornecedor = `monitorgastos/fornecedores/lista/${cnpj}`;
      const docRefFornecedor = db.doc(pathFornecedor);
      // Calcular categoria principal baseada nos tipos de despesa das transações
      const categorias = this.calcularCategoriasFornecedor(despesasFornecedor);

      bulkWriter.set(docRefFornecedor, {
        dados: {
          // CORRIGIDO: Usar nomenclatura correta (remover 'id')
          nomeFornecedor: fornecedor.identificacao.nome,
          cnpjCpfFornecedor: cnpj,
          
          // Categorias baseadas em tipoDespesa das transações reais
          categoriaPrincipal: categorias.principal,
          categoriasSecundarias: categorias.secundarias,
          
          // Manter campos existentes
          totalRecebido,
          numeroTransacoes: despesasFornecedor.length,
          numeroDeputados: deputadosUnicos.length,
          lastUpdate: Timestamp.now(),
        }
      }, { merge: true });

      const transacoesPorAno = new Map<number, DespesaOptimizada[]>();
      for (const transacao of despesasFornecedor) {
        // 🚨 VALIDAÇÃO: Ignora transações com ano inválido para evitar o erro '.../anos/undefined'
        const ano = transacao.ano;
        if (typeof ano === 'number' && ano > 1900) {
          if (!transacoesPorAno.has(ano)) {
            transacoesPorAno.set(ano, []);
          }
          transacoesPorAno.get(ano)!.push(transacao);
        } else {
          this.context.logger.warn(`⚠️ Transação para fornecedor ${cnpj} com ano inválido foi ignorada: ${ano}`);
        }
      }

      for (const [ano, transacoesDoAno] of transacoesPorAno.entries()) {
        const pathAno = `${pathFornecedor}/anos/${ano}`;
        const valorTotalAno = transacoesDoAno.reduce((sum, t) => sum + (t.valorLiquido || 0), 0);
        const docAno = {
          dados: {
            ano,
            totalTransacoes: transacoesDoAno.length,
            valorTotal: valorTotalAno,
            transacoes: transacoesDoAno,
          }
        };

        // 🚨 CONTROLE DE TAMANHO (SHARDING): Se o documento do ano for muito grande, fragmente por mês.
        if (JSON.stringify(docAno).length > 950 * 1024) { // ~950KB para segurança
          this.context.logger.warn(`⚠️ Documento do ano ${ano} para Fornecedor ${cnpj} é muito grande. Fragmentando por mês...`);

          // ✅ OTIMIZAÇÃO: Salva documento placeholder sem array de transações para evitar duplicação
          const docRefAnoForn = db.doc(pathAno);
          bulkWriter.set(docRefAnoForn, {
            dados: {
              ano,
              totalTransacoes: transacoesDoAno.length,
              valorTotal: valorTotalAno,
              isSharded: true, // Flag indicando que os dados estão fragmentados nos meses
            }
          }, { merge: true });

          const transacoesPorMes = new Map<number, DespesaOptimizada[]>();
          for (const transacao of transacoesDoAno) {
            const mes = transacao.mes;
            if (typeof mes !== 'number' || mes < 1 || mes > 12) {
              this.context.logger.warn(`⚠️ Transação para Fornecedor ${cnpj} com mês inválido foi ignorada: ${mes}`);
              continue;
            }
            if (!transacoesPorMes.has(mes)) {
              transacoesPorMes.set(mes, []);
            }
            transacoesPorMes.get(mes)!.push(transacao);
          }

          for (const [mes, transacoesDoMes] of transacoesPorMes.entries()) {
            const pathMes = `${pathAno}/meses/${mes}`;
            const valorTotalMes = transacoesDoMes.reduce((sum, t) => sum + (t.valorLiquido || 0), 0);
            const docRefMesForn = db.doc(pathMes);
            bulkWriter.set(docRefMesForn, {
              dados: { ano, mes, totalTransacoes: transacoesDoMes.length, valorTotal: valorTotalMes, transacoes: transacoesDoMes }
            }, { merge: true });
          }
        } else {
          // Salva o documento do ano normalmente se o tamanho for aceitável
          const docRefAno = db.doc(pathAno);
          bulkWriter.set(docRefAno, docAno, { merge: true });
        }
      }
    }
  }

  private async salvarMetadados(data: LoadData, bulkWriter: AdaptiveBulkWriterManager | BulkWriterManager): Promise<void> {
    this.emitProgress({ CARREGANDO: 'CARREGANDO' }.CARREGANDO, 90, 'Salvando metadados do ETL com BulkWriter...');
    const path = 'monitorgastos/meta/etl/dados';
    const db = getFirestore();
    const docRefMeta = db.doc(path);
    bulkWriter.set(docRefMeta, {
      lastProcessed: Timestamp.now(),
      version: '3.1-hierarchical-bulk',
      legislatura: this.context.options.legislatura || 57,
      totalProcessed: {
        deputados: data.deputados?.length || 0,
        despesas: data.despesas?.length || 0,
        fornecedores: data.fornecedores?.length || 0
      },
      status: 'completed',
      // 🎯 NOVA MÉTRICA: Indicador de uso do AdaptiveBulkWriter
      optimizedWithAdaptiveBulkWriter: true
    }, { merge: true });
  }

  /**
   * Dicionário de tipos de despesa padronizados para correção automática
   */
  private readonly tiposDespesaPadrao = [
    'COMBUSTIVEIS E LUBRIFICANTES',
    'HOSPEDAGEM',
    'ALIMENTACAO',
    'PASSAGENS AEREAS', 
    'LOCACAO OU FRETAMENTO DE VEICULOS',
    'MANUTENCAO E CONSERVACAO DE VEICULOS',
    'SERVICOS POSTAIS',
    'TELEFONIA',
    'SERVICOS DE SEGURANCA',
    'CONSULTORIA JURIDICA',
    'CONSULTORIA CONTABIL',
    'ASSINATURA DE PUBLICACOES',
    'FORNECIMENTO DE ALIMENTACAO',
    'MATERIAL DE ESCRITORIO',
    'SERVICOS DE TAXI',
    'EMISSAO BILHETE AEREO',
    'DIVULGACAO DA ATIVIDADE PARLAMENTAR',
    'PARTICIPACAO EM CURSO OU EVENTO',
    'SERVICOS DE TELECOMUNICACOES'
  ];

  /**
   * Calcular a distância de Levenshtein entre duas strings
   */
  private calcularDistanciaLevenshtein(str1: string, str2: string): number {
    const matriz = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matriz[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matriz[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const custo = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matriz[j][i] = Math.min(
          matriz[j][i - 1] + 1, // inserção
          matriz[j - 1][i] + 1, // remoção
          matriz[j - 1][i - 1] + custo // substituição
        );
      }
    }

    return matriz[str2.length][str1.length];
  }

  /**
   * Normalizar e padronizar tipoDespesa com correção automática de erros
   */
  private normalizarEPadronizarTipoDespesa(tipo: string): string {
    if (!tipo || typeof tipo !== 'string') return 'NAO ESPECIFICADO';
    
    // Etapa 1: Normalização básica (remover acentos e caracteres especiais)
    let tipoNormalizado = tipo
      .trim()
      .normalize('NFD') // Decompose accented characters
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks (accents)
      .replace(/[çÇ]/g, 'c') // ç -> c
      .replace(/[^a-zA-Z0-9\s]/g, ' ') // Remove special chars, manter apenas letras, números e espaços
      .replace(/\s+/g, ' ') // Normalize multiple spaces
      .trim()
      .toUpperCase();

    if (tipoNormalizado.length === 0) return 'NAO ESPECIFICADO';

    // Etapa 2: Correção automática de erros de digitação usando similaridade
    let melhorCorrespondencia = tipoNormalizado;
    let menorDistancia = Infinity;
    const limiteTolerancia = Math.max(2, Math.floor(tipoNormalizado.length * 0.2)); // 20% de tolerância

    for (const tipoPadrao of this.tiposDespesaPadrao) {
      const distancia = this.calcularDistanciaLevenshtein(tipoNormalizado, tipoPadrao);
      
      // Se a distância está dentro da tolerância e é menor que a anterior
      if (distancia <= limiteTolerancia && distancia < menorDistancia) {
        menorDistancia = distancia;
        melhorCorrespondencia = tipoPadrao;
      }
    }

    // Se encontrou uma correspondência muito próxima (distância <= 2), usar a versão padronizada
    if (menorDistancia <= 2) {
      return melhorCorrespondencia;
    }

    // Etapa 3: Padronizações específicas por palavras-chave
    const palavrasChave = [
      { keywords: ['COMBUSTIVEL', 'GASOLINA', 'ALCOOL', 'DIESEL'], padrao: 'COMBUSTIVEIS E LUBRIFICANTES' },
      { keywords: ['HOTEL', 'POUSADA', 'HOSPEDAGEM'], padrao: 'HOSPEDAGEM' },
      { keywords: ['ALIMENTACAO', 'RESTAURANTE', 'LANCHE', 'REFEICAO'], padrao: 'ALIMENTACAO' },
      { keywords: ['PASSAGEM', 'AEREO', 'VOO', 'BILHETE'], padrao: 'PASSAGENS AEREAS' },
      { keywords: ['LOCACAO', 'FRETAMENTO', 'VEICULO', 'CARRO'], padrao: 'LOCACAO OU FRETAMENTO DE VEICULOS' },
      { keywords: ['MANUTENCAO', 'CONSERVACAO', 'REPARO'], padrao: 'MANUTENCAO E CONSERVACAO DE VEICULOS' },
      { keywords: ['CORREIOS', 'POSTAL', 'SEDEX'], padrao: 'SERVICOS POSTAIS' },
      { keywords: ['TELEFONE', 'CELULAR', 'TELECOM'], padrao: 'TELEFONIA' },
      { keywords: ['SEGURANCA'], padrao: 'SERVICOS DE SEGURANCA' },
      { keywords: ['JURIDIC', 'ADVOGAD'], padrao: 'CONSULTORIA JURIDICA' },
      { keywords: ['CONTABIL'], padrao: 'CONSULTORIA CONTABIL' },
      { keywords: ['TAXI'], padrao: 'SERVICOS DE TAXI' },
      { keywords: ['ESCRITORIO', 'PAPEL', 'MATERIAL'], padrao: 'MATERIAL DE ESCRITORIO' }
    ];

    for (const regra of palavrasChave) {
      if (regra.keywords.some(palavra => tipoNormalizado.includes(palavra))) {
        return regra.padrao;
      }
    }

    // Retornar versão normalizada se não encontrou correspondência
    return tipoNormalizado;
  }

  /**
   * Limpar texto removendo acentos e caracteres especiais (igual ao transform.module)
   */
  private limparTextoSemPadronizar(texto: string): string {
    if (!texto || typeof texto !== 'string') return 'NAO ESPECIFICADO';
    
    return texto
      .trim()
      .normalize('NFD') // Decompose accented characters
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks (accents)
      .replace(/[çÇ]/g, 'c') // ç -> c
      .replace(/[^a-zA-Z0-9\s]/g, ' ') // Remove special chars, manter apenas letras, números e espaços
      .replace(/\s+/g, ' ') // Normalize multiple spaces
      .trim()
      .toUpperCase();
  }

  /**
   * Calcula categoria principal e secundárias baseadas no tipoDespesa das transações
   * Ambos: textos originais da API LIMPOS (sem acentos/caracteres especiais)
   */
  private calcularCategoriasFornecedor(despesasFornecedor: any[]): { principal: string; secundarias: string[] } {
    if (!despesasFornecedor || despesasFornecedor.length === 0) {
      return {
        principal: 'NAO ESPECIFICADO',
        secundarias: []
      };
    }

    // Contar frequência dos tipos limpos
    const contadorTipos = new Map<string, number>();
    
    despesasFornecedor.forEach(despesa => {
      const tipoOriginal = despesa.tipoDespesa || despesa.tipoGasto || despesa.categoria;
      
      if (tipoOriginal && typeof tipoOriginal === 'string' && tipoOriginal.trim().length > 0) {
        // Limpar da mesma forma que nas transações
        const tipoLimpo = this.limparTextoSemPadronizar(tipoOriginal);
        contadorTipos.set(tipoLimpo, (contadorTipos.get(tipoLimpo) || 0) + 1);
      }
    });

    // Ordenar por frequência (maior para menor)
    const tiposOrdenados = Array.from(contadorTipos.entries())
      .sort(([,a], [,b]) => b - a)
      .map(([tipo]) => tipo);

    // AMBOS usando textos originais LIMPOS
    const principal = tiposOrdenados.length > 0 ? tiposOrdenados[0] : 'NAO ESPECIFICADO';
    const secundarias = tiposOrdenados.slice(1);

    return {
      principal,
      secundarias
    };
  }

  private logProcessingSummary(data: LoadData, tempoTotal: number): void {
    this.context.logger.info(`🏛️ Estrutura ETL V3 FINAL - PATHS CORRIGIDOS:`);
    this.context.logger.info(`   📁 monitorgastos/despesas/lista/{deputadoId} → campo 'dados'`);
    this.context.logger.info(`   └── 📁 anos/{ano} → campo 'dados' com despesas anuais (ou fragmentado em /meses/{mes})`);
    this.context.logger.info(`   📁 monitorgastos/fornecedores/lista/{cnpj} → campo 'dados'`);
    this.context.logger.info(`   └── 📁 anos/{ano} → campo 'dados' com transações anuais (ou fragmentado em /meses/{mes})`);
    this.context.logger.info(`   ✅ Paths com 4 segmentos (par) - compatível com Firestore`);
    this.context.logger.info(`   ✅ Estrutura hierárquica: despesas salvas em subcoleções anuais`);
    this.context.logger.info(`👥 Deputados processados: ${data.deputados.length}`);
    this.context.logger.info(`🏢 Fornecedores processados: ${data.fornecedores.length}`);
    this.context.logger.info(`⏱️ Tempo total: ${tempoTotal}s`);
  }

  getIntegrityReport(): any {
    return this.integrityController.generateIntegrityReport();
  }

  clearAuditLog(): void {
    this.integrityController.clearAuditLog();
  }
}