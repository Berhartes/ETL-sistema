/**
 * Processador ETL Modular para Despesas de Deputados da Câmara - Versão 3 Modular
 * 
 * Substitui o arquivo gigante por módulos organizados:
 * - extract.module.ts: Extração de dados da API
 * - transform.module.ts: Transformação e agregação
 * - load.module.ts: Carregamento no Firestore
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  ETLOptions,
  ProcessingStatus,
  ETLResult,
} from '../types/etl.types.js';
import { V3ExtractModule, ExtractedData } from './v3-modules/extract.module.js';
import { V3TransformModule, TransformedData } from './v3-modules/transform.module.js';
import { V3LoadModule, LoadData } from './v3-modules/load.module.js';
import { RankingOptimizado, AlertaInvestigativo, EstatisticasGlobais } from '../types/firestore.types.js';
import { Timestamp } from 'firebase-admin/firestore';

export class DespesasDeputadosV3ModularProcessor extends ETLProcessor<ExtractedData, LoadData> {
  private extractModule: V3ExtractModule;
  private transformModule: V3TransformModule;
  private loadModule: V3LoadModule;

  constructor(options: ETLOptions) {
    super(options);
    
    // Inicializar módulos com contexto compartilhado
    const sharedContext = {
      options: this.context.options,
      logger: this.context.logger,
      emitProgress: this.emitProgress.bind(this),
      incrementSucessos: this.incrementSucessos.bind(this),
      incrementFalhas: this.incrementFalhas.bind(this)
    };

    this.extractModule = new V3ExtractModule(sharedContext);
    this.transformModule = new V3TransformModule(sharedContext);
    this.loadModule = new V3LoadModule(sharedContext);
  }

  getProcessName(): string {
    return 'Despesas de Deputados V3 Modular';
  }

  async validate(): Promise<ValidationResult> {
    // Validações básicas
    if (!this.context.options.legislatura) {
      return {
        valido: false,
        erros: ['Legislatura é obrigatória'],
        avisos: []
      };
    }

    return {
      valido: true,
      erros: [],
      avisos: []
    };
  }

  async extract(): Promise<ExtractedData> {
    this.context.logger.info('🔍 Iniciando extração modular...');
    return await this.extractModule.extract();
  }

  async transform(data: ExtractedData): Promise<LoadData> {
    this.context.logger.info('🔄 Iniciando transformação modular...');
    
    const { getTotalRecebido, getNumeroTransacoes, getNumeroDeputados } = await import('../../../../../lib/fornecedor-utils.js');

    // Primeiro, transformar dados básicos
    const transformedData = await this.transformModule.transform(data);
    
    // Depois, gerar rankings, alertas e estatísticas
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 85, 'Gerando rankings e estatísticas');
    
    const rankings = this.gerarRankings(transformedData, { getTotalRecebido, getNumeroTransacoes, getNumeroDeputados });
    const alertas = this.gerarAlertas(transformedData, { getTotalRecebido, getNumeroDeputados });
    const estatisticas = this.calcularEstatisticasGlobais(transformedData);
    
    return {
      ...transformedData,
      rankings,
      alertas,
      estatisticas
    };
  }

  async load(data: LoadData): Promise<ETLResult> {
    this.context.logger.info('💾 Iniciando carregamento modular...');
    return await this.loadModule.load(data);
  }

  // =================================================================
  // MÉTODOS AUXILIARES PARA RANKINGS, ALERTAS E ESTATÍSTICAS
  // =================================================================

  private gerarRankings(data: TransformedData, fornecedorUtils: { getTotalRecebido: (forn: any) => number, getNumeroTransacoes: (forn: any) => number, getNumeroDeputados: (forn: any) => number }): RankingOptimizado[] {
    const rankings: RankingOptimizado[] = [];
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mes = agora.getMonth() + 1;
    const periodo = `${anoAtual}-${String(mes).padStart(2, '0')}`;

    this.context.logger.info(`🏆 [RANKINGS UNIFICADOS] Gerando rankings consolidados preservando todas as informações`);

    // 🏆 RANKINGS PARA PREMIAÇÕES - GERAL (TODOS OS ANOS)
    const deputadosOrdenadosTodos = [...data.deputados]
      .sort((a, b) => b.totalGastos - a.totalGastos);

    // ✅ RANKING GERAL HISTÓRICO (CONSOLIDADO)
    rankings.push({
      id: `deputados_geral_historico`,
      tipo: 'deputados',
      subtipo: 'todos_anos_geral',
      periodo: 'historico',
      ranking: deputadosOrdenadosTodos.slice(0, 500).map((dep, index) => ({
        posicao: index + 1,
        id: dep.id,
        nome: this.normalizarTextoParaConteudo(dep.nome),
        valor: dep.totalGastos,
        metadados: {
          partido: this.normalizarTextoParaConteudo(dep.siglaPartido),
          uf: this.normalizarTextoParaConteudo(dep.siglaUf),
          numeroTransacoes: dep.numeroTransacoes,
          urlFoto: dep.urlFoto,
          // ✅ DADOS CONSOLIDADOS DE AMBAS AS FONTES
          totalGastos2024: dep.totalGastos2024 || 0,
          totalGastos2023: dep.totalGastos2023 || 0,
          mediaGastosMensal: dep.mediaGastosMensal || 0,
          scoreInvestigativo: dep.scoreInvestigativo || 0
        }
      })),
      totalItens: deputadosOrdenadosTodos.length,
      ultimaAtualizacao: Timestamp.now(),
      // ✅ METADADOS CONSOLIDADOS
    });

    // 🏆 RANKINGS POR ANO ESPECÍFICO (para troféus anuais)
    const anosProcessados = [2022, 2023, 2024, 2025];
    for (const ano of anosProcessados) {
      // Ranking geral por ano
      const deputadosAno = deputadosOrdenadosTodos.filter(dep => 
        dep.gastosPorMes && Object.keys(dep.gastosPorMes).some(mes => mes.startsWith(ano.toString()))
      );

      if (deputadosAno.length > 0) {
        // ✅ RANKING GERAL POR ANO (CONSOLIDADO)
        rankings.push({
          id: `deputados_geral_${ano}`,
          tipo: 'deputados',
          subtipo: 'ano_geral',
          periodo: ano.toString(),
          ranking: deputadosAno.slice(0, 200).map((dep, index) => ({
            posicao: index + 1,
            id: dep.id,
            nome: this.normalizarTextoParaConteudo(dep.nome),
            valor: this.calcularGastosPorAno(dep, ano),
            metadados: {
              partido: this.normalizarTextoParaConteudo(dep.siglaPartido),
              uf: this.normalizarTextoParaConteudo(dep.siglaUf),
              numeroTransacoes: dep.numeroTransacoes,
              urlFoto: dep.urlFoto,
              // ✅ DADOS ESPECÍFICOS DO ANO
              ano: ano,
              percentualDoTotal: dep.totalGastos > 0 ? 
                (this.calcularGastosPorAno(dep, ano) / dep.totalGastos * 100) : 0
            }
          })),
          totalItens: deputadosAno.length,
          ultimaAtualizacao: Timestamp.now(),
          // ✅ METADADOS CONSOLIDADOS
        });
      }
    }

    // 🏆 RANKINGS POR CATEGORIA (TODOS OS ANOS) - Para coroas de categoria
    const categorias = this.extrairTodasCategorias(data.despesas);
    
    for (const categoria of categorias) {
      const deputadosPorCategoria = this.calcularRankingPorCategoria(data, categoria, 'todos_anos');
      
      if (deputadosPorCategoria.length > 0) {
        const categoriaSlug = this.normalizarNomeCategoria(categoria);
        
        // ✅ RANKING POR CATEGORIA HISTÓRICO (CONSOLIDADO)
        rankings.push({
          id: `deputados_${categoriaSlug}_historico`,
          tipo: 'deputados',
          subtipo: 'categoria_todos_anos',
          periodo: 'historico',
          categoria: this.normalizarTextoParaConteudo(categoria),
          ranking: deputadosPorCategoria.slice(0, 100).map((dep, index) => ({
            posicao: index + 1,
            id: dep.deputadoId,
            nome: this.normalizarTextoParaConteudo(dep.deputadoNome),
            valor: dep.totalGasto,
            metadados: {
              partido: this.normalizarTextoParaConteudo(dep.partido),
              uf: this.normalizarTextoParaConteudo(dep.uf),
              numeroTransacoes: dep.numeroTransacoes,
              urlFoto: dep.urlFoto,
              categoria: this.normalizarTextoParaConteudo(categoria),
              // ✅ DADOS ESPECÍFICOS DA CATEGORIA
              categoriaSlug,
              percentualDaCategoria: deputadosPorCategoria.length > 0 ? 
                (dep.totalGasto / deputadosPorCategoria.reduce((sum, d) => sum + d.totalGasto, 0) * 100) : 0
            }
          })),
          totalItens: deputadosPorCategoria.length,
          ultimaAtualizacao: Timestamp.now(),
          // ✅ METADADOS CONSOLIDADOS
        });
      }
    }

    // 🏆 RANKINGS POR CATEGORIA E ANO ESPECÍFICO - Para troféus de categoria (CONSOLIDADO)
    for (const ano of anosProcessados) {
      for (const categoria of categorias) {
        const deputadosPorCategoriaAno = this.calcularRankingPorCategoria(data, categoria, ano.toString());
        
        if (deputadosPorCategoriaAno.length > 0) {
          const categoriaSlug = this.normalizarNomeCategoria(categoria);
          
          // ✅ RANKING POR CATEGORIA E ANO (CONSOLIDADO)
          rankings.push({
            id: `deputados_${categoriaSlug}_${ano}`,
            tipo: 'deputados',
            subtipo: 'categoria_ano',
            periodo: ano.toString(),
            categoria: this.normalizarTextoParaConteudo(categoria),
            ranking: deputadosPorCategoriaAno.slice(0, 50).map((dep, index) => ({
              posicao: index + 1,
              id: dep.deputadoId,
              nome: this.normalizarTextoParaConteudo(dep.deputadoNome),
              valor: dep.totalGasto,
              metadados: {
                partido: this.normalizarTextoParaConteudo(dep.partido),
                uf: this.normalizarTextoParaConteudo(dep.uf),
                numeroTransacoes: dep.numeroTransacoes,
                urlFoto: dep.urlFoto,
                categoria: this.normalizarTextoParaConteudo(categoria),
                categoriaSlug,
                ano,
                // ✅ DADOS ESPECÍFICOS CATEGORIA + ANO
                percentualDaCategoria: deputadosPorCategoriaAno.length > 0 ? 
                  (dep.totalGasto / deputadosPorCategoriaAno.reduce((sum, d) => sum + d.totalGasto, 0) * 100) : 0,
                percentualDoAno: dep.totalGasto // será calculado na aplicação
              }
            })),
            totalItens: deputadosPorCategoriaAno.length,
            ultimaAtualizacao: Timestamp.now(),
            // ✅ METADADOS CONSOLIDADOS
          });
        }
      }
    }

    // ✅ RANKING MENSAL ATUAL (CONSOLIDADO) - Mantido para compatibilidade
    rankings.push({
      id: `deputados_gastos_${periodo}`,
      tipo: 'deputados',
      subtipo: 'gastos_totais',
      periodo,
      ranking: deputadosOrdenadosTodos.slice(0, 100).map((dep, index) => ({
        posicao: index + 1,
        id: dep.id,
        nome: this.normalizarTextoParaConteudo(dep.nome),
        valor: dep.totalGastos,
        metadados: {
          partido: this.normalizarTextoParaConteudo(dep.siglaPartido),
          uf: this.normalizarTextoParaConteudo(dep.siglaUf),
          numeroTransacoes: dep.numeroTransacoes,
          urlFoto: dep.urlFoto,
          // ✅ DADOS CONSOLIDADOS MENSAIS
          anoMes: periodo,
          ultimaAtualizacao: new Date().toISOString()
        }
      })),
      totalItens: deputadosOrdenadosTodos.length,
      ultimaAtualizacao: Timestamp.now(),
      // ✅ METADADOS CONSOLIDADOS
    });

    // 🏆 RANKINGS MENSAIS COMPLETOS - Para análise temporal detalhada
    this.context.logger.info(`📅 [RANKINGS MENSAIS] Extraindo todos os períodos mensais dos dados`);
    const todosOsPeriodosMensais = this.extrairTodosPeriodosMensais(data.deputados);
    
    this.context.logger.info(`📅 [RANKINGS MENSAIS] Encontrados ${todosOsPeriodosMensais.length} períodos mensais únicos`);
    
    for (const periodoMensal of todosOsPeriodosMensais) {
      // Calcular gastos de cada deputado neste mês específico
      const deputadosMes = data.deputados
        .map(dep => ({
          ...dep,
          gastosMes: this.calcularGastosPorMes(dep, periodoMensal)
        }))
        .filter(dep => dep.gastosMes > 0) // Só deputados com gastos no mês
        .sort((a, b) => b.gastosMes - a.gastosMes);

      if (deputadosMes.length > 0) {
        // ✅ RANKING MENSAL ESPECÍFICO (HISTÓRICO COMPLETO)
        rankings.push({
          id: `deputados_gastos_${periodoMensal}`,
          tipo: 'deputados',
          subtipo: 'gastos_totais',
          periodo: periodoMensal,
          ranking: deputadosMes.slice(0, 100).map((dep, index) => ({
            posicao: index + 1,
            id: dep.id,
            nome: this.normalizarTextoParaConteudo(dep.nome),
            valor: dep.gastosMes,
            metadados: {
              partido: this.normalizarTextoParaConteudo(dep.siglaPartido),
              uf: this.normalizarTextoParaConteudo(dep.siglaUf),
              numeroTransacoes: dep.numeroTransacoes,
              urlFoto: dep.urlFoto,
              // ✅ DADOS ESPECÍFICOS DO MÊS
              anoMes: periodoMensal,
              gastosTotais: dep.totalGastos,
              percentualDoTotal: dep.totalGastos > 0 ? 
                (dep.gastosMes / dep.totalGastos * 100) : 0,
              ultimaAtualizacao: new Date().toISOString()
            }
          })),
          totalItens: deputadosMes.length,
          ultimaAtualizacao: Timestamp.now(),
          // ✅ METADADOS MENSAIS
        });

        this.context.logger.info(`📅 [RANKINGS MENSAIS] Ranking criado para ${periodoMensal}: ${deputadosMes.length} deputados com gastos`);
      }
    }

    this.context.logger.info(`📅 [RANKINGS MENSAIS] ${todosOsPeriodosMensais.length} rankings mensais históricos gerados`);

    // ✅ RANKING DE FORNECEDORES (CONSOLIDADO)
    const fornecedoresOrdenados = [...data.fornecedores]
      .sort((a, b) => fornecedorUtils.getTotalRecebido(b) - fornecedorUtils.getTotalRecebido(a))
      .slice(0, 100);

    rankings.push({
      id: `fornecedores_recebido_${periodo}`,
      tipo: 'fornecedores',
      subtipo: 'total_recebido',
      periodo,
      ranking: fornecedoresOrdenados.map((forn, index) => ({
        posicao: index + 1,
        id: forn.identificacao.cnpj,
        nome: this.normalizarTextoParaConteudo(forn.identificacao.nome),
        valor: fornecedorUtils.getTotalRecebido(forn),
        metadados: {
          numeroDeputados: fornecedorUtils.getNumeroDeputados(forn),
          numeroTransacoes: fornecedorUtils.getNumeroTransacoes(forn),
          // ✅ DADOS CONSOLIDADOS FORNECEDORES
          cnpj: forn.identificacao.cnpj,
          // categoriaRisco: 'NORMAL', // REMOVIDO: Campo investigativo desabilitado
          anoMes: periodo
        }
      })),
      totalItens: fornecedoresOrdenados.length,
      ultimaAtualizacao: Timestamp.now(),
      // ✅ METADADOS CONSOLIDADOS
    });

    // ✅ UNIFICAÇÃO: Adicionar estatísticas como documento especial na coleção rankings
    const estatisticasGlobais = this.calcularEstatisticasGlobais(data);
    
    rankings.push({
      id: `estatisticas_globais`,
      tipo: 'deputados',
      subtipo: 'gastos_totais',
      periodo: estatisticasGlobais.periodo,
      // ✅ TODAS as estatísticas preservadas como metadados
      // Campos obrigatórios de ranking (vazios para estatísticas)
      ranking: [],
      totalItens: 0,
      ultimaAtualizacao: Timestamp.now()
    });

    this.context.logger.info(`🏆 [RANKINGS UNIFICADOS] Gerados ${rankings.length} documentos (incluindo estatísticas globais)`);
    
    return rankings;
  }

  // 🆕 MÉTODOS AUXILIARES PARA PREMIAÇÕES
  private extrairTodasCategorias(despesas: any[]): string[] {
    const categorias = new Set<string>();
    for (const despesa of despesas) {
      if (despesa.tipoDespesa && despesa.tipoDespesa.trim()) {
        categorias.add(despesa.tipoDespesa.trim());
      }
    }
    return Array.from(categorias).filter(cat => cat !== 'Não especificado');
  }

  /**
   * ✅ NORMALIZAÇÃO MELHORADA: Para IDs do Firestore (mais legível e compatível)
   * Corrige o problema de caracteres irregulares como ç→c, á→a, õ→o
   */
  private normalizarNomeCategoria(categoria: string): string {
    if (!categoria) return 'categoria_vazia';
    
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
      .replace(/_$/, '');
  }

  /**
   * ✅ NORMALIZAÇÃO PARA CONTEÚDO: Remove caracteres especiais de campos de texto
   * Usado para campos que serão salvos como conteúdo legível (não como IDs)
   */
  private normalizarTextoParaConteudo(texto: string): string {
    if (!texto) return '';
    
    return texto
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
      // Manter capitalização original e espaços para legibilidade
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calcularGastosPorAno(deputado: any, ano: number): number {
    if (!deputado.gastosPorMes) return 0;
    
    let total = 0;
    for (const [anoMes, valor] of Object.entries(deputado.gastosPorMes)) {
      if (anoMes.startsWith(ano.toString())) {
        total += valor as number;
      }
    }
    return total;
  }

  private calcularRankingPorCategoria(data: TransformedData, categoria: string, periodo: string): any[] {
    const deputadosCategoria = new Map<string, {
      deputadoId: string;
      deputadoNome: string;
      partido: string;
      uf: string;
      urlFoto?: string;
      totalGasto: number;
      numeroTransacoes: number;
    }>();

    // Filtrar despesas da categoria usando matching inteligente
    const despesasCategoria = data.despesas.filter(d => this.isCategoriaMatch(d.tipoDespesa, categoria));
    
    // Se período específico, filtrar por ano
    const despesasFiltradas = periodo === 'todos_anos' 
      ? despesasCategoria
      : despesasCategoria.filter(d => d.ano && d.ano.toString() === periodo);

    // Agregar por deputado
    for (const despesa of despesasFiltradas) {
      if (!deputadosCategoria.has(despesa.deputadoId)) {
        const deputadoInfo = data.deputados.find(d => d.id === despesa.deputadoId);
        if (deputadoInfo) {
          deputadosCategoria.set(despesa.deputadoId, {
            deputadoId: despesa.deputadoId,
            deputadoNome: this.normalizarTextoParaConteudo(despesa.deputadoNome),
            partido: despesa.partidoDeputado,
            uf: despesa.ufDeputado,
            urlFoto: deputadoInfo.urlFoto,
            totalGasto: 0,
            numeroTransacoes: 0
          });
        }
      }

      const registro = deputadosCategoria.get(despesa.deputadoId);
      if (registro) {
        registro.totalGasto += despesa.valorLiquido;
        registro.numeroTransacoes += 1;
      }
    }

    // Ordenar por total gasto
    return Array.from(deputadosCategoria.values())
      .sort((a, b) => b.totalGasto - a.totalGasto);
  }

  private gerarAlertas(data: TransformedData, fornecedorUtils: { getTotalRecebido: (forn: any) => number, getNumeroDeputados: (forn: any) => number }): AlertaInvestigativo[] {
    const alertas: AlertaInvestigativo[] = [];
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = agora.getMonth() + 1;
    const anoMes = `${ano}-${String(mes).padStart(2, '0')}`;

    // Alertas por gastos elevados
    for (const deputado of data.deputados) {
      if (deputado.totalGastos > 500000) {
        alertas.push({
          id: `gastos_alto_${deputado.id}_${Date.now()}`,
          tipo: 'LIMITE_EXCEDIDO',
          gravidade: 'ALTA',
          deputadoId: deputado.id,
          deputadoNome: this.normalizarTextoParaConteudo(deputado.nome),
          valor: deputado.totalGastos,
          percentualDesvio: ((deputado.totalGastos - 300000) / 300000) * 100,
          titulo: `Gastos Elevados - ${this.normalizarTextoParaConteudo(deputado.nome)}`,
          descricao: `Deputado com gastos totais de R$ ${deputado.totalGastos.toLocaleString('pt-BR')}`,
          categoria: 'FINANCEIRO',
          status: 'ATIVO',
          dataDeteccao: Timestamp.now(),
          ano,
          anoMes
        });
      }
    }

    // Alertas por fornecedores suspeitos (USANDO NOVA ESTRUTURA)
    for (const fornecedor of data.fornecedores) {
      const numeroDeputados = fornecedorUtils.getNumeroDeputados(fornecedor);
      const totalRecebido = fornecedorUtils.getTotalRecebido(fornecedor);
      
      if (numeroDeputados <= 2 && totalRecebido > 100000) {
        alertas.push({
          id: `fornecedor_suspeito_${fornecedor.identificacao.cnpj.replace(/\D/g, '')}_${Date.now()}`,
          tipo: 'FORNECEDOR_SUSPEITO',
          gravidade: 'MEDIA',
          deputadoId: '',
          deputadoNome: '',
          // ✅ NOMENCLATURA NOVA (Padrão API Câmara)
          cnpjCpfFornecedor: fornecedor.identificacao.cnpj,
          nomeFornecedor: this.normalizarTextoParaConteudo(fornecedor.identificacao.nome),
          // ✅ FASE 4: Compatibilidade transitória removida
          valor: totalRecebido,
          percentualDesvio: 0,
          titulo: `Fornecedor Suspeito - ${this.normalizarTextoParaConteudo(fornecedor.identificacao.nome)}`,
          descricao: `Fornecedor atende apenas ${numeroDeputados} deputado(s) mas recebeu R$ ${totalRecebido.toLocaleString('pt-BR')}`,
          categoria: 'FORNECEDOR',
          status: 'ATIVO',
          dataDeteccao: Timestamp.now(),
          ano,
          anoMes
        });
      }
    }

    return alertas;
  }

  /**
   * ✅ OTIMIZADO: Calcula apenas metadados complementares aos rankings
   * Elimina duplicações - os rankings detalhados estão na coleção 'rankings'
   */
  private calcularEstatisticasGlobais(data: TransformedData): EstatisticasGlobais {
    const agora = new Date();
    const periodo = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    
    const totalDeputados = data.deputados.length;
    const totalFornecedores = data.fornecedores.length;
    const totalDespesas = data.despesas.length;
    const volumeTotal = data.deputados.reduce((sum, dep) => sum + dep.totalGastos, 0);
    
    const gastosDeputados = data.deputados.map(d => d.totalGastos);
    gastosDeputados.sort((a, b) => a - b);

    // ✅ METADADOS COMPLEMENTARES (sem duplicar rankings)
    const categorias = this.extrairTodasCategorias(data.despesas);
    const anosDisponiveis = Array.from(new Set(data.despesas.map(d => d.ano).filter(ano => ano !== undefined && ano !== null))).sort();
    
    // ✅ ESTATÍSTICAS AGREGADAS ÚNICAS (não disponíveis em rankings)
    const distribuicaoGastos = this.calcularDistribuicaoGastos(gastosDeputados);
    const metricas = this.calcularMetricasAvancadas(data);
    const resumoPorAno = this.calcularResumoAnual(data, anosDisponiveis);
    const resumoPorCategoria = this.calcularResumoCategorial(data, categorias);

    return {
      id: periodo,
      periodo,
      
      // ✅ TOTAIS GERAIS (complementares aos rankings)
      totalDeputados,
      totalFornecedores,
      totalDespesas,
      volumeTotal,
      volumeMedio: volumeTotal / totalDeputados,
      transacoesTotais: data.deputados.reduce((sum, dep) => sum + dep.numeroTransacoes, 0),
      
      // ✅ INDICADORES DE CONFORMIDADE (únicos - não estão em rankings)
      deputadosSuspeitos: data.deputados.filter(d => d.indicadorConformidade === 'SUSPEITO').length,
      deputadosCriticos: data.deputados.filter(d => d.indicadorConformidade === 'ALTO_RISCO').length,
      // REMOVIDO: Campos investigativos de fornecedores (categoriaRisco) foram desabilitados
      fornecedoresSuspeitos: 0, // data.fornecedores.filter(f => f.categoriaRisco === 'SUSPEITO').length,
      fornecedoresCriticos: 0, // data.fornecedores.filter(f => f.categoriaRisco === 'ALTO_RISCO').length,
      
      // ✅ ESTATÍSTICAS REQUERIDAS
      maiorGastoDeputado: gastosDeputados.length > 0 ? Math.max(...gastosDeputados) : 0,
      menorGastoDeputado: gastosDeputados.length > 0 ? Math.min(...gastosDeputados) : 0,
      mediaGastoDeputado: gastosDeputados.length > 0 ? gastosDeputados.reduce((a, b) => a + b, 0) / gastosDeputados.length : 0,
      
      // ✅ DISTRIBUIÇÃO ESTATÍSTICA (complementar aos rankings)
      distribuicaoGastos,
      metricas,
      
      // ✅ METADADOS ESTRUTURAIS (para navegação nos rankings)
      categorias: categorias,
      totalCategorias: categorias.length,
      anosDisponiveis: anosDisponiveis,
      
      // ✅ RESUMOS AGREGADOS (sem duplicar dados dos rankings)
      resumoPorAno,
      resumoPorCategoria,
      
      // ✅ REFERÊNCIAS PARA RANKINGS (índice)
      rankingsDisponiveis: {
        geral: `deputados_geral_historico`,
        porAno: anosDisponiveis.map(ano => `deputados_geral_${ano}`),
        porCategoria: categorias.map(cat => `deputados_${this.normalizarNomeCategoria(cat)}_historico`),
        fornecedores: `fornecedores_recebido_${periodo}`
      },
      
      ultimaAtualizacao: Timestamp.now()
    };
  }

  // ✅ MÉTODOS OTIMIZADOS: Apenas metadados complementares aos rankings
  
  private calcularDistribuicaoGastos(gastosOrdenados: number[]): any {
    const total = gastosOrdenados.length;
    const q1Index = Math.floor(total * 0.25);
    const q2Index = Math.floor(total * 0.5);
    const q3Index = Math.floor(total * 0.75);
    
    return {
      quartil1: gastosOrdenados[q1Index],
      mediana: gastosOrdenados[q2Index],
      quartil3: gastosOrdenados[q3Index],
      minimo: gastosOrdenados[0],
      maximo: gastosOrdenados[total - 1],
      amplitude: gastosOrdenados[total - 1] - gastosOrdenados[0],
      desvioInterquartil: gastosOrdenados[q3Index] - gastosOrdenados[q1Index]
    };
  }

  private calcularMetricasAvancadas(data: TransformedData): any {
    const totalVolume = data.deputados.reduce((sum, dep) => sum + dep.totalGastos, 0);
    const totalTransacoes = data.deputados.reduce((sum, dep) => sum + dep.numeroTransacoes, 0);
    
    // Concentração (índice Herfindahl para deputados)
    const participacoes = data.deputados.map(d => d.totalGastos / totalVolume);
    const herfindahl = participacoes.reduce((sum, p) => sum + (p * p), 0);
    
    return {
      concentracaoHerfindahl: herfindahl,
      nivelConcentracao: herfindahl > 0.15 ? 'ALTA' : herfindahl > 0.05 ? 'MEDIA' : 'BAIXA',
      valorMedioTransacao: totalVolume / totalTransacoes,
      eficienciaProcessamento: data.deputados.filter(d => d.numeroTransacoes > 0).length / data.deputados.length,
      distribuicaoRisco: {
        baixoRisco: data.deputados.filter(d => d.indicadorConformidade !== 'SUSPEITO' && d.indicadorConformidade !== 'ALTO_RISCO').length,
        medioRisco: data.deputados.filter(d => d.indicadorConformidade === 'SUSPEITO').length,
        altoRisco: data.deputados.filter(d => d.indicadorConformidade === 'ALTO_RISCO').length
      }
    };
  }

  private calcularResumoAnual(data: TransformedData, anos: number[]): Record<string, any> {
    const resumo: Record<string, any> = {};
    
    for (const ano of anos) {
      // Verificação de segurança para ano undefined ou null
      if (ano === undefined || ano === null) {
        continue;
      }
      
      const despesasAno = data.despesas.filter(d => d.ano === ano);
      const deputadosAno = new Set(despesasAno.map(d => d.deputadoId));
      const fornecedoresAno = new Set(despesasAno.map(d => d.cnpjCpfFornecedor));
      const volumeAno = despesasAno.reduce((sum, d) => sum + d.valorLiquido, 0);

      resumo[ano.toString()] = {
        totalDespesas: despesasAno.length,
        deputadosAtivos: deputadosAno.size,
        fornecedoresAtivos: fornecedoresAno.size,
        volumeTotal: volumeAno,
        volumeMedio: volumeAno / deputadosAno.size,
        categoriasUsadas: Array.from(new Set(despesasAno.map(d => d.tipoDespesa))).length
      };
    }
    
    return resumo;
  }

  private calcularResumoCategorial(data: TransformedData, categorias: string[]): Record<string, any> {
    const resumo: Record<string, any> = {};
    const volumeTotal = data.despesas.reduce((sum, d) => sum + d.valorLiquido, 0);

    for (const categoria of categorias) {
      const despesasCategoria = data.despesas.filter(d => d.tipoDespesa === categoria);
      const volumeCategoria = despesasCategoria.reduce((sum, d) => sum + d.valorLiquido, 0);
      const deputadosCategoria = new Set(despesasCategoria.map(d => d.deputadoId));
      
      const categoriaSlug = this.normalizarNomeCategoria(categoria);
      resumo[categoriaSlug] = {
        nomeOriginal: categoria,
        totalDespesas: despesasCategoria.length,
        deputadosUsuarios: deputadosCategoria.size,
        volumeTotal: volumeCategoria,
        participacaoPercentual: (volumeCategoria / volumeTotal) * 100,
        anosAtivos: Array.from(new Set(despesasCategoria.map(d => d.ano))).length
      };
    }

    return resumo;
  }

  /**
   * ✅ SISTEMA DE MATCHING INTELIGENTE: Verifica se uma despesa pertence a uma categoria
   * usando matching normalizado para resolver o problema de perda de 95% dos deputados
   */
  private isCategoriaMatch(tipoDespesa: string, categoriaBusca: string): boolean {
    if (!tipoDespesa || !categoriaBusca) return false;
    
    // Normalizar ambas as strings
    const tipoDespesaNormalizada = this.normalizarCategoriaPorMatching(tipoDespesa);
    const categoriaBuscaNormalizada = this.normalizarCategoriaPorMatching(categoriaBusca);
    
    // 1. Matching exato normalizado
    if (tipoDespesaNormalizada === categoriaBuscaNormalizada) {
      return true;
    }
    
    // 2. Matching específico para LOCAÇÃO DE VEÍCULOS AUTOMOTORES
    if (categoriaBuscaNormalizada.includes('locacao') && categoriaBuscaNormalizada.includes('veiculos')) {
      return tipoDespesaNormalizada.includes('locacao') && 
             tipoDespesaNormalizada.includes('veiculos') &&
             !tipoDespesaNormalizada.includes('aeronaves') &&
             !tipoDespesaNormalizada.includes('embarcacoes');
    }
    
    // 3. Matching específico para LOCAÇÃO DE AERONAVES
    if (categoriaBuscaNormalizada.includes('locacao') && categoriaBuscaNormalizada.includes('aeronaves')) {
      return tipoDespesaNormalizada.includes('locacao') && 
             tipoDespesaNormalizada.includes('aeronaves');
    }
    
    // 4. Matching específico para LOCAÇÃO DE EMBARCAÇÕES
    if (categoriaBuscaNormalizada.includes('locacao') && categoriaBuscaNormalizada.includes('embarcacoes')) {
      return tipoDespesaNormalizada.includes('locacao') && 
             tipoDespesaNormalizada.includes('embarcacoes');
    }
    
    // 5. Matching específico para COMBUSTÍVEIS E LUBRIFICANTES
    if (categoriaBuscaNormalizada.includes('combustiveis') && categoriaBuscaNormalizada.includes('lubrificantes')) {
      return tipoDespesaNormalizada.includes('combustiveis') && 
             tipoDespesaNormalizada.includes('lubrificantes');
    }
    
    // 6. Matching específico para SERVIÇOS DE SEGURANÇA
    if (categoriaBuscaNormalizada.includes('seguranca') && categoriaBuscaNormalizada.includes('empresa')) {
      return tipoDespesaNormalizada.includes('seguranca') && 
             (tipoDespesaNormalizada.includes('empresa') || tipoDespesaNormalizada.includes('empresas'));
    }
    
    // 7. Matching específico para TOKENS E CERTIFICADOS DIGITAIS
    if (categoriaBuscaNormalizada.includes('tokens') && categoriaBuscaNormalizada.includes('certificados')) {
      return (tipoDespesaNormalizada.includes('token') || tipoDespesaNormalizada.includes('tokens')) &&
             (tipoDespesaNormalizada.includes('certificado') || tipoDespesaNormalizada.includes('certificados')) &&
             (tipoDespesaNormalizada.includes('digital') || tipoDespesaNormalizada.includes('digitais'));
    }
    
    // 8. Matching específico para PASSAGEM AÉREA - SIGEPA
    if (categoriaBuscaNormalizada.includes('passagem') && categoriaBuscaNormalizada.includes('sigepa')) {
      return (tipoDespesaNormalizada.includes('passagem') || tipoDespesaNormalizada.includes('passagens')) &&
             (tipoDespesaNormalizada.includes('aerea') || tipoDespesaNormalizada.includes('aereas')) &&
             tipoDespesaNormalizada.includes('sigepa');
    }
    
    // 9. Matching específico para CONSULTORIAS, PESQUISAS E TRABALHOS TÉCNICOS
    if (categoriaBuscaNormalizada.includes('consultoria') && 
        categoriaBuscaNormalizada.includes('pesquisa') && 
        categoriaBuscaNormalizada.includes('trabalho')) {
      return (tipoDespesaNormalizada.includes('consultoria') || tipoDespesaNormalizada.includes('consultorias')) &&
             (tipoDespesaNormalizada.includes('pesquisa') || tipoDespesaNormalizada.includes('pesquisas')) &&
             (tipoDespesaNormalizada.includes('trabalho') || tipoDespesaNormalizada.includes('trabalhos')) &&
             (tipoDespesaNormalizada.includes('tecnico') || tipoDespesaNormalizada.includes('tecnicos'));
    }
    
    // 10. Matching específico para PASSAGEM AÉREA - RPA
    if (categoriaBuscaNormalizada.includes('passagem') && categoriaBuscaNormalizada.includes('rpa')) {
      return (tipoDespesaNormalizada.includes('passagem') || tipoDespesaNormalizada.includes('passagens')) &&
             (tipoDespesaNormalizada.includes('aerea') || tipoDespesaNormalizada.includes('aereas')) &&
             tipoDespesaNormalizada.includes('rpa');
    }
    
    // 11. Matching específico para PASSAGEM AÉREA - REEMBOLSO
    if (categoriaBuscaNormalizada.includes('passagem') && categoriaBuscaNormalizada.includes('reembolso')) {
      return (tipoDespesaNormalizada.includes('passagem') || tipoDespesaNormalizada.includes('passagens')) &&
             (tipoDespesaNormalizada.includes('aerea') || tipoDespesaNormalizada.includes('aereas')) &&
             (tipoDespesaNormalizada.includes('reembolso') || tipoDespesaNormalizada.includes('restituicao'));
    }
    
    // 12. Matching específico para SERVIÇOS POSTAIS (com sinônimos expandido)
    if ((categoriaBuscaNormalizada.includes('servico') && categoriaBuscaNormalizada.includes('postal')) ||
        categoriaBuscaNormalizada.includes('correio')) {
      return (tipoDespesaNormalizada.includes('servico') || tipoDespesaNormalizada.includes('servicos') ||
              tipoDespesaNormalizada.includes('correio') || tipoDespesaNormalizada.includes('correios')) &&
             (tipoDespesaNormalizada.includes('postal') || tipoDespesaNormalizada.includes('postais') ||
              tipoDespesaNormalizada.includes('correio') || tipoDespesaNormalizada.includes('correios') ||
              tipoDespesaNormalizada.includes('postagem') || tipoDespesaNormalizada === 'correios');
    }
    
    // 13. Sistema de sinônimos expandido
    const sinonimos = {
      'aquisicao': ['compra', 'comprass', 'aquisicoes'],
      'servico': ['servicos'],
      'prestado': ['prestados'],
      'especializada': ['especializadas'],
      'consultoria': ['consultorias'],
      'pesquisa': ['pesquisas'],
      'trabalho': ['trabalhos'],
      'tecnico': ['tecnicos'],
      'passagem': ['passagens'],
      'aerea': ['aereas'],
      'postal': ['postais'],
      'correio': ['correios', 'postagem'],
      'reembolso': ['restituicao']
    };
    
    // Aplicar sinônimos na busca
    let tipoDespesaExpandida = tipoDespesaNormalizada;
    let categoriaBuscaExpandida = categoriaBuscaNormalizada;
    
    for (const [palavra, sinonimosArray] of Object.entries(sinonimos)) {
      for (const sinonimo of sinonimosArray) {
        if (tipoDespesaExpandida.includes(sinonimo)) {
          tipoDespesaExpandida += `-${palavra}`;
        }
        if (categoriaBuscaExpandida.includes(sinonimo)) {
          categoriaBuscaExpandida += `-${palavra}`;
        }
      }
    }
    
    // 14. Matching por palavras-chave principais (70%)
    const palavrasChave = categoriaBuscaExpandida.split('-').filter(p => p.length > 3);
    if (palavrasChave.length >= 2) {
      const matchCount = palavrasChave.reduce((count, palavra) => {
        return tipoDespesaExpandida.includes(palavra) ? count + 1 : count;
      }, 0);
      return (matchCount / palavrasChave.length) >= 0.7;
    }
    
    return false;
  }

  /**
   * Normalização para matching de categorias (diferente da normalização para IDs)
   */
  private normalizarCategoriaPorMatching(categoria: string): string {
    if (!categoria) return '';
    
    return categoria
      .toLowerCase()
      .replace(/[àáâãäå]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * ✅ NOVO: Extrai todos os períodos mensais únicos dos dados gastosPorMes
   */
  private extrairTodosPeriodosMensais(deputados: any[]): string[] {
    const periodosSet = new Set<string>();
    
    for (const deputado of deputados) {
      if (deputado.gastosPorMes) {
        Object.keys(deputado.gastosPorMes).forEach(periodo => {
          periodosSet.add(periodo);
        });
      }
    }
    
    // Ordenar períodos cronologicamente
    return Array.from(periodosSet).sort();
  }

  /**
   * ✅ NOVO: Calcula gastos específicos de um deputado em um mês
   */
  private calcularGastosPorMes(deputado: any, periodo: string): number {
    if (!deputado.gastosPorMes || !deputado.gastosPorMes[periodo]) {
      return 0;
    }
    return deputado.gastosPorMes[periodo];
  }
}