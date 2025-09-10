/**
 * Módulo de Extração para o Processador V3
 * Responsável por extrair dados da API da Câmara
 */

import { DeputadoBasico } from '../../types/etl.types.js';
import { apiClient, get, replacePath, endpoints } from '../../utils/api/index.js';
import { withRetry } from '../../utils/logging/error-handler.js';
import { etlConfig } from '../../../../../../config/index.js';
import { IntegrityController } from '../../utils/deduplication/integrity-controller.js';
import { getDeduplicationConfig } from '../../utils/deduplication/deduplication-configs.js';
import { AdvancedAnalytics } from '../../utils/deduplication/advanced-analytics.js';
import { SuspiciousPatternDetector } from '../../utils/deduplication/suspicious-patterns-detector.js';

// Interface para respostas da API da Câmara
interface ApiResponse<T = any> {
  dados: T;
  links?: any[];
}

// Interface para dados extraídos
export interface ExtractedData {
  deputados: DeputadoBasico[];
  despesasPorDeputado: Array<{
    deputadoId: string;
    despesas: any[];
    erro?: string;
  }>;
}

export class V3ExtractModule {
  private context: any;
  private integrityController: IntegrityController;
  private advancedAnalytics: AdvancedAnalytics;
  private patternDetector: SuspiciousPatternDetector;

  /**
   * Normaliza texto removendo acentos e caracteres especiais para uso em IDs e conteúdo
   */
  private normalizarTextoCompleto(texto: string): string {
    if (!texto || typeof texto !== 'string') return '';
    
    return texto
      .normalize('NFD') // Decomposição Unicode
      .replace(/[\u0300-\u036f]/g, '') // Remove diacríticos
      .replace(/[çÇ]/g, 'c')
      .replace(/[ñÑ]/g, 'n')
      .replace(/[æÆ]/g, 'ae')
      .replace(/[œŒ]/g, 'oe')
      .replace(/[ßß]/g, 'ss')
      .trim();
  }

  constructor(context: any) {
    this.context = context;
    this.integrityController = new IntegrityController(getDeduplicationConfig('API_DATA'));
    this.advancedAnalytics = new AdvancedAnalytics();
    this.patternDetector = new SuspiciousPatternDetector({
      enableTemporalAnalysis: true,
      enableMonetaryAnalysis: true,
      enableBehavioralAnalysis: true,
      enableStructuralAnalysis: true,
      autoBlockCriticalPatterns: false, // Não bloquear na extração
      autoFlagHighPatterns: true,
      maxAlertsPerOperation: 50
    });
  }

  private emitProgress(status: any, percentage: number, message: string) {
    this.context.emitProgress?.(status, percentage, message);
  }

  private incrementSucessos() {
    this.context.incrementSucessos?.();
  }

  private incrementFalhas() {
    this.context.incrementFalhas?.();
  }

  async extract(): Promise<ExtractedData> {
    const { ProcessingStatus } = await import('../../types/etl.types.js');
    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de dados');

    const legislatura = this.context.options.legislatura!;
    const limite = this.context.options.limite || 0;
    const deputadoEspecifico = this.context.options.deputado;
    const modoAtualizacao = this.context.options.atualizar;

    try {
      let deputadosParaProcessar: DeputadoBasico[] = [];

      if (deputadoEspecifico) {
        this.context.logger.info(`🎯 Extraindo despesas do deputado específico: ${deputadoEspecifico}`);
        deputadosParaProcessar = await this.extractDeputadoEspecifico(deputadoEspecifico, legislatura);
      } else {
        this.context.logger.info(`📋 Extraindo lista de deputados da ${legislatura}ª Legislatura`);
        const listaCompleta = await this.extractDeputadosLegislatura(legislatura);
        deputadosParaProcessar = this.applyFilters(listaCompleta);

        if (this.context.options.entre) {
          const entreParts = this.context.options.entre.split('-');
          const inicio = parseInt(entreParts[0], 10);
          const fim = parseInt(entreParts[1], 10);
          const sliceInicio = inicio - 1;
          const sliceFim = fim;

          if (sliceInicio < deputadosParaProcessar.length) {
            this.context.logger.info(`🔪 Aplicando filtro --entre ${inicio}-${fim}.`);
            deputadosParaProcessar = deputadosParaProcessar.slice(sliceInicio, sliceFim);
          } else {
            deputadosParaProcessar = [];
          }
        }
      }

      if (deputadosParaProcessar.length === 0) {
        this.context.logger.warn('⚠️ Nenhum deputado encontrado com os filtros especificados');
        return { deputados: [], despesasPorDeputado: [] };
      }

      // Deduplicar deputados antes de processar despesas
      this.emitProgress(ProcessingStatus.EXTRAINDO, 25, 'Verificando integridade dos deputados');
      const deputadosIntegrityController = new IntegrityController(getDeduplicationConfig('DEPUTADOS'));
      const deputadosResult = deputadosIntegrityController.deduplicateData(deputadosParaProcessar, 'DEPUTADOS_EXTRACAO');
      
      if (deputadosResult.duplicatesFound > 0) {
        this.context.logger.warn(`⚠️ [Extração] ${deputadosResult.duplicatesFound} deputados duplicados removidos`);
      }

      // Use apenas os deputados deduplicados (limite já foi aplicado em applyFilters)
      deputadosParaProcessar = deputadosResult.deduplicated;

      // ✅ OTIMIZAÇÃO: Análise de padrões suspeitos apenas em modo debug
      if (this.context.options.debug) {
        this.emitProgress(ProcessingStatus.EXTRAINDO, 28, 'Analisando padrões suspeitos nos deputados (modo debug)');
        try {
          const deputadosAlerts = await this.patternDetector.detectSuspiciousPatterns(
            deputadosParaProcessar,
            deputadosResult,
            'DEPUTADOS_EXTRACAO',
            'DEPUTADOS'
          );

          if (deputadosAlerts.length > 0) {
            const criticalAlerts = deputadosAlerts.filter(a => a.priority === 'CRITICAL');
            if (criticalAlerts.length > 0) {
              this.context.logger.error(`🚨 [Pattern Detector] ${criticalAlerts.length} alertas críticos nos deputados`);
              for (const alert of criticalAlerts.slice(0, 3)) {
                this.context.logger.error(`  🔍 ${alert.pattern.description} (Ação: ${alert.action})`);
              }
            }
          }
        } catch (error: any) {
          this.context.logger.warn(`⚠️ [Pattern Detector] Erro na análise de deputados (ignorado): ${error.message}`);
        }
      } else {
        this.context.logger.debug('🔍 Análise de padrões suspeitos pulada (não está em modo debug)');
      }

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo despesas de ${deputadosParaProcessar.length} deputados`);
      const despesasPorDeputado = await this.extractDespesasDeputados(deputadosParaProcessar, modoAtualizacao);
      
      // Deduplicar despesas por deputado
      this.emitProgress(ProcessingStatus.EXTRAINDO, 80, 'Verificando integridade das despesas');
      const despesasLimpas = await this.deduplicateDespesas(despesasPorDeputado);
      
      // Análise avançada de qualidade de dados final
      this.emitProgress(ProcessingStatus.EXTRAINDO, 85, 'Gerando relatório de qualidade de dados');
      const todasDespesas: any[] = despesasLimpas.reduce((acc: any[], dep) => acc.concat(dep.despesas), []);
      const mockDeduplicationResult = {
        deduplicated: todasDespesas,
        duplicatesFound: 0,
        integrityScore: 100,
        duplicateDetails: []
      };
      
      const dataQuality = this.advancedAnalytics.calculateDataQuality(todasDespesas, mockDeduplicationResult);
      
      this.context.logger.info(`📊 [Analytics] Qualidade dos dados extraídos:`);
      this.context.logger.info(`  • Completude: ${(dataQuality.completeness * 100).toFixed(1)}%`);
      this.context.logger.info(`  • Consistência: ${(dataQuality.consistency * 100).toFixed(1)}%`);
      this.context.logger.info(`  • Precisão: ${(dataQuality.accuracy * 100).toFixed(1)}%`);
      this.context.logger.info(`  • Atualidade: ${(dataQuality.timeliness * 100).toFixed(1)}%`);
      this.context.logger.info(`  • Validade: ${(dataQuality.validity * 100).toFixed(1)}%`);
      this.context.logger.info(`  • Unicidade: ${(dataQuality.uniqueness * 100).toFixed(1)}%`);
      this.context.logger.info(`  • Score geral: ${(dataQuality.overallScore * 100).toFixed(1)}%`);
      
      if (dataQuality.overallScore < 0.8) {
        this.context.logger.warn(`⚠️ [Analytics] Score de qualidade baixo (${(dataQuality.overallScore * 100).toFixed(1)}%) - Recomenda-se revisão`);
      }
      
      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração concluída');

      return { deputados: deputadosParaProcessar, despesasPorDeputado: despesasLimpas };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração: ${error.message}`);
      throw error;
    }
  }

  private async extractDeputadoEspecifico(deputadoId: string, legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.PERFIL;
      const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
      const response = await withRetry(() => get(endpoint, endpointConfig.PARAMS), etlConfig.camara.maxRetries, etlConfig.camara.pauseBetweenRequests, `Perfil do deputado ${deputadoId}`) as ApiResponse;
      if (!response || !response.dados) throw new Error(`Deputado ${deputadoId} não encontrado`);
      const deputado = response.dados;
      return [{
        id: deputado.id?.toString() || deputadoId,
        nome: this.normalizarTextoCompleto(deputado.nomeCivil || deputado.nome || ''),
        nomeCivil: this.normalizarTextoCompleto(deputado.nomeCivil || ''),
        siglaPartido: this.normalizarTextoCompleto(deputado.ultimoStatus?.siglaPartido || ''),
        siglaUf: this.normalizarTextoCompleto(deputado.ultimoStatus?.siglaUf || ''),
        idLegislatura: legislatura,
        urlFoto: deputado.ultimoStatus?.urlFoto || ''
      }];
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  private async extractDeputadosLegislatura(legislatura: number): Promise<DeputadoBasico[]> {
    const endpointConfig = endpoints.DEPUTADOS.LISTA;
    const endpoint = endpointConfig.PATH;
    const params = { ...endpointConfig.PARAMS, idLegislatura: legislatura.toString() };
    const deputados = await apiClient.getAllPages(endpoint, params, { context: `Deputados da ${legislatura}ª Legislatura` });
    return deputados.map((deputado: any) => ({
      id: deputado.id?.toString() || '',
      nome: this.normalizarTextoCompleto(deputado.nome || ''),
      nomeCivil: this.normalizarTextoCompleto(deputado.nomeCivil || ''),
      siglaPartido: this.normalizarTextoCompleto(deputado.siglaPartido || ''),
      siglaUf: this.normalizarTextoCompleto(deputado.siglaUf || ''),
      idLegislatura: legislatura,
      urlFoto: deputado.urlFoto || ''
    }));
  }

  private applyFilters(deputados: DeputadoBasico[]): DeputadoBasico[] {
    let filtrados = deputados;

    if (this.context.options.partido) {
      const partidos = this.context.options.partido.split(',').map((p: string) => p.trim().toUpperCase());
      filtrados = filtrados.filter(d => partidos.includes(d.siglaPartido.toUpperCase()));
      this.context.logger.info(`🎭 Filtro por partido(s): ${partidos.join(', ')} - ${filtrados.length} deputados`);
    }

    if (this.context.options.uf) {
      const ufs = this.context.options.uf.split(',').map((u: string) => u.trim().toUpperCase());
      filtrados = filtrados.filter(d => ufs.includes(d.siglaUf.toUpperCase()));
      this.context.logger.info(`🗺️ Filtro por UF(s): ${ufs.join(', ')} - ${filtrados.length} deputados`);
    }

    if (this.context.options.limite) {
      const limite = this.context.options.limite;
      filtrados = filtrados.slice(0, limite);
      this.context.logger.info(`🎯 Limitando processamento a ${limite} deputados`);
    }

    return filtrados;
  }

  private async extractDespesasDeputados(deputados: DeputadoBasico[], modoAtualizacao: boolean = false): Promise<Array<{ deputadoId: string, despesas: any[], erro?: string }>> {
    const concorrencia = this.context.options.concorrencia || 3;
    const resultados: Array<{ deputadoId: string, despesas: any[], erro?: string }> = [];
    const { ProcessingStatus } = await import('../../types/etl.types.js');
    
    // ✅ SISTEMA DE SKIP INTELIGENTE - Controle de deputados problemáticos
    const deputadosProblematicos = new Map<string, number>(); // deputadoId -> falhas consecutivas
    const MAX_FALHAS_CONSECUTIVAS = 3;

    for (let i = 0; i < deputados.length; i += concorrencia) {
      const lote = deputados.slice(i, i + concorrencia);
      const promessas = lote.map(async (deputado: DeputadoBasico) => {
        // ✅ VERIFICAR SE DEPUTADO JÁ FOI MARCADO COMO PROBLEMÁTICO
        const falhasConsecutivas = deputadosProblematicos.get(deputado.id) || 0;
        if (falhasConsecutivas >= MAX_FALHAS_CONSECUTIVAS) {
          this.context.logger.warn(`⚠️ Pulando deputado ${deputado.id} (${deputado.nome}) após ${falhasConsecutivas} falhas consecutivas`);
          return { 
            deputadoId: deputado.id, 
            despesas: [], 
            erro: `SKIPPED_AFTER_${falhasConsecutivas}_FAILURES` 
          };
        }

        try {
          const despesasResult = modoAtualizacao ? 
            await this.extractDespesasIncremental(deputado.id) : 
            await this.extractDespesasCompletas(deputado.id);
          
          // ✅ SUCESSO - Resetar contador de falhas
          deputadosProblematicos.delete(deputado.id);
          this.incrementSucessos();
          return despesasResult;
        } catch (error: any) {
          // ✅ FALHA - Incrementar contador de falhas consecutivas
          const novasFalhas = falhasConsecutivas + 1;
          deputadosProblematicos.set(deputado.id, novasFalhas);
          
          this.context.logger.error(`❌ Erro ao extrair despesas do deputado ${deputado.id} (${deputado.nome}) - Falha ${novasFalhas}/${MAX_FALHAS_CONSECUTIVAS}: ${error.message}`);
          
          if (novasFalhas >= MAX_FALHAS_CONSECUTIVAS) {
            this.context.logger.warn(`🚨 Deputado ${deputado.id} (${deputado.nome}) marcado como problemático após ${novasFalhas} falhas`);
          }
          
          this.incrementFalhas();
          return { deputadoId: deputado.id, despesas: [], erro: error.message };
        }
      });
      
      const resultadosLote = await Promise.allSettled(promessas);
      resultadosLote.forEach((resultado) => {
        if (resultado.status === 'fulfilled') {
          resultados.push(resultado.value);
        } else {
          // ✅ TRATAMENTO DE PROMISE REJEITADA
          this.context.logger.error(`❌ Promise rejeitada: ${resultado.reason}`);
        }
      });
      
      const progresso = Math.min(90, 30 + (i / deputados.length) * 60);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${resultados.length}/${deputados.length} deputados processados`);
      
      // ✅ PAUSA REDUZIDA ENTRE LOTES (era pauseBetweenRequests * 2)
      if (i + concorrencia < deputados.length) {
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests));
      }
    }
    
    // ✅ LOG FINAL DE DEPUTADOS PROBLEMÁTICOS
    if (deputadosProblematicos.size > 0) {
      this.context.logger.warn(`⚠️ Resumo de deputados problemáticos:`);
      for (const [deputadoId, falhas] of deputadosProblematicos) {
        const deputado = deputados.find(d => d.id === deputadoId);
        this.context.logger.warn(`  • ${deputadoId} (${deputado?.nome || 'Nome não encontrado'}): ${falhas} falhas`);
      }
    }
    
    return resultados;
  }

  private async extractDespesasCompletas(deputadoId: string): Promise<{ deputadoId: string, despesas: any[] }> {
    const legislatura = this.context.options.legislatura!;
    const ano = this.context.options.ano;
    const mes = this.context.options.mes;
    try {
      const endpointConfig = endpoints.DEPUTADOS.DESPESAS;
      const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
      
      // ✅ OTIMIZAÇÃO: Construir parâmetros limpos sem campos vazios
      const baseParams: Record<string, any> = {
        idLegislatura: legislatura.toString(),
        itens: String(etlConfig.camara.itemsPerPage || 100)
      };
      
      // ✅ Apenas adicionar parâmetros que têm valores válidos
      if (ano && ano !== '') baseParams.ano = ano.toString();
      if (mes && mes !== '') baseParams.mes = mes.toString();
      
      // ✅ Remover parâmetros vazios do endpoint config original
      const cleanEndpointParams = Object.fromEntries(
        Object.entries(endpointConfig.PARAMS || {}).filter(([key, value]) => 
          value !== '' && value !== null && value !== undefined
        )
      );
      
      // ✅ Merge apenas parâmetros válidos
      const finalParams = { ...cleanEndpointParams, ...baseParams };
      
      const todasDespesas = await apiClient.getAllPages(endpoint, finalParams, { 
        context: `Despesas do deputado ${deputadoId}`,
        // ✅ OTIMIZAÇÃO: Timeout reduzido para requisições individuais
        timeout: 15000 // Reduzido de 30000ms para 15000ms
      });
      
      return { deputadoId, despesas: todasDespesas };
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair despesas do deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  private async extractDespesasIncremental(deputadoId: string): Promise<{ deputadoId: string, despesas: any[] }> {
    const agora = new Date();
    const mesesParaVerificar: { ano: number; mes: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const data = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      mesesParaVerificar.push({ ano: data.getFullYear(), mes: data.getMonth() + 1 });
    }
    const mesesUnicos = [...new Map(mesesParaVerificar.map(item => [`${item.ano}-${item.mes}`, item])).values()];
    let todasDespesas: any[] = [];
    const dataLimiteInferior = new Date();
    dataLimiteInferior.setMonth(dataLimiteInferior.getMonth() - 2);
    dataLimiteInferior.setDate(1);
    dataLimiteInferior.setHours(0, 0, 0, 0);
    for (const { ano, mes } of mesesUnicos) {
      try {
        const despesasMes = await this.extractDespesasPorMes(deputadoId, ano, mes);
        const despesasRecentes = despesasMes.filter((despesa: any) => {
          if (!despesa.dataDocumento) return false;
          try {
            return new Date(despesa.dataDocumento) >= dataLimiteInferior;
          } catch (e) { return false; }
        });
        todasDespesas.push(...despesasRecentes);
      } catch (error: any) {
        this.context.logger.warn(`⚠️ Erro ao extrair mês ${ano}-${mes} do deputado ${deputadoId}: ${error.message}`);
      }
    }
    return { deputadoId, despesas: todasDespesas };
  }

  private async extractDespesasPorMes(deputadoId: string, ano: number, mes: number): Promise<any[]> {
    const legislatura = this.context.options.legislatura!;
    const endpointConfig = endpoints.DEPUTADOS.DESPESAS;
    const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
    
    // ✅ OTIMIZAÇÃO: Parâmetros limpos e otimizados
    const cleanEndpointParams = Object.fromEntries(
      Object.entries(endpointConfig.PARAMS || {}).filter(([key, value]) => 
        value !== '' && value !== null && value !== undefined
      )
    );
    
    const params: Record<string, any> = {
      ...cleanEndpointParams,
      idLegislatura: legislatura.toString(),
      ano: ano.toString(),
      mes: mes.toString(),
      itens: String(etlConfig.camara.itemsPerPage || 100)
    };
    
    return await apiClient.getAllPages(endpoint, params, { 
      context: `Despesas ${ano}-${mes.toString().padStart(2, '0')} do deputado ${deputadoId}`,
      timeout: 15000 // ✅ Timeout otimizado
    });
  }

  /**
   * Deduplica despesas por deputado usando controle de integridade
   */
  private async deduplicateDespesas(despesasPorDeputado: Array<{
    deputadoId: string;
    despesas: any[];
    erro?: string;
  }>): Promise<Array<{
    deputadoId: string;
    despesas: any[];
    erro?: string;
  }>> {
    const despesasLimpas: Array<{
      deputadoId: string;
      despesas: any[];
      erro?: string;
    }> = [];

    let totalDespesasOriginais = 0;
    let totalDespesasLimpas = 0;
    let totalDuplicatasRemovidas = 0;

    for (const registro of despesasPorDeputado) {
      if (registro.erro) {
        // Manter registros com erro
        despesasLimpas.push(registro);
        continue;
      }

      const despesasOriginais = registro.despesas;
      totalDespesasOriginais += despesasOriginais.length;

      if (despesasOriginais.length === 0) {
        despesasLimpas.push(registro);
        continue;
      }

      // Configurar controlador específico para despesas
      const despesasIntegrityController = new IntegrityController(getDeduplicationConfig('DESPESAS'));
      
      // Normalizar despesas para deduplicação
      const despesasNormalizadas = despesasOriginais.map((despesa, index) => {
        // ✅ CORREÇÃO: Preservar campos ano e mes da API original
        let ano = despesa.ano;
        let mes = despesa.mes;
        
        // Fallback apenas se campos da API estiverem ausentes
        if (!ano || !mes) {
          try {
            const dataDoc = new Date(despesa.dataDocumento);
            if (!ano) ano = dataDoc.getFullYear();
            if (!mes) mes = dataDoc.getMonth() + 1;
          } catch (e) {
            // Se dataDocumento também for inválida, usar dados atuais como último recurso
            const agora = new Date();
            if (!ano) ano = agora.getFullYear();
            if (!mes) mes = agora.getMonth() + 1;
            this.context.logger.warn(`⚠️ Despesa sem ano/mes válidos para deputado ${registro.deputadoId}, usando fallback: ${ano}-${mes}`);
          }
        }

        return {
          ...despesa,
          id: despesa.id || `${registro.deputadoId}_${index}`,
          deputadoId: registro.deputadoId,
          valorLiquido: parseFloat(despesa.valorLiquido || 0),
          valorDocumento: parseFloat(despesa.valorDocumento || 0),
          numeroDocumento: despesa.numeroDocumento || '',
          cnpjCpfFornecedor: despesa.cnpjCpfFornecedor || '',
          nomeFornecedor: this.normalizarTextoCompleto(despesa.nomeFornecedor || ''),
          tipoDespesa: this.normalizarTextoCompleto(despesa.tipoDespesa || ''),
          dataDocumento: despesa.dataDocumento || '',
          // ✅ CAMPOS PRESERVADOS DA API ORIGINAL
          ano: ano,
          mes: mes
        };
      });

      // Deduplicar despesas
      const result = despesasIntegrityController.deduplicateData(
        despesasNormalizadas,
        `DESPESAS_DEPUTADO_${registro.deputadoId}`
      );

      totalDespesasLimpas += result.deduplicated.length;
      totalDuplicatasRemovidas += result.duplicatesFound;

      if (result.duplicatesFound > 0) {
        this.context.logger.warn(`⚠️ [Extração] Deputado ${registro.deputadoId}: ${result.duplicatesFound} despesas duplicadas removidas`);
        
        // Log detalhado de duplicatas críticas
        const duplicatasCriticas = result.duplicateDetails.filter(d => d.severity === 'CRITICAL');
        if (duplicatasCriticas.length > 0) {
          this.context.logger.error(`🚨 [Extração] Deputado ${registro.deputadoId}: ${duplicatasCriticas.length} duplicatas CRÍTICAS detectadas`);
          for (const duplicata of duplicatasCriticas) {
            this.context.logger.error(`  -> Conflito crítico: ${duplicata.conflictFields.join(', ')}`);
          }
        }
      }

      if (result.integrityScore < 90) {
        this.context.logger.warn(`⚠️ [Extração] Deputado ${registro.deputadoId}: Score de integridade baixo (${result.integrityScore.toFixed(1)}%)`);
      }

      // ✅ OTIMIZAÇÃO: Análise de padrões suspeitos apenas em modo debug e com dados suficientes
      if (this.context.options.debug && despesasNormalizadas.length > 10) {
        try {
          const despesasAlerts = await this.patternDetector.detectSuspiciousPatterns(
            despesasNormalizadas,
            result,
            `DESPESAS_DEPUTADO_${registro.deputadoId}`,
            'DESPESAS'
          );

          if (despesasAlerts.length > 0) {
            const criticalAlerts = despesasAlerts.filter(a => a.priority === 'CRITICAL');
            const highAlerts = despesasAlerts.filter(a => a.priority === 'HIGH');
            
            if (criticalAlerts.length > 0) {
              this.context.logger.error(`🚨 [Pattern Detector] Deputado ${registro.deputadoId}: ${criticalAlerts.length} alertas críticos`);
              for (const alert of criticalAlerts.slice(0, 1)) { // ✅ Reduzido para 1 log por deputado
                this.context.logger.error(`  🔍 ${alert.pattern.description} (${alert.action})`);
              }
            }
            
            if (highAlerts.length > 0) {
              this.context.logger.warn(`⚠️ [Pattern Detector] Deputado ${registro.deputadoId}: ${highAlerts.length} alertas de alto risco`);
            }
          }
        } catch (patternError: any) {
          this.context.logger.warn(`⚠️ [Pattern Detector] Erro na análise do deputado ${registro.deputadoId}: ${patternError.message}`);
        }
      }

      // ✅ CORREÇÃO: MANTER campos ano e mes (não são temporários, são da API original)
      const despesasFinais = result.deduplicated;

      despesasLimpas.push({
        deputadoId: registro.deputadoId,
        despesas: despesasFinais,
        erro: registro.erro
      });
    }

    // Log consolidado
    this.context.logger.info(`🔍 [Extração] Deduplicação concluída:`);
    this.context.logger.info(`  • Despesas originais: ${totalDespesasOriginais}`);
    this.context.logger.info(`  • Despesas limpas: ${totalDespesasLimpas}`);
    this.context.logger.info(`  • Duplicatas removidas: ${totalDuplicatasRemovidas}`);
    this.context.logger.info(`  • Taxa de integridade: ${((totalDespesasLimpas / totalDespesasOriginais) * 100).toFixed(2)}%`);

    return despesasLimpas;
  }

  /**
   * Obtém relatório de integridade da extração
   */
  getIntegrityReport(): any {
    return this.integrityController.generateIntegrityReport();
  }

  /**
   * Limpa logs de auditoria
   */
  clearAuditLog(): void {
    this.integrityController.clearAuditLog();
  }
}