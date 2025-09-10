/**
 * Processador ETL Inteligente para Despesas de Deputados da Câmara - Versão 3 Plus
 *
 * Sistema ETL completo que:
 * 1. Extrai dados da API da Câmara (metodologia v2)
 * 2. Transforma com análise investigativa integrada
 * 3. Carrega estrutura otimizada para Firestore
 * 4. Gera agregações, rankings e scores em tempo real
 * 5. Cria índices otimizados para interface
 *
 * Substitui necessidade de scripts separados e Cloud Functions
 */

import { ETLProcessor } from '../core/etl-processor.js';
import {
  ValidationResult,
  DeputadoBasico,
  ETLOptions,
  ProcessingStatus,
  ETLResult,
} from '../types/etl.types.js';
import { DespesaOptimizada, DeputadoOptimizado, RankingOptimizado, AlertaInvestigativo, EstatisticasGlobais } from '../types/firestore.types.js';
import { PerfilFornecedorCompleto } from '../types/perfil-fornecedor.types.js';
import { createBatchManager } from '../utils/storage/index.js';
// import { firestoreDb as getDb } from '../utils/storage/firestore/index.js';
import { Timestamp } from 'firebase-admin/firestore';
import { etlConfig } from '../../../../../config/index.js';
import { apiClient, get, replacePath, endpoints } from '../utils/api/index.js';
import { withRetry } from '../utils/logging/error-handler.js';
import { formatarCnpjCpf } from '../utils/formatters.js';

// Interface de extração idêntica à v2 para garantir compatibilidade
interface ExtractedData {
  deputados: DeputadoBasico[];
  despesasPorDeputado: Array<{
    deputadoId: string;
    despesas: any[];
    erro?: string;
  }>;
}

// Interface de transformação para a nova estrutura otimizada com inteligência investigativa
interface TransformedData {
  deputados: DeputadoOptimizado[];
  despesas: DespesaOptimizada[];
  fornecedores: any[];
  rankings: RankingOptimizado[];
  alertas: AlertaInvestigativo[];
  estatisticas: EstatisticasGlobais;
}

// Configurações para algoritmos investigativos unificados (Lava Jato + CEAP)
interface ConfigInvestigativa {
  SCORE_THRESHOLDS: {
    POUCOS_DEPUTADOS_CRITICO: number;
    POUCOS_DEPUTADOS_MEDIO: number;
    VALOR_ALTO_TRANSACAO: number;
    VALOR_MUITO_ALTO: number;
    VOLUME_ALTO_CONCENTRADO: number;
    FRAGMENTACAO_SUSPEITA: number;
    PERCENTUAL_FIM_MES_SUSPEITO: number;
    PERCENTUAL_VALORES_REDONDOS: number;
  };
  MIN_VALOR_TRANSACAO: number;
  ANOS_ANALISE: number[];
  COTAS_CEAP: {
    VALOR_MAXIMO_MENSAL_DF: number;
    VALOR_MAXIMO_MENSAL_SP: number;
    LIMITE_COMBUSTIVEL: number;
    LIMITE_LOCACAO_VEICULO: number;
    LIMITE_SEGURANCA: number;
  };
}

// Configuração investigativa unificada (Lava Jato + CEAP)
const CONFIG_INVESTIGATIVA: ConfigInvestigativa = {
  SCORE_THRESHOLDS: {
    // Critérios Lava Jato (mantidos e aprimorados)
    POUCOS_DEPUTADOS_CRITICO: 2,
    POUCOS_DEPUTADOS_MEDIO: 5,
    VALOR_ALTO_TRANSACAO: 20000,
    VALOR_MUITO_ALTO: 50000,
    VOLUME_ALTO_CONCENTRADO: 100000,
    // Novos critérios CEAP
    FRAGMENTACAO_SUSPEITA: 800, // Valores "seguros" próximos ao limite de transparência
    PERCENTUAL_FIM_MES_SUSPEITO: 30, // % de gastos nos últimos 5 dias do mês
    PERCENTUAL_VALORES_REDONDOS: 40 // % valores redondos considerado suspeito
  },
  MIN_VALOR_TRANSACAO: 1,
  ANOS_ANALISE: [2022, 2023, 2024, 2025],
  COTAS_CEAP: {
    VALOR_MAXIMO_MENSAL_DF: 23033.13,
    VALOR_MAXIMO_MENSAL_SP: 42800.00,
    LIMITE_COMBUSTIVEL: 9392.00,
    LIMITE_LOCACAO_VEICULO: 12713.00,
    LIMITE_SEGURANCA: 8700.00
  }
};

// Categorias de alto risco baseadas na análise de cotas parlamentares e Lava Jato
const HIGH_RISK_INTANGIBLE_CATEGORIES = [
  'CONSULTORIAS, PESQUISAS E TRABALHOS TÉCNICOS', // Empresa de papel - 98,4% de irregularidades
  'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR', // Superfaturamento comum
  'SERVIÇOS DE SEGURANÇA PRESTADOS POR EMPRESA ESPECIALIZADA',
  'ASSINATURA DE PUBLICAÇÕES',
  'SERVIÇOS POSTAIS',
  'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES', // R$ 43,5M em 2024 - alto risco
  'SERVIÇOS DE TÁXI, PEDÁGIO E ESTACIONAMENTO',
  'SERVIÇOS DE TELECOMUNICAÇÕES',
  'FORNECIMENTO DE ALIMENTAÇÃO DO PARLAMENTAR',
  'HOSPEDAGEM, EXCETO EM HOTÉIS DA REDE OFICIAL'
];

// Categorias específicas para detecção de fragmentação
const FRAGMENTATION_PRONE_CATEGORIES = [
  'COMBUSTÍVEIS E LUBRIFICANTES', // Limite R$ 9.392 - comum fragmentar
  'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES', // Limite R$ 12.713
  'SERVIÇOS DE SEGURANÇA PRESTADOS POR EMPRESA ESPECIALIZADA' // Limite R$ 8.700
];

// Serviços tipicamente locais (suspeitos se fornecedor de UF diferente)
const LOCAL_SERVICE_CATEGORIES = [
  'COMBUSTÍVEIS E LUBRIFICANTES',
  'SERVIÇOS DE TÁXI, PEDÁGIO E ESTACIONAMENTO',
  'SERVIÇOS DE MANUTENÇÃO OU CONSERVAÇÃO DE VEÍCULOS AUTOMOTORES',
  'FORNECIMENTO DE ALIMENTAÇÃO DO PARLAMENTAR',
  'HOSPEDAGEM, EXCETO EM HOTÉIS DA REDE OFICIAL'
];

export class DespesasDeputadosV3Processor extends ETLProcessor<ExtractedData, TransformedData> {
  constructor(options: ETLOptions) {
    super(options);
  }

  protected getProcessName(): string {
    return 'Processador de Despesas de Deputados v3';
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = this.validateCommonParams();
    const erros = [...baseValidation.erros];
    const avisos = [...baseValidation.avisos];

    if (!this.context.options.legislatura) {
      erros.push('Legislatura é obrigatória.');
    }
    // Adicionar outras validações da v2 se necessário
    return { valido: erros.length === 0, erros, avisos };
  }

  // =================================================================
  // EXTRACTION LOGIC (Identical to V2)
  // =================================================================

  async extract(): Promise<ExtractedData> {
    const legislatura = this.context.options.legislatura!;
    const limite = this.context.options.limite || 0;
    const deputadoEspecifico = this.context.options.deputado;
    const modoAtualizacao = this.context.options.atualizar || false;

    this.emitProgress(ProcessingStatus.EXTRAINDO, 10, 'Iniciando extração de dados');

    try {
      let deputadosParaProcessar: DeputadoBasico[];

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

        if (limite > 0 && deputadosParaProcessar.length > limite) {
          this.context.logger.info(`🔢 Aplicando limite: ${limite} de ${deputadosParaProcessar.length} deputados`);
          deputadosParaProcessar = deputadosParaProcessar.slice(0, limite);
        }
      }

      if (deputadosParaProcessar.length === 0) {
        this.context.logger.warn('⚠️ Nenhum deputado encontrado com os filtros especificados');
        return { deputados: [], despesasPorDeputado: [] };
      }

      // Etapa de Enriquecimento
      this.emitProgress(ProcessingStatus.EXTRAINDO, 20, `Enriquecendo dados de ${deputadosParaProcessar.length} deputados`);
      deputadosParaProcessar = await this.enriquecerDeputadosComDetalhes(deputadosParaProcessar);

      this.emitProgress(ProcessingStatus.EXTRAINDO, 30, `Extraindo despesas de ${deputadosParaProcessar.length} deputados`);
      const despesasPorDeputado = await this.extractDespesasDeputados(deputadosParaProcessar, modoAtualizacao);
      this.emitProgress(ProcessingStatus.EXTRAINDO, 90, 'Extração concluída');

      return { deputados: deputadosParaProcessar, despesasPorDeputado };

    } catch (error: any) {
      this.context.logger.error(`❌ Erro na extração: ${error.message}`);
      throw error;
    }
  }

  private async extractDeputadoEspecifico(deputadoId: string, legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.PERFIL;
      const endpoint = replacePath(endpointConfig.PATH, { codigo: deputadoId });
      const response = await withRetry(() => get(endpoint, endpointConfig.PARAMS), etlConfig.camara.maxRetries, etlConfig.camara.pauseBetweenRequests, `Perfil do deputado ${deputadoId}`);
      if (!response || !response.dados) throw new Error(`Deputado ${deputadoId} não encontrado`);
      const deputado = response.dados;
      return [{
        id: deputado.id?.toString() || deputadoId,
        nome: deputado.nomeCivil || deputado.nome || '',
        nomeCivil: deputado.nomeCivil,
        siglaPartido: deputado.ultimoStatus?.siglaPartido || '',
        siglaUf: deputado.ultimoStatus?.siglaUf || '',
        idLegislatura: legislatura,
        urlFoto: deputado.ultimoStatus?.urlFoto || ''
      }];
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair deputado ${deputadoId}: ${error.message}`);
      throw error;
    }
  }

  private async extractDeputadosLegislatura(legislatura: number): Promise<DeputadoBasico[]> {
    try {
      const endpointConfig = endpoints.DEPUTADOS.LISTA;
      let deputados: DeputadoBasico[] = [];
      let pagina = 1;
      do {
        const params = { ...endpointConfig.PARAMS, idLegislatura: legislatura.toString(), ordem: 'ASC', ordenarPor: 'nome', pagina: pagina.toString(), itens: String(etlConfig.camara.itemsPerPage || endpoints.REQUEST.DEFAULT_ITEMS_PER_PAGE) };
        const response = await withRetry(() => get(endpointConfig.PATH, params), etlConfig.camara.maxRetries, etlConfig.camara.pauseBetweenRequests, `Lista de deputados da legislatura ${legislatura}, página ${pagina}`);
        if (!response || !response.dados || !Array.isArray(response.dados) || response.dados.length === 0) break;
        const deputadosDaPagina: DeputadoBasico[] = response.dados.map((dep: any) => ({ id: dep.id?.toString() || '', nome: dep.nome || '', nomeCivil: dep.nomeCivil, siglaPartido: dep.siglaPartido || '', siglaUf: dep.siglaUf || '', idLegislatura: legislatura, urlFoto: dep.urlFoto || '' }));
        deputados = deputados.concat(deputadosDaPagina);
        pagina++;
        await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests / 2));
      } while (true);
      this.context.logger.info(`✅ Encontrados ${deputados.length} deputados na ${legislatura}ª Legislatura`);
      return deputados;
    } catch (error: any) {
      this.context.logger.error(`❌ Erro ao extrair lista de deputados: ${error.message}`);
      throw error;
    }
  }

  private applyFilters(deputados: DeputadoBasico[]): DeputadoBasico[] {
    let filtrados = [...deputados];
    const totalOriginal = filtrados.length;
    filtrados = this.deduplicateDeputados(filtrados);
    if (totalOriginal !== filtrados.length) this.context.logger.info(`🔄 Deduplicação: ${totalOriginal} → ${filtrados.length} deputados`);
    if (this.context.options.partido) {
      const partido = this.context.options.partido.toUpperCase();
      filtrados = filtrados.filter(dep => dep.siglaPartido === partido);
      this.context.logger.info(`🔍 Filtro por partido ${partido}: ${filtrados.length} deputados`);
    }
    if (this.context.options.uf) {
      const uf = this.context.options.uf.toUpperCase();
      filtrados = filtrados.filter(dep => dep.siglaUf === uf);
      this.context.logger.info(`🔍 Filtro por UF ${uf}: ${filtrados.length} deputados`);
    }
    return filtrados;
  }

  private deduplicateDeputados(deputados: DeputadoBasico[]): DeputadoBasico[] {
    const deputadosUnicos = new Map<string, DeputadoBasico>();
    for (const deputado of deputados) {
      if (!deputadosUnicos.has(deputado.id)) {
        deputadosUnicos.set(deputado.id, deputado);
      }
    }
    return Array.from(deputadosUnicos.values());
  }

  private async enriquecerDeputadosComDetalhes(deputados: DeputadoBasico[]): Promise<DeputadoBasico[]> {
    const deputadosEnriquecidos: DeputadoBasico[] = [];
    const concorrencia = this.context.options.concorrencia || 2;
    this.context.logger.info(`🔎 Enriquecendo dados de deputados com concorrência: ${concorrencia}`);

    for (let i = 0; i < deputados.length; i += concorrencia) {
      const lote = deputados.slice(i, i + concorrencia);
      const promessas = lote.map(async (deputado) => {
        try {
          const endpointConfig = endpoints.DEPUTADOS.PERFIL;
          const endpoint = replacePath(endpointConfig.PATH, { codigo: deputado.id });
          const response = await withRetry(() => get(endpoint, endpointConfig.PARAMS), etlConfig.camara.maxRetries, etlConfig.camara.pauseBetweenRequests, `Detalhes do deputado ${deputado.id}`);
          
          if (response && response.dados) {
            const detalhes = response.dados;
            
            // Capturar os 3 campos críticos
            const nomeEleitoral = detalhes.ultimoStatus?.nomeEleitoral;
            const situacao = detalhes.ultimoStatus?.situacao;
            const condicaoEleitoral = detalhes.ultimoStatus?.condicaoEleitoral;
            
            const deputadoEnriquecido = {
              ...deputado,
              nomeCivil: detalhes.nomeCivil,
              cpf: detalhes.cpf,
              sexo: detalhes.sexo,
              dataNascimento: detalhes.dataNascimento,
              ufNascimento: detalhes.ufNascimento,
              municipioNascimento: detalhes.municipioNascimento,
              escolaridade: detalhes.escolaridade,
              // Dados adicionais da API
              urlWebsite: detalhes.urlWebsite,
              dataFalecimento: detalhes.dataFalecimento,
              // Dados do status atual - CAMPOS CRÍTICOS
              nomeEleitoral: nomeEleitoral,
              situacao: situacao,
              condicaoEleitoral: condicaoEleitoral,
              descricaoStatus: detalhes.ultimoStatus?.descricaoStatus,
              email: detalhes.ultimoStatus?.email,
              // Dados do gabinete
              gabinete: detalhes.ultimoStatus?.gabinete ? {
                nome: detalhes.ultimoStatus.gabinete.nome,
                predio: detalhes.ultimoStatus.gabinete.predio,
                sala: detalhes.ultimoStatus.gabinete.sala,
                andar: detalhes.ultimoStatus.gabinete.andar,
                telefone: detalhes.ultimoStatus.gabinete.telefone,
                email: detalhes.ultimoStatus.gabinete.email
              } : null,
              // Redes sociais
              redeSocial: detalhes.redeSocial || []
            };
            
            // Log para confirmar enriquecimento dos campos críticos
            if (deputadoEnriquecido.nomeEleitoral && deputadoEnriquecido.situacao && deputadoEnriquecido.condicaoEleitoral) {
              this.context.logger.info(`✅ Deputado ${deputado.id} enriquecido com campos críticos`);
            } else {
              this.context.logger.warn(`⚠️ Deputado ${deputado.id} - Alguns campos críticos não encontrados`);
            }
            
            return deputadoEnriquecido;
          } else {
            this.context.logger.warn(`⚠️ Não foi possível obter detalhes para o deputado ${deputado.id}. Usando dados básicos.`);
            return deputado;
          }
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao enriquecer dados do deputado ${deputado.id}: ${error.message}`);
          return deputado; // Retorna o deputado original em caso de erro
        }
      });

      const resultadosLote = await Promise.all(promessas);
      deputadosEnriquecidos.push(...resultadosLote);

      const progresso = Math.min(20, (i / deputados.length) * 20);
      this.emitProgress(ProcessingStatus.EXTRAINDO, 10 + progresso, `${deputadosEnriquecidos.length}/${deputados.length} deputados enriquecidos`);
    }

    return deputadosEnriquecidos;
  }

  private async extractDespesasDeputados(deputados: DeputadoBasico[], modoAtualizacao = false): Promise<ExtractedData['despesasPorDeputado']> {
    const resultados: ExtractedData['despesasPorDeputado'] = [];
    const concorrencia = this.context.options.concorrencia || 2;
    this.context.logger.info(`🔄 Extraindo despesas com concorrência: ${concorrencia}`);
    for (let i = 0; i < deputados.length; i += concorrencia) {
      const lote = deputados.slice(i, i + concorrencia);
      const promessas = lote.map(async (deputado) => {
        try {
          const despesasResult = modoAtualizacao ? await this.extractDespesasIncremental(deputado.id) : await this.extractDespesasCompletas(deputado.id);
          this.incrementSucessos();
          return despesasResult;
        } catch (error: any) {
          this.context.logger.error(`❌ Erro ao extrair despesas do deputado ${deputado.id}: ${error.message}`);
          this.incrementFalhas();
          return { deputadoId: deputado.id, despesas: [], erro: error.message };
        }
      });
      const resultadosLote = await Promise.allSettled(promessas);
      resultadosLote.forEach((resultado) => {
        if (resultado.status === 'fulfilled') resultados.push(resultado.value);
      });
      const progresso = Math.min(90, 30 + (i / deputados.length) * 60);
      this.emitProgress(ProcessingStatus.EXTRAINDO, progresso, `${resultados.length}/${deputados.length} deputados processados`);
      if (i + concorrencia < deputados.length) await new Promise(resolve => setTimeout(resolve, etlConfig.camara.pauseBetweenRequests * 2));
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
      const baseParams: Record<string, any> = { ...endpointConfig.PARAMS, idLegislatura: legislatura.toString(), itens: String(etlConfig.camara.itemsPerPage || endpoints.REQUEST.DEFAULT_ITEMS_PER_PAGE) };
      if (ano) baseParams.ano = ano.toString();
      if (mes) baseParams.mes = mes.toString();
      const todasDespesas = await apiClient.getAllPages(endpoint, baseParams, { context: `Despesas do deputado ${deputadoId}`, maxPages: 1000 });
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
    const params: Record<string, any> = { ...endpointConfig.PARAMS, idLegislatura: legislatura.toString(), ano: ano.toString(), mes: mes.toString(), itens: String(etlConfig.camara.itemsPerPage || endpoints.REQUEST.DEFAULT_ITEMS_PER_PAGE) };
    return await apiClient.getAllPages(endpoint, params, { context: `Despesas ${ano}-${mes.toString().padStart(2, '0')} do deputado ${deputadoId}`, maxPages: 200 });
  }

  // =================================================================
  // TRANSFORMATION LOGIC (V3 Plus com Inteligência Investigativa)
  // =================================================================

  async transform(data: ExtractedData): Promise<TransformedData> {
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 10, 'Iniciando transformação inteligente');
    
    // Estruturas de dados para análise
    const deputadosMap = new Map(data.deputados.map(d => [d.id, d]));
    const fornecedoresAgregados = new Map<string, any>();
    const deputadosAgregados = new Map<string, any>();
    const despesasValidadas: DespesaOptimizada[] = [];
    const alertasDetectados: AlertaInvestigativo[] = [];

    this.context.logger.info('🧮 Iniciando agregação e análise investigativa...');

    // ETAPA 1: Agregação de dados brutos
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 20, 'Agregando dados por deputado e fornecedor');
    
    for (const dadosDeputado of data.despesasPorDeputado) {
      if (dadosDeputado.erro) continue;

      const deputadoInfo = deputadosMap.get(dadosDeputado.deputadoId);
      if (!deputadoInfo) continue;

      // Inicializar agregação do deputado
      if (!deputadosAgregados.has(deputadoInfo.id)) {
        deputadosAgregados.set(deputadoInfo.id, {
          info: deputadoInfo,
          totalGastos: 0,
          numeroTransacoes: 0,
          fornecedoresAtendidos: new Set<string>(),
          despesasPorTipo: new Map<string, number>(),
          gastosPorAno: new Map<number, number>(),
          gastosPorMes: new Map<string, number>(), // Novo: gastos por mês para análise temporal
          valoresTransacoes: [] as number[],
          alertasCount: 0,
          gastosFimMes: new Map<string, number>(), // 'ano-mes' -> total gasto nos últimos 5 dias
          transacoesFragmentacao: [] as any[], // Para detectar fragmentação
          valoresRedondos: { total: 0, redondos: 0 }, // Para detectar valores suspeitos
          transacoesAcimaLimite: [] as any[], // Transações que excedem limites CEAP
          padroesSuspeitos: [] as string[], // Lista de padrões detectados
          // NOVO: Estrutura otimizada para fornecedores relacionados
          fornecedoresRelacionados: new Map<string, {
            cnpj: string;
            nome: string;
            totalGasto: number;
            numeroTransacoes: number;
            categorias: Set<string>;
            primeiraTransacao: string;
            ultimaTransacao: string;
            maiorTransacao: number;
            menorTransacao: number;
            mediaTransacao: number;
            scoreRisco: number;
            alertas: string[];
          }>()
        });
      }

      const agregacaoDeputado = deputadosAgregados.get(deputadoInfo.id)!;

      for (const despesaBruta of dadosDeputado.despesas) {
        // Validação robusta da despesa
        if (!this.validarDespesa(despesaBruta)) {
          continue;
        }

        const valor = parseFloat(despesaBruta.valorLiquido) || 0;
        if (valor < CONFIG_INVESTIGATIVA.MIN_VALOR_TRANSACAO) continue;

        const cnpjFormatado = formatarCnpjCpf(despesaBruta.cnpjCpfFornecedor) || despesaBruta.cnpjCpfFornecedor;
        
        // Criar despesa otimizada
        const despesaOtimizada: DespesaOptimizada = {
          id: `${deputadoInfo.id}_${despesaBruta.ano}_${despesaBruta.mes}_${Date.now()}_${Math.random()}`,
          deputadoId: deputadoInfo.id,
          deputadoNome: deputadoInfo.nome,
          ano: despesaBruta.ano,
          mes: despesaBruta.mes,
          anoMes: `${despesaBruta.ano}-${String(despesaBruta.mes).padStart(2, '0')}`,
          tipoDespesa: despesaBruta.tipoDespesa || 'Não especificado',
          valorLiquido: valor,
          dataDocumento: Timestamp.fromDate(new Date(despesaBruta.dataDocumento)),
          nomeFornecedor: despesaBruta.nomeFornecedor || 'Nome não informado',
          cnpjCpfFornecedor: cnpjFormatado,
          partidoDeputado: deputadoInfo.siglaPartido,
          ufDeputado: deputadoInfo.siglaUf,
          indicadorSuspeicao: 'NORMAL',
          alertas: []
        };

        despesasValidadas.push(despesaOtimizada);

        // Agregação para deputado
        agregacaoDeputado.totalGastos += valor;
        agregacaoDeputado.numeroTransacoes += 1;
        agregacaoDeputado.fornecedoresAtendidos.add(cnpjFormatado);
        agregacaoDeputado.valoresTransacoes.push(valor);
        
        // Agregação por tipo de despesa
        const tipoAtual = agregacaoDeputado.despesasPorTipo.get(despesaOtimizada.tipoDespesa) || 0;
        agregacaoDeputado.despesasPorTipo.set(despesaOtimizada.tipoDespesa, tipoAtual + valor);
        
        // Agregação por ano
        const anoAtual = agregacaoDeputado.gastosPorAno.get(despesaBruta.ano) || 0;
        agregacaoDeputado.gastosPorAno.set(despesaBruta.ano, anoAtual + valor);
        
        // Agregação por mês (novo)
        const anoMesKey = `${despesaBruta.ano}-${String(despesaBruta.mes).padStart(2, '0')}`;
        const mesAtual = agregacaoDeputado.gastosPorMes.get(anoMesKey) || 0;
        agregacaoDeputado.gastosPorMes.set(anoMesKey, mesAtual + valor);

        // Análise temporal e padrões CEAP
        const dataDespesa = new Date(despesaBruta.dataDocumento);
        const ultimoDiaMes = new Date(dataDespesa.getFullYear(), dataDespesa.getMonth() + 1, 0).getDate();
        
        // 1. Gastos no fim do mês (padrão CEAP identificado)
        if (dataDespesa.getDate() >= ultimoDiaMes - 4) {
          const anoMesKey = `${dataDespesa.getFullYear()}-${String(dataDespesa.getMonth() + 1).padStart(2, '0')}`;
          const gastoFimMesAtual = agregacaoDeputado.gastosFimMes.get(anoMesKey) || 0;
          agregacaoDeputado.gastosFimMes.set(anoMesKey, gastoFimMesAtual + valor);
        }

        // 2. Detecção de fragmentação (transações "seguras")
        if (FRAGMENTATION_PRONE_CATEGORIES.includes(despesaOtimizada.tipoDespesa)) {
          if (valor >= 500 && valor <= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.FRAGMENTACAO_SUSPEITA) {
            agregacaoDeputado.transacoesFragmentacao.push({
              valor,
              data: dataDespesa,
              categoria: despesaOtimizada.tipoDespesa,
              fornecedor: cnpjFormatado
            });
          }
        }

        // 3. Análise de valores redondos suspeitos
        agregacaoDeputado.valoresRedondos.total++;
        if (valor % 1000 === 0 && valor >= 1000) {
          agregacaoDeputado.valoresRedondos.redondos++;
        }

        // 4. Transações que excedem limites CEAP
        if (despesaOtimizada.tipoDespesa === 'COMBUSTÍVEIS E LUBRIFICANTES' && valor > CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_COMBUSTIVEL * 0.8) {
          agregacaoDeputado.transacoesAcimaLimite.push({
            valor,
            categoria: despesaOtimizada.tipoDespesa,
            limite: CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_COMBUSTIVEL,
            percentual: (valor / CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_COMBUSTIVEL) * 100,
            data: dataDespesa,
            fornecedor: cnpjFormatado
          });
        }
        if (despesaOtimizada.tipoDespesa === 'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES' && valor > CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_LOCACAO_VEICULO * 0.8) {
          agregacaoDeputado.transacoesAcimaLimite.push({
            valor,
            categoria: despesaOtimizada.tipoDespesa,
            limite: CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_LOCACAO_VEICULO,
            percentual: (valor / CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_LOCACAO_VEICULO) * 100,
            data: dataDespesa,
            fornecedor: cnpjFormatado
          });
        }

        // NOVO: Agregação de fornecedores relacionados ao deputado
        if (cnpjFormatado && cnpjFormatado.length >= 11) {
          if (!agregacaoDeputado.fornecedoresRelacionados.has(cnpjFormatado)) {
            // Inicializar fornecedor para este deputado
            agregacaoDeputado.fornecedoresRelacionados.set(cnpjFormatado, {
              cnpj: cnpjFormatado,
              nome: despesaOtimizada.nomeFornecedor,
              totalGasto: 0,
              numeroTransacoes: 0,
              categorias: new Set<string>(),
              primeiraTransacao: despesaBruta.dataDocumento,
              ultimaTransacao: despesaBruta.dataDocumento,
              maiorTransacao: valor,
              menorTransacao: valor,
              mediaTransacao: 0,
              scoreRisco: 0,
              alertas: []
            });
          }

          const fornecedorRelacionado = agregacaoDeputado.fornecedoresRelacionados.get(cnpjFormatado)!;
          
          // Atualizar dados do fornecedor para este deputado
          fornecedorRelacionado.totalGasto += valor;
          fornecedorRelacionado.numeroTransacoes += 1;
          fornecedorRelacionado.categorias.add(despesaOtimizada.tipoDespesa);
          
          // Atualizar datas
          if (new Date(despesaBruta.dataDocumento) < new Date(fornecedorRelacionado.primeiraTransacao)) {
            fornecedorRelacionado.primeiraTransacao = despesaBruta.dataDocumento;
          }
          if (new Date(despesaBruta.dataDocumento) > new Date(fornecedorRelacionado.ultimaTransacao)) {
            fornecedorRelacionado.ultimaTransacao = despesaBruta.dataDocumento;
          }
          
          // Atualizar valores máximo e mínimo
          if (valor > fornecedorRelacionado.maiorTransacao) {
            fornecedorRelacionado.maiorTransacao = valor;
          }
          if (valor < fornecedorRelacionado.menorTransacao) {
            fornecedorRelacionado.menorTransacao = valor;
          }
          
          // Calcular média (será recalculada no final)
          fornecedorRelacionado.mediaTransacao = fornecedorRelacionado.totalGasto / fornecedorRelacionado.numeroTransacoes;
          
          // Detectar alertas básicos para este fornecedor
          if (valor > 50000) {
            if (!fornecedorRelacionado.alertas.includes('Transação acima de R$ 50k')) {
              fornecedorRelacionado.alertas.push('Transação acima de R$ 50k');
            }
          }
          if (fornecedorRelacionado.numeroTransacoes === 1 && valor > 20000) {
            if (!fornecedorRelacionado.alertas.includes('Primeira transação alta')) {
              fornecedorRelacionado.alertas.push('Primeira transação alta');
            }
          }
        }

        // Agregação para fornecedor
        if (cnpjFormatado && cnpjFormatado.length >= 11) {
          if (!fornecedoresAgregados.has(cnpjFormatado)) {
            fornecedoresAgregados.set(cnpjFormatado, {
              cnpj: cnpjFormatado,
              nome: despesaOtimizada.nomeFornecedor,
              totalRecebido: 0,
              numeroTransacoes: 0,
              deputadosAtendidos: new Set<string>(),
              deputadosPorValor: new Map<string, number>(),
              categoriasGasto: new Set<string>(),
              valoresTransacoes: [] as number[],
              transacoesPorAno: new Map<number, {valor: number, quantidade: number}>(),
              primeiraTransacao: despesaBruta.dataDocumento,
              ultimaTransacao: despesaBruta.dataDocumento,
              totalRecebidoServicosIntangiveis: 0,
              ufFornecedor: undefined,
              padroesLavaJato: [] as string[],
              // Novos campos para análise CEAP
              transacoesPorMes: new Map<string, {valor: number, quantidade: number}>(),
              valoresRedondos: { total: 0, redondos: 0 },
              transacoesProximasLimite: [] as any[]
            });
          }

          const fornecedor = fornecedoresAgregados.get(cnpjFormatado)!;
          fornecedor.totalRecebido += valor;
          if (HIGH_RISK_INTANGIBLE_CATEGORIES.includes(despesaOtimizada.tipoDespesa)) {
            fornecedor.totalRecebidoServicosIntangiveis += valor;
          }
          fornecedor.numeroTransacoes += 1;
          fornecedor.deputadosAtendidos.add(deputadoInfo.nome);
          fornecedor.categoriasGasto.add(despesaOtimizada.tipoDespesa);
          fornecedor.valoresTransacoes.push(valor);
          
          // Agregação por deputado dentro do fornecedor
          const valorDeputado = fornecedor.deputadosPorValor.get(deputadoInfo.id) || 0;
          fornecedor.deputadosPorValor.set(deputadoInfo.id, valorDeputado + valor);
          
          // Agregação por ano dentro do fornecedor
          const anoFornecedor = fornecedor.transacoesPorAno.get(despesaBruta.ano) || {valor: 0, quantidade: 0};
          anoFornecedor.valor += valor;
          anoFornecedor.quantidade += 1;
          fornecedor.transacoesPorAno.set(despesaBruta.ano, anoFornecedor);
          
          // Atualizar datas
          if (new Date(despesaBruta.dataDocumento) < new Date(fornecedor.primeiraTransacao)) {
            fornecedor.primeiraTransacao = despesaBruta.dataDocumento;
          }
          if (new Date(despesaBruta.dataDocumento) > new Date(fornecedor.ultimaTransacao)) {
            fornecedor.ultimaTransacao = despesaBruta.dataDocumento;
          }

          // Agregação temporal mensal para fornecedor
          const anoMesFornecedor = `${despesaBruta.ano}-${String(despesaBruta.mes).padStart(2, '0')}`;
          const transacaoMes = fornecedor.transacoesPorMes.get(anoMesFornecedor) || {valor: 0, quantidade: 0};
          transacaoMes.valor += valor;
          transacaoMes.quantidade += 1;
          fornecedor.transacoesPorMes.set(anoMesFornecedor, transacaoMes);

          // Análise de valores redondos
          fornecedor.valoresRedondos.total++;
          if (valor % 1000 === 0 && valor >= 1000) {
            fornecedor.valoresRedondos.redondos++;
          }

          // Detecção de transações próximas aos limites CEAP
          if (despesaOtimizada.tipoDespesa === 'COMBUSTÍVEIS E LUBRIFICANTES' && valor > CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_COMBUSTIVEL * 0.8) {
            fornecedor.transacoesProximasLimite.push({
              valor,
              categoria: despesaOtimizada.tipoDespesa,
              percentualLimite: (valor / CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_COMBUSTIVEL) * 100
            });
          }
          if (despesaOtimizada.tipoDespesa === 'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES' && valor > CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_LOCACAO_VEICULO * 0.8) {
            fornecedor.transacoesProximasLimite.push({
              valor,
              categoria: despesaOtimizada.tipoDespesa,
              percentualLimite: (valor / CONFIG_INVESTIGATIVA.COTAS_CEAP.LIMITE_LOCACAO_VEICULO) * 100
            });
          }
        }
      }
    }

    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 40, 'Calculando scores investigativos');

    // ETAPA 2: Cálculo de scores e detecção de alertas
    const deputadosOtimizados = this.calcularScoresDeputados(deputadosAgregados);
    const fornecedoresOtimizados = this.calcularScoresFornecedores(fornecedoresAgregados, deputadosAgregados);
    
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 60, 'Gerando rankings e estatísticas');
    
    // ETAPA 3: Geração de rankings
    const rankings = this.gerarRankings(deputadosOtimizados, fornecedoresOtimizados);
    
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 80, 'Calculando estatísticas globais');
    
    // ETAPA 4: Estatísticas globais
    const estatisticas = this.calcularEstatisticasGlobais(deputadosOtimizados, fornecedoresOtimizados, despesasValidadas);
    
    this.emitProgress(ProcessingStatus.TRANSFORMANDO, 90, 'Transformação inteligente concluída');
    
    this.context.logger.info(`✅ Transformação concluída:`);
    this.context.logger.info(`   📊 ${deputadosOtimizados.length} deputados processados`);
    this.context.logger.info(`   🏢 ${fornecedoresOtimizados.length} fornecedores agregados`);
    this.context.logger.info(`   💰 ${despesasValidadas.length} despesas validadas`);
    this.context.logger.info(`   🚨 ${alertasDetectados.length} alertas detectados`);
    this.context.logger.info(`   📈 ${rankings.length} rankings gerados`);

    return {
      deputados: deputadosOtimizados,
      despesas: despesasValidadas,
      fornecedores: fornecedoresOtimizados,
      rankings,
      alertas: alertasDetectados,
      estatisticas
    };
  }

  private validarDespesa(despesa: any): boolean {
    return !!(despesa.ano && despesa.mes && despesa.dataDocumento && despesa.valorLiquido);
  }

  private calcularScoresDeputados(deputadosAgregados: Map<string, any>): DeputadoOptimizado[] {
    const deputados: DeputadoOptimizado[] = [];
    
    for (const [id, agregacao] of deputadosAgregados) {
      const valores = agregacao.valoresTransacoes.sort((a: number, b: number) => a - b);
      const mediaGastos = agregacao.totalGastos / agregacao.numeroTransacoes;
      const valorMaximo = valores[valores.length - 1] || 0;
      const valorMediano = valores[Math.floor(valores.length / 2)] || 0;
      
      // Score investigativo unificado para deputado (0-100) - Metodologia Lava Jato + CEAP
      let scoreInvestigativo = 0;
      const padroesSuspeitos = agregacao.padroesSuspeitos;
      
      // === CRITÉRIOS LAVA JATO (MANTIDOS E APRIMORADOS) ===
      
      // 1. Gastos muito altos (25 pontos)
      if (agregacao.totalGastos > 500000) {
        scoreInvestigativo += 25;
        padroesSuspeitos.push(`Volume total crítico: R$ ${agregacao.totalGastos.toLocaleString()}`);
      } else if (agregacao.totalGastos > 300000) {
        scoreInvestigativo += 12;
        padroesSuspeitos.push(`Volume total elevado: R$ ${agregacao.totalGastos.toLocaleString()}`);
      }
      
      // 2. Concentração em poucos fornecedores (20 pontos)
      const ratioFornecedores = agregacao.totalGastos / agregacao.fornecedoresAtendidos.size;
      if (ratioFornecedores > 100000) {
        scoreInvestigativo += 20;
        padroesSuspeitos.push(`Alta concentração: R$ ${ratioFornecedores.toLocaleString()} por fornecedor`);
      } else if (ratioFornecedores > 50000) {
        scoreInvestigativo += 10;
        padroesSuspeitos.push(`Concentração moderada: R$ ${ratioFornecedores.toLocaleString()} por fornecedor`);
      }
      
      // 3. Transações de valor muito alto (15 pontos)
      if (valorMaximo > 50000) {
        scoreInvestigativo += 15;
        padroesSuspeitos.push(`Transação crítica: R$ ${valorMaximo.toLocaleString()}`);
      } else if (valorMaximo > 30000) {
        scoreInvestigativo += 8;
        padroesSuspeitos.push(`Transação elevada: R$ ${valorMaximo.toLocaleString()}`);
      }
      
      // 4. Diversificação de despesas (10 pontos)
      if (agregacao.despesasPorTipo.size <= 2) {
        scoreInvestigativo += 10;
        padroesSuspeitos.push(`Baixa diversificação: apenas ${agregacao.despesasPorTipo.size} tipos de despesa`);
      } else if (agregacao.despesasPorTipo.size <= 4) {
        scoreInvestigativo += 5;
      }

      // === NOVOS CRITÉRIOS CEAP (BASEADOS NA PESQUISA) ===
      
      // 5. Concentração suspeita no fim do mês (15 pontos)
      for (const [anoMesKey, gastoFimMes] of agregacao.gastosFimMes.entries()) {
        const gastoMesTotal = agregacao.gastosPorMes.get(anoMesKey) || 0;
        const percentualGastoFimMes = gastoMesTotal > 0 ? (gastoFimMes / gastoMesTotal) * 100 : 0;

        if (percentualGastoFimMes >= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.PERCENTUAL_FIM_MES_SUSPEITO && gastoFimMes > 5000) {
          scoreInvestigativo += 15;
          padroesSuspeitos.push(`Concentração fim de mês ${anoMesKey}: ${percentualGastoFimMes.toFixed(1)}% (R$ ${gastoFimMes.toLocaleString()})`);
        }
      }

      // 6. Fragmentação para fugir de limites (20 pontos)
      if (agregacao.transacoesFragmentacao.length >= 10) {
        const totalFragmentado = agregacao.transacoesFragmentacao.reduce((sum: number, t: any) => sum + t.valor, 0);
        if (totalFragmentado > 15000) {
          scoreInvestigativo += 20;
          padroesSuspeitos.push(`Fragmentação suspeita: ${agregacao.transacoesFragmentacao.length} transações "seguras" = R$ ${totalFragmentado.toLocaleString()}`);
        }
      }

      // 7. Excesso de valores redondos (10 pontos)
      if (agregacao.valoresRedondos.total > 0) {
        const percentualRedondos = (agregacao.valoresRedondos.redondos / agregacao.valoresRedondos.total) * 100;
        if (percentualRedondos > CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.PERCENTUAL_VALORES_REDONDOS) {
          scoreInvestigativo += 10;
          padroesSuspeitos.push(`Excesso de valores redondos: ${percentualRedondos.toFixed(1)}%`);
        }
      }

      // 8. Transações acima dos limites CEAP (15 pontos)
      if (agregacao.transacoesAcimaLimite.length > 0) {
        const transacoesCriticas = agregacao.transacoesAcimaLimite.filter((t: any) => t.percentual > 100).length;
        const transacoesProximas = agregacao.transacoesAcimaLimite.filter((t: any) => t.percentual > 90 && t.percentual <= 100).length;
        
        if (transacoesCriticas > 0) {
          scoreInvestigativo += 15;
          padroesSuspeitos.push(`${transacoesCriticas} transações excedem limites CEAP`);
        } else if (transacoesProximas >= 3) {
          scoreInvestigativo += 8;
          padroesSuspeitos.push(`${transacoesProximas} transações próximas aos limites CEAP`);
        }
      }

      // 9. Gastos mensais excedem cota máxima (15 pontos)
      let mesesAcimaLimite = 0;
      for (const [_, gastoMes] of agregacao.gastosPorMes.entries()) {
        if (gastoMes > CONFIG_INVESTIGATIVA.COTAS_CEAP.VALOR_MAXIMO_MENSAL_SP) {
          mesesAcimaLimite++;
        }
      }
      if (mesesAcimaLimite > 0) {
        scoreInvestigativo += Math.min(15, mesesAcimaLimite * 3);
        padroesSuspeitos.push(`${mesesAcimaLimite} meses excedem cota máxima`);
      }

      // 10. Alto percentual em serviços intangíveis (10 pontos)
      let gastoIntangiveis = 0;
      for (const [categoria, valor] of agregacao.despesasPorTipo.entries()) {
        if (HIGH_RISK_INTANGIBLE_CATEGORIES.includes(categoria)) {
          gastoIntangiveis += valor;
        }
      }
      const percentualIntangiveis = (gastoIntangiveis / agregacao.totalGastos) * 100;
      if (percentualIntangiveis > 60 && gastoIntangiveis > 50000) {
        scoreInvestigativo += 10;
        padroesSuspeitos.push(`Alto percentual em serviços intangíveis: ${percentualIntangiveis.toFixed(1)}%`);
      }
      
      scoreInvestigativo = Math.min(scoreInvestigativo, 100);
      
      // Classificação final baseada na metodologia unificada
      const indicadorConformidade = scoreInvestigativo >= 80 ? 'ORGANIZAÇÃO_CRIMINOSA' :
                                   scoreInvestigativo >= 60 ? 'ALTO_RISCO' :
                                   scoreInvestigativo >= 40 ? 'SUSPEITO' : 'NORMAL';
      
      deputados.push({
        id,
        nome: agregacao.info.nome,
        nomeCivil: agregacao.info.nomeCivil,
        siglaPartido: agregacao.info.siglaPartido,
        siglaUf: agregacao.info.siglaUf,
        urlFoto: agregacao.info.urlFoto || '',
        cpf: agregacao.info.cpf,
        dataNascimento: agregacao.info.dataNascimento,
        dataFalecimento: agregacao.info.dataFalecimento,
        sexo: agregacao.info.sexo,
        escolaridade: agregacao.info.escolaridade,
        ufNascimento: agregacao.info.ufNascimento,
        municipioNascimento: agregacao.info.municipioNascimento,
        urlWebsite: agregacao.info.urlWebsite,
        
        // CAMPOS CRÍTICOS - Adicionados aqui!
        nomeEleitoral: agregacao.info.nomeEleitoral,
        situacao: agregacao.info.situacao,
        condicaoEleitoral: agregacao.info.condicaoEleitoral,
        descricaoStatus: agregacao.info.descricaoStatus,
        email: agregacao.info.email,
        gabinete: agregacao.info.gabinete,
        redeSocial: agregacao.info.redeSocial,
        totalGastos: Math.round(agregacao.totalGastos * 100) / 100,
        totalGastos2024: Math.round((agregacao.gastosPorAno.get(2024) || 0) * 100) / 100,
        totalGastos2023: Math.round((agregacao.gastosPorAno.get(2023) || 0) * 100) / 100,
        mediaGastosMensal: Math.round(mediaGastos * 100) / 100,
        scoreInvestigativo: Math.round(scoreInvestigativo),
        posicaoRanking: 0, // Será calculado no ranking
        posicaoRankingUF: 0, // Será calculado no ranking
        numeroAlertas: 0, // Será calculado baseado nos alertas
        indicadorConformidade,
        numeroTransacoes: agregacao.numeroTransacoes,
        numeroFornecedores: agregacao.fornecedoresAtendidos.size,
        maiorTransacao: valorMaximo,
        menorTransacao: valores[0] || 0,
        medianaTransacao: valorMediano,
        gastosFimMes: Object.fromEntries(agregacao.gastosFimMes),
        gastosPorMes: Object.fromEntries(agregacao.gastosPorMes),
        padroesSuspeitos: padroesSuspeitos,
        transacoesFragmentacao: agregacao.transacoesFragmentacao.length,
        valoresRedondosPercentual: agregacao.valoresRedondos.total > 0 ? 
          Math.round((agregacao.valoresRedondos.redondos / agregacao.valoresRedondos.total) * 100) : 0,
        transacoesAcimaLimite: agregacao.transacoesAcimaLimite.length,
        // NOVO: Fornecedores relacionados ao deputado (otimização para busca)
        fornecedoresRelacionados: (() => {
          const fornecedoresArray: Array<{
            cnpj: string;
            nome: string;
            totalGasto: number;
            numeroTransacoes: number;
            categorias: string[];
            primeiraTransacao: string;
            ultimaTransacao: string;
            maiorTransacao: number;
            menorTransacao: number;
            mediaTransacao: number;
            scoreRisco: number;
            alertas: string[];
          }> = [];
          
          for (const [_, dados] of Array.from((agregacao.fornecedoresRelacionados as Map<string, any>).entries())) {
            fornecedoresArray.push({
              cnpj: dados.cnpj as string,
              nome: dados.nome as string,
              totalGasto: Math.round(dados.totalGasto * 100) / 100,
              numeroTransacoes: dados.numeroTransacoes as number,
              categorias: Array.from(dados.categorias as Set<string>),
              primeiraTransacao: dados.primeiraTransacao as string,
              ultimaTransacao: dados.ultimaTransacao as string,
              maiorTransacao: dados.maiorTransacao as number,
              menorTransacao: dados.menorTransacao as number,
              mediaTransacao: Math.round(dados.mediaTransacao * 100) / 100,
              scoreRisco: this.calcularScoreRiscoFornecedor(dados),
              alertas: dados.alertas as string[]
            });
          }
          return fornecedoresArray.sort((a, b) => b.totalGasto - a.totalGasto); // Ordenar por maior gasto
        })(),
        ultimaAtualizacao: Timestamp.now()
      });
    }
    
    return deputados.sort((a, b) => b.totalGastos - a.totalGastos);
  }

  private calcularScoresFornecedores(fornecedoresAgregados: Map<string, any>, deputadosAgregados: Map<string, any>): any[] {
    const fornecedores: any[] = [];
    
    for (const [cnpj, fornecedor] of fornecedoresAgregados) {
      const numDeputados = fornecedor.deputadosAtendidos.size;
      const numTransacoes = fornecedor.numeroTransacoes;
      const volumeTotal = fornecedor.totalRecebido;
      const mediaTransacao = volumeTotal / numTransacoes;
      
      // Score investigativo baseado na metodologia Lava Jato (0-100)
      let scoreInvestigativo = 0;
      
      
      // 1. Concentração de deputados (40 pontos máximo)
      if (numDeputados <= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.POUCOS_DEPUTADOS_CRITICO) {
        scoreInvestigativo += 40;
      } else if (numDeputados <= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.POUCOS_DEPUTADOS_MEDIO) {
        scoreInvestigativo += 20;
      }
      
      // 2. Valor médio por transação (30 pontos máximo)
      if (mediaTransacao >= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.VALOR_MUITO_ALTO) {
        scoreInvestigativo += 30;
      } else if (mediaTransacao >= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.VALOR_ALTO_TRANSACAO) {
        scoreInvestigativo += 15;
      }
      
      // 3. Volume alto com concentração (30 pontos máximo)
      if (volumeTotal >= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.VOLUME_ALTO_CONCENTRADO && numDeputados <= 3) {
        scoreInvestigativo += 30;
      } else if (volumeTotal >= CONFIG_INVESTIGATIVA.SCORE_THRESHOLDS.VOLUME_ALTO_CONCENTRADO) {
        scoreInvestigativo += 15;
      }

      // 4. Detecção de "Empresa de Papel" (Serviços Intangíveis) - Aprimorado
      const percentualServicosIntangiveis = volumeTotal > 0 ? (fornecedor.totalRecebidoServicosIntangiveis / volumeTotal) * 100 : 0;
      if (percentualServicosIntangiveis >= 80 && volumeTotal > 50000) {
        scoreInvestigativo += 25;
        fornecedor.padroesLavaJato.push(`Empresa de papel: ${percentualServicosIntangiveis.toFixed(1)}% serviços intangíveis`);
      }

      // 5. Análise de valores redondos suspeitos
      if (fornecedor.valoresRedondos.total > 0) {
        const percentualRedondos = (fornecedor.valoresRedondos.redondos / fornecedor.valoresRedondos.total) * 100;
        if (percentualRedondos > 50 && fornecedor.valoresRedondos.total >= 10) {
          scoreInvestigativo += 15;
          fornecedor.padroesLavaJato.push(`Excesso de valores redondos: ${percentualRedondos.toFixed(1)}%`);
        }
      }

      // 6. Transações próximas aos limites CEAP
      if (fornecedor.transacoesProximasLimite.length > 0) {
        const transacoesAcima90Porcento = fornecedor.transacoesProximasLimite.filter((t: any) => t.percentualLimite > 90).length;
        if (transacoesAcima90Porcento >= 3) {
          scoreInvestigativo += 20;
          fornecedor.padroesLavaJato.push(`${transacoesAcima90Porcento} transações próximas aos limites CEAP`);
        }
      }

      // 7. Concentração temporal suspeita
      const mesesAtivos = fornecedor.transacoesPorMes.size;
      const mesesComAltoVolume = Array.from(fornecedor.transacoesPorMes.values()).filter((mes: any) => mes.valor > 20000).length;
      if (mesesComAltoVolume > 0 && mesesAtivos <= 3 && volumeTotal > 100000) {
        scoreInvestigativo += 15;
        fornecedor.padroesLavaJato.push(`Concentração temporal: R$ ${volumeTotal.toLocaleString()} em ${mesesAtivos} meses`);
      }
      
      scoreInvestigativo = Math.min(scoreInvestigativo, 100);
      
      // Categorização de risco
      const categoriaRisco = scoreInvestigativo >= 80 ? 'ORGANIZACAO_CRIMINOSA' :
                            scoreInvestigativo >= 60 ? 'ALTO_RISCO' :
                            scoreInvestigativo >= 30 ? 'SUSPEITO' : 'NORMAL';
      
      
      // Padrões clássicos Lava Jato
      if (numDeputados === 1 && volumeTotal > 50000) {
        fornecedor.padroesLavaJato.push(`Fornecedor exclusivo: R$ ${volumeTotal.toLocaleString()}`);
      }
      if (mediaTransacao > 50000) {
        fornecedor.padroesLavaJato.push(`Superfaturamento: média R$ ${mediaTransacao.toLocaleString()}`);
      }
      if (volumeTotal > 500000 && numDeputados <= 3) {
        fornecedor.padroesLavaJato.push(`Concentração crítica: R$ ${volumeTotal.toLocaleString()} em ${numDeputados} deputados`);
      }
      if (numTransacoes < 5 && volumeTotal > 100000) {
        fornecedor.padroesLavaJato.push(`Alto valor/poucas transações: ${numTransacoes} transações = R$ ${volumeTotal.toLocaleString()}`);
      }

      // 8. Detecção de "Fornecedor Local Suspeito" (CEAP) - Aprimorado
      const topDeputadoEntry = Array.from((fornecedor.deputadosPorValor as Map<string, number>).entries()).sort((a, b) => b[1] - a[1])[0];
      const topDeputadoInfo = topDeputadoEntry ? deputadosAgregados.get(topDeputadoEntry[0])?.info : null;

      if (fornecedor.ufFornecedor && topDeputadoInfo?.siglaUf && fornecedor.ufFornecedor !== topDeputadoInfo.siglaUf) {
        const isLocalServiceSupplier = Array.from(fornecedor.categoriasGasto as Set<string>).some((cat: string) => LOCAL_SERVICE_CATEGORIES.includes(cat));
        
        if (isLocalServiceSupplier && volumeTotal > 10000) {
          const categoriasLocais = Array.from(fornecedor.categoriasGasto as Set<string>).filter((cat: string) => LOCAL_SERVICE_CATEGORIES.includes(cat));
          const percentualLocalService = (categoriasLocais.length / (fornecedor.categoriasGasto as Set<string>).size) * 100;
          scoreInvestigativo += Math.min(20, Math.round(percentualLocalService / 5));
          fornecedor.padroesLavaJato.push(`Fornecedor local suspeito: UF ${fornecedor.ufFornecedor} ≠ deputado UF ${topDeputadoInfo.siglaUf} (${percentualLocalService.toFixed(1)}% serviços locais)`);
        }
      }

      // 9. Detecção de padrão "Máfia das Ambulâncias" - valores padronizados
      if (numDeputados >= 5) {
        const valoresPorDeputado = Array.from((fornecedor.deputadosPorValor as Map<string, number>).values());
        const valoresArredondados = valoresPorDeputado.map((v: number) => Math.round(v / 1000) * 1000);
        const valoresUnicos = new Set(valoresArredondados);
        
        if (valoresUnicos.size < numDeputados * 0.5) {
          scoreInvestigativo += 25;
          fornecedor.padroesLavaJato.push(`Padrão "Máfia das Ambulâncias": ${numDeputados} deputados com valores padronizados`);
        }
      }
      
      // Top deputados por valor
      const entries = Array.from(fornecedor.deputadosPorValor.entries()) as [string, number][];
      const deputadosTop = entries
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((entry) => ({ 
          nome: deputadosAgregados.get(entry[0])?.info?.nome || entry[0], 
          valor: Math.round(entry[1] * 100) / 100 
        }));
      
      fornecedores.push({
        cnpj,
        nome: fornecedor.nome,
        totalRecebido: Math.round(volumeTotal * 100) / 100,
        totalRecebidoServicosIntangiveis: Math.round(fornecedor.totalRecebidoServicosIntangiveis * 100) / 100,
        numeroTransacoes: numTransacoes,
        numeroDeputados: numDeputados,
        scoreInvestigativo: Math.round(scoreInvestigativo),
        categoriaRisco,
        padroesLavaJato: fornecedor.padroesLavaJato,
        posicaoRankingGeral: 0, // Será calculado no ranking
        deputadosTop: deputadosTop as { nome: string; valor: number; }[],
        mediaTransacao: Math.round(mediaTransacao * 100) / 100,
        maiorTransacao: Math.max(...fornecedor.valoresTransacoes),
        menorTransacao: Math.min(...fornecedor.valoresTransacoes),
        categoriasAtendidas: Array.from(fornecedor.categoriasGasto),
        ufFornecedor: fornecedor.ufFornecedor,
        valoresRedondosPercentual: fornecedor.valoresRedondos.total > 0 ? 
          Math.round((fornecedor.valoresRedondos.redondos / fornecedor.valoresRedondos.total) * 100) : 0,
        transacoesProximasLimiteCount: fornecedor.transacoesProximasLimite.length,
        mesesAtivos: fornecedor.transacoesPorMes.size,
        ultimaAtualizacao: Timestamp.now()
      });
    }
    
    return fornecedores.sort((a, b) => b.totalRecebido - a.totalRecebido);
  }

  private gerarRankings(deputados: DeputadoOptimizado[], fornecedores: any[]): RankingOptimizado[] {
    const rankings: RankingOptimizado[] = [];
    
    // Ranking geral de deputados por gastos
    const rankingDeputadosGeral: RankingOptimizado = {
      id: 'deputados_gastos_geral',
      tipo: 'deputados',
      subtipo: 'gastos_totais',
      periodo: '2024',
      ranking: deputados.slice(0, 100).map((dep, index) => {
        dep.posicaoRanking = index + 1;
        return {
          posicao: index + 1,
          id: dep.id,
          nome: dep.nome,
          valor: dep.totalGastos,
          metadados: {
            partido: dep.siglaPartido,
            uf: dep.siglaUf,
            score: dep.scoreInvestigativo
          }
        };
      }),
      totalItens: deputados.length,
      ultimaAtualizacao: Timestamp.now()
    };
    rankings.push(rankingDeputadosGeral);
    
    // Ranking por suspeição
    const deputadosSuspeitos = deputados
      .filter(d => d.scoreInvestigativo >= 30)
      .sort((a, b) => b.scoreInvestigativo - a.scoreInvestigativo);
    
    const rankingSuspeicaoDeputados: RankingOptimizado = {
      id: 'deputados_suspeicao',
      tipo: 'deputados',
      subtipo: 'score_investigativo',
      periodo: '2024',
      ranking: deputadosSuspeitos.slice(0, 50).map((dep, index) => ({
        posicao: index + 1,
        id: dep.id,
        nome: dep.nome,
        valor: dep.scoreInvestigativo,
        metadados: {
          totalGastos: dep.totalGastos,
          partido: dep.siglaPartido,
          uf: dep.siglaUf,
          indicador: dep.indicadorConformidade
        }
      })),
      totalItens: deputadosSuspeitos.length,
      ultimaAtualizacao: Timestamp.now()
    };
    rankings.push(rankingSuspeicaoDeputados);
    
    // Ranking de fornecedores por volume
    const rankingFornecedoresVolume: RankingOptimizado = {
      id: 'fornecedores_volume',
      tipo: 'fornecedores',
      subtipo: 'total_recebido',
      periodo: '2024',
      ranking: fornecedores.slice(0, 100).map((forn, index) => {
        forn.posicaoRankingGeral = index + 1;
        return {
          posicao: index + 1,
          id: forn.cnpj,
          nome: forn.nome,
          valor: forn.totalRecebido,
          metadados: {
            score: forn.scoreInvestigativo,
            categoria: forn.categoriaRisco,
            deputados: forn.numeroDeputados
          }
        };
      }),
      totalItens: fornecedores.length,
      ultimaAtualizacao: Timestamp.now()
    };
    rankings.push(rankingFornecedoresVolume);
    
    // Ranking de fornecedores suspeitos
    const fornecedoresSuspeitos = fornecedores
      .filter(f => f.scoreInvestigativo >= 30)
      .sort((a, b) => b.scoreInvestigativo - a.scoreInvestigativo);
    
    const rankingSuspeicaoFornecedores: RankingOptimizado = {
      id: 'fornecedores_suspeicao',
      tipo: 'fornecedores',
      subtipo: 'score_investigativo',
      periodo: '2024',
      ranking: fornecedoresSuspeitos.slice(0, 100).map((forn, index) => ({
        posicao: index + 1,
        id: forn.cnpj,
        nome: forn.nome,
        valor: forn.scoreInvestigativo,
        metadados: {
          totalRecebido: forn.totalRecebido,
          categoria: forn.categoriaRisco,
          padroes: forn.padroesLavaJato.join(', ')
        }
      })),
      totalItens: fornecedoresSuspeitos.length,
      ultimaAtualizacao: Timestamp.now()
    };
    rankings.push(rankingSuspeicaoFornecedores);
    
    return rankings;
  }

  private calcularEstatisticasGlobais(
    deputados: DeputadoOptimizado[], 
    fornecedores: any[], 
    despesas: DespesaOptimizada[]
  ): EstatisticasGlobais {
    const volumeTotal = deputados.reduce((sum, d) => sum + d.totalGastos, 0);
    const transacoesTotais = deputados.reduce((sum, d) => sum + d.numeroTransacoes, 0);
    
    return {
      id: 'estatisticas_2024',
      periodo: '2024',
      totalDeputados: deputados.length,
      totalFornecedores: fornecedores.length,
      totalDespesas: despesas.length,
      volumeTotal: Math.round(volumeTotal * 100) / 100,
      volumeMedio: Math.round((volumeTotal / deputados.length) * 100) / 100,
      transacoesTotais,
      deputadosSuspeitos: deputados.filter(d => d.scoreInvestigativo >= 50).length,
      deputadosCriticos: deputados.filter(d => d.scoreInvestigativo >= 70).length,
      fornecedoresSuspeitos: fornecedores.filter(f => f.scoreInvestigativo >= 50).length,
      fornecedoresCriticos: fornecedores.filter(f => f.scoreInvestigativo >= 80).length,
      maiorGastoDeputado: Math.max(...deputados.map(d => d.totalGastos)),
      menorGastoDeputado: Math.min(...deputados.map(d => d.totalGastos)),
      mediaGastoDeputado: volumeTotal / deputados.length,
      ultimaAtualizacao: Timestamp.now()
    };
  }

  // =================================================================
  // LOAD LOGIC (V3 Plus - Estrutura Otimizada Completa)
  // =================================================================

  async load(data: TransformedData): Promise<ETLResult> {
    this.emitProgress(ProcessingStatus.CARREGANDO, 10, 'Iniciando carregamento da estrutura otimizada');
    const batchManager = await createBatchManager();
    const startTime = Date.now();

    this.context.logger.info('💾 Salvando na estrutura otimizada do Firestore...');
    
    // Preparar agrupamento de despesas por deputado
    const despesasPorDeputado = new Map<string, DespesaOptimizada[]>();
    for (const despesa of data.despesas) {
        if (!despesasPorDeputado.has(despesa.deputadoId)) {
            despesasPorDeputado.set(despesa.deputadoId, []);
        }
        despesasPorDeputado.get(despesa.deputadoId)!.push(despesa);
    }

    // 1. Carregar Fornecedores com métricas investigativas
    this.emitProgress(ProcessingStatus.CARREGANDO, 15, `Salvando ${data.fornecedores.length} fornecedores`);
    for (const fornecedor of data.fornecedores) {
        const docId = fornecedor.cnpj.replace(/\D/g, '');
        const docRef = `fornecedores/${docId}`;
        await batchManager.set(docRef, fornecedor, { merge: true });
    }

    // 2. (Deputados serão salvos apenas na coleção despesas)

    // 3. Carregar Despesas organizadas por deputado (estrutura: despesas/{idDeputado})
    this.emitProgress(ProcessingStatus.CARREGANDO, 45, `Salvando despesas organizadas por deputado na coleção despesas`);
    
    // Criar documento para cada deputado na coleção despesas (com paginação)
    for (const [deputadoId, despesasDeputado] of despesasPorDeputado) {
        const deputadoInfo = data.deputados.find(d => d.id === deputadoId);
        if (!deputadoInfo) continue;
        
        // Verificar campos críticos antes de salvar
        if (deputadoInfo.nomeEleitoral && deputadoInfo.situacao && deputadoInfo.condicaoEleitoral) {
          this.context.logger.info(`💾 Salvando deputado ${deputadoId} com dados completos`);
        } else {
          this.context.logger.warn(`⚠️ Deputado ${deputadoId} com dados incompletos sendo salvo`);
        }
        
        // Dados do deputado (sempre os mesmos)
        const dadosDeputado = {
            id: deputadoInfo.id,
            nome: deputadoInfo.nome,
            nomeCivil: deputadoInfo.nomeCivil,
            siglaPartido: deputadoInfo.siglaPartido,
            siglaUf: deputadoInfo.siglaUf,
            urlFoto: deputadoInfo.urlFoto,
            
            // Dados pessoais
            cpf: deputadoInfo.cpf,
            dataNascimento: deputadoInfo.dataNascimento,
            dataFalecimento: deputadoInfo.dataFalecimento,
            sexo: deputadoInfo.sexo,
            escolaridade: deputadoInfo.escolaridade,
            ufNascimento: deputadoInfo.ufNascimento,
            municipioNascimento: deputadoInfo.municipioNascimento,
            urlWebsite: deputadoInfo.urlWebsite,
            
            // Status atual
            nomeEleitoral: deputadoInfo.nomeEleitoral,
            situacao: deputadoInfo.situacao,
            condicaoEleitoral: deputadoInfo.condicaoEleitoral,
            descricaoStatus: deputadoInfo.descricaoStatus,
            email: deputadoInfo.email,
            
            // Gabinete
            gabinete: deputadoInfo.gabinete,
            
            // Redes sociais
            redeSocial: deputadoInfo.redeSocial,
            
            // Métricas calculadas
            totalGastos: deputadoInfo.totalGastos,
            totalGastos2024: deputadoInfo.totalGastos2024,
            totalGastos2023: deputadoInfo.totalGastos2023,
            mediaGastosMensal: deputadoInfo.mediaGastosMensal,
            scoreInvestigativo: deputadoInfo.scoreInvestigativo,
            indicadorConformidade: deputadoInfo.indicadorConformidade,
            numeroTransacoes: deputadoInfo.numeroTransacoes,
            numeroFornecedores: deputadoInfo.numeroFornecedores,
            posicaoRanking: deputadoInfo.posicaoRanking,
            posicaoRankingUF: deputadoInfo.posicaoRankingUF,
            numeroAlertas: deputadoInfo.numeroAlertas,
            maiorTransacao: deputadoInfo.maiorTransacao,
            menorTransacao: deputadoInfo.menorTransacao,
            medianaTransacao: deputadoInfo.medianaTransacao,
            gastosFimMes: deputadoInfo.gastosFimMes,
            gastosPorMes: deputadoInfo.gastosPorMes,
            padroesSuspeitos: deputadoInfo.padroesSuspeitos,
            transacoesFragmentacao: deputadoInfo.transacoesFragmentacao,
            valoresRedondosPercentual: deputadoInfo.valoresRedondosPercentual,
            transacoesAcimaLimite: deputadoInfo.transacoesAcimaLimite,
            ultimaAtualizacao: deputadoInfo.ultimaAtualizacao
        };
        
        // Estratégia de paginação para evitar limite de 1MB
        const DESPESAS_POR_PAGINA = 800; // Limite conservador para evitar 1MB
        const totalPaginas = Math.ceil(despesasDeputado.length / DESPESAS_POR_PAGINA);
        
        if (totalPaginas === 1) {
            // Documento simples - todas as despesas cabem em um documento
            const documentoDespesas = {
                deputado: dadosDeputado,
                despesas: despesasDeputado,
                totalDespesas: despesasDeputado.length,
                totalPaginas: 1,
                ultimaAtualizacao: Timestamp.now()
            };
            
            const docRef = `despesas/${deputadoId}`;
            await batchManager.set(docRef, documentoDespesas, { merge: true });
        } else {
            // Múltiplos documentos - paginar despesas
            this.context.logger.info(`📄 Deputado ${deputadoId} tem ${despesasDeputado.length} despesas - dividindo em ${totalPaginas} páginas`);
            
            for (let pagina = 0; pagina < totalPaginas; pagina++) {
                const inicio = pagina * DESPESAS_POR_PAGINA;
                const fim = Math.min(inicio + DESPESAS_POR_PAGINA, despesasDeputado.length);
                const despesasPagina = despesasDeputado.slice(inicio, fim);
                
                if (pagina === 0) {
                    // Primeira página - documento principal com dados do deputado
                    const documentoPrincipal = {
                        deputado: dadosDeputado,
                        despesas: despesasPagina,
                        totalDespesas: despesasDeputado.length,
                        totalPaginas: totalPaginas,
                        paginaAtual: 1,
                        ultimaAtualizacao: Timestamp.now()
                    };
                    
                    const docRef = `despesas/${deputadoId}`;
                    await batchManager.set(docRef, documentoPrincipal, { merge: true });
                } else {
                    // Páginas adicionais - só despesas
                    const documentoPagina = {
                        despesas: despesasPagina,
                        paginaNumero: pagina + 1,
                        totalPaginas: totalPaginas,
                        deputadoId: deputadoId,
                        ultimaAtualizacao: Timestamp.now()
                    };
                    
                    const docRef = `despesas/${deputadoId}_pagina_${pagina + 1}`;
                    await batchManager.set(docRef, documentoPagina);
                }
            }
        }
    }

    // 4. Salvar Fornecedores relacionados por deputado
    this.emitProgress(ProcessingStatus.CARREGANDO, 55, 'Salvando fornecedores por deputado');
    
    for (const deputado of data.deputados) {
        // Salvar cada fornecedor relacionado como subdocumento
        if (deputado.fornecedoresRelacionados && deputado.fornecedoresRelacionados.length > 0) {
            this.context.logger.info(`💼 Salvando ${deputado.fornecedoresRelacionados.length} fornecedores do deputado ${deputado.nome}`);
            
            for (const fornecedor of deputado.fornecedoresRelacionados) {
                const cnpjLimpo = fornecedor.cnpj.replace(/\D/g, '');
                const docRef = `despesas/${deputado.id}/fornecedores/${cnpjLimpo}`;
                
                // Preparar dados do fornecedor com estatísticas completas
                const dadosFornecedor = {
                    cnpj: fornecedor.cnpj,
                    nome: fornecedor.nome,
                    totalGasto: fornecedor.totalGasto,
                    numeroTransacoes: fornecedor.numeroTransacoes,
                    categorias: fornecedor.categorias,
                    primeiraTransacao: fornecedor.primeiraTransacao,
                    ultimaTransacao: fornecedor.ultimaTransacao,
                    maiorTransacao: fornecedor.maiorTransacao,
                    menorTransacao: fornecedor.menorTransacao,
                    mediaTransacao: fornecedor.mediaTransacao,
                    scoreRisco: fornecedor.scoreRisco,
                    alertas: fornecedor.alertas,
                    
                    // Estatísticas adicionais
                    participacaoPercentual: (fornecedor.totalGasto / deputado.totalGastos) * 100,
                    posicaoRankingDeputado: 0, // Será calculado depois
                    mesesAtivos: this.calcularMesesAtivos(fornecedor.primeiraTransacao, fornecedor.ultimaTransacao),
                    ultimaAtualizacao: Timestamp.now(),
                    
                    // Metadados para consultas otimizadas
                    deputadoId: deputado.id,
                    deputadoNome: deputado.nome,
                    deputadoPartido: deputado.siglaPartido,
                    deputadoUF: deputado.siglaUf
                };
                
                await batchManager.set(docRef, dadosFornecedor);
            }
            
            // Calcular ranking dos fornecedores para este deputado
            const fornecedoresOrdenados = deputado.fornecedoresRelacionados
                .sort((a, b) => b.totalGasto - a.totalGasto);
            
            // Atualizar posição no ranking
            for (let i = 0; i < fornecedoresOrdenados.length; i++) {
                const fornecedor = fornecedoresOrdenados[i];
                const cnpjLimpo = fornecedor.cnpj.replace(/\D/g, '');
                const docRef = `despesas/${deputado.id}/fornecedores/${cnpjLimpo}`;
                
                await batchManager.update(docRef, {
                    posicaoRankingDeputado: i + 1
                });
            }
        }
    }

    // 5. Salvar Rankings pré-calculados
    this.emitProgress(ProcessingStatus.CARREGANDO, 60, `Salvando ${data.rankings.length} rankings`);
    for (const ranking of data.rankings) {
        const docRef = `rankings/${ranking.id}`;
        await batchManager.set(docRef, ranking);
    }

    // 5. Salvar Alertas investigativos
    this.emitProgress(ProcessingStatus.CARREGANDO, 75, `Salvando ${data.alertas.length} alertas`);
    for (const alerta of data.alertas) {
        const docRef = `alertas/${alerta.id}`;
        await batchManager.set(docRef, alerta);
    }

    // 6. Salvar Estatísticas globais
    this.emitProgress(ProcessingStatus.CARREGANDO, 85, 'Salvando estatísticas globais');
    const estatisticasRef = `estatisticas/${data.estatisticas.id}`;
    await batchManager.set(estatisticasRef, data.estatisticas);

    // 7. Criar índices otimizados para busca
    this.emitProgress(ProcessingStatus.CARREGANDO, 90, 'Criando índices de busca');
    await this.criarIndicesBusca(data, batchManager);

    // 8. Salvar metadados do processamento
    const metadados = {
      ultimoProcessamento: Timestamp.now(),
      versaoProcessor: '3.0-plus',
      totalDeputados: data.deputados.length,
      totalFornecedores: data.fornecedores.length,
      totalDespesas: data.despesas.length,
      totalRankings: data.rankings.length,
      totalAlertas: data.alertas.length,
      tempoProcessamento: Date.now() - startTime,
      configInvestigativa: CONFIG_INVESTIGATIVA
    };
    await batchManager.set('metadados/ultimoProcessamento', metadados);

    this.emitProgress(ProcessingStatus.CARREGANDO, 95, 'Executando commit final');
    const batchResults = await batchManager.commit();

    const tempoTotal = Math.round((Date.now() - startTime) / 1000);
    
    if (this.context.logger) {
      this.context.logger.info('✅ Carregamento concluído com sucesso!');
      this.context.logger.info(`📊 Estrutura completa salva em ${tempoTotal}s`);
      this.context.logger.info(`🏛️ Coleções: despesas (dados completos deputado + despesas), fornecedores, rankings, alertas, estatisticas`);
      this.context.logger.info(`👥 Deputados com dados completos na coleção despesas: ${despesasPorDeputado.size} documentos`);
      this.context.logger.info(`📋 Cada documento inclui: dados pessoais, gabinete, redes sociais, métricas e despesas`);
    }

    return {
        sucessos: batchResults.sucessos,
        falhas: batchResults.falhas,
        avisos: 0,
        tempoProcessamento: tempoTotal,
        destino: 'Firestore (Estrutura Otimizada V3+)',
        legislatura: this.context.options.legislatura!,
        detalhes: {
            deputadosSalvos: data.deputados.length,
            despesasSalvas: data.despesas.length,
            fornecedoresSalvos: data.fornecedores.length,
            rankingsSalvos: data.rankings.length,
            alertasSalvos: data.alertas.length,
            estatisticasSalvas: 1
        }
    };
  }

  private async criarIndicesBusca(data: TransformedData, batchManager: any): Promise<void> {
    // Índice de busca rápida por CNPJ/Nome de fornecedor
    const indiceFornecedores = {
      todosCNPJs: data.fornecedores.map((f: any) => ({ cnpj: f.cnpj, nome: f.nome })),
      porCategoria: this.agruparPorCategoria(data.fornecedores),
      porScore: this.agruparPorScore(data.fornecedores),
      geradoEm: Timestamp.now()
    };
    await batchManager.set('indices/fornecedores', indiceFornecedores);

    // Índice de busca por deputados
    const indiceDeputados = {
      todosIds: data.deputados.map((d: DeputadoOptimizado) => ({ id: d.id, nome: d.nome, partido: d.siglaPartido, uf: d.siglaUf })),
      porPartido: this.agruparPorPartido(data.deputados),
      porUF: this.agruparPorUF(data.deputados),
      geradoEm: Timestamp.now()
    };
    await batchManager.set('indices/deputados', indiceDeputados);

    // Índice de filtros comuns
    const indiceFiltros = {
      partidos: [...new Set(data.deputados.map((d: DeputadoOptimizado) => d.siglaPartido))].sort(),
      ufs: [...new Set(data.deputados.map((d: DeputadoOptimizado) => d.siglaUf))].sort(),
      categorias: [...new Set(data.fornecedores.flatMap((f: any) => f.categoriasAtendidas || []))].sort(),
      geradoEm: Timestamp.now()
    };
    await batchManager.set('indices/filtros', indiceFiltros);
  }

  private agruparPorCategoria(fornecedores: any[]): Record<string, string[]> {
    const grupos: Record<string, string[]> = {};
    for (const fornecedor of fornecedores) {
      const categoria = fornecedor.categoriaRisco;
      if (!grupos[categoria]) grupos[categoria] = [];
      grupos[categoria].push(fornecedor.cnpj);
    }
    return grupos;
  }

  private agruparPorScore(fornecedores: any[]): Record<string, string[]> {
    return {
      baixo: fornecedores.filter((f: any) => f.scoreInvestigativo < 30).map((f: any) => f.cnpj),
      medio: fornecedores.filter((f: any) => f.scoreInvestigativo >= 30 && f.scoreInvestigativo < 70).map((f: any) => f.cnpj),
      alto: fornecedores.filter((f: any) => f.scoreInvestigativo >= 70).map((f: any) => f.cnpj)
    };
  }

  private agruparPorPartido(deputados: DeputadoOptimizado[]): Record<string, string[]> {
    const grupos: Record<string, string[]> = {};
    for (const deputado of deputados) {
      if (!grupos[deputado.siglaPartido]) grupos[deputado.siglaPartido] = [];
      grupos[deputado.siglaPartido].push(deputado.id);
    }
    return grupos;
  }

  private agruparPorUF(deputados: DeputadoOptimizado[]): Record<string, string[]> {
    const grupos: Record<string, string[]> = {};
    for (const deputado of deputados) {
      if (!grupos[deputado.siglaUf]) grupos[deputado.siglaUf] = [];
      grupos[deputado.siglaUf].push(deputado.id);
    }
    return grupos;
  }

  /**
   * Calcula o número de meses ativos entre duas datas
   */
  private calcularMesesAtivos(primeiraTransacao: string, ultimaTransacao: string): number {
    try {
      const inicio = new Date(primeiraTransacao);
      const fim = new Date(ultimaTransacao);
      
      if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
        return 1; // Fallback para pelo menos 1 mês
      }
      
      const anoInicio = inicio.getFullYear();
      const mesInicio = inicio.getMonth();
      const anoFim = fim.getFullYear();
      const mesFim = fim.getMonth();
      
      const mesesAtivos = (anoFim - anoInicio) * 12 + (mesFim - mesInicio) + 1;
      
      return Math.max(1, mesesAtivos); // Mínimo de 1 mês
    } catch (error) {
      return 1; // Fallback em caso de erro
    }
  }

  /**
   * Calcula score de risco para fornecedor relacionado a um deputado específico
   * Baseado na metodologia Lava Jato adaptada para relação deputado-fornecedor
   */
  private calcularScoreRiscoFornecedor(dados: any): number {
    let score = 0;

    // 1. Volume alto com o deputado (25 pontos)
    if (dados.totalGasto > 100000) {
      score += 25;
    } else if (dados.totalGasto > 50000) {
      score += 15;
    } else if (dados.totalGasto > 20000) {
      score += 8;
    }

    // 2. Número elevado de transações (20 pontos)
    if (dados.numeroTransacoes > 50) {
      score += 20;
    } else if (dados.numeroTransacoes > 20) {
      score += 12;
    } else if (dados.numeroTransacoes > 10) {
      score += 6;
    }

    // 3. Transação única muito alta (15 pontos)
    if (dados.maiorTransacao > 50000) {
      score += 15;
    } else if (dados.maiorTransacao > 30000) {
      score += 10;
    }

    // 4. Poucas categorias de serviço (15 pontos)
    if (dados.categorias.size <= 1) {
      score += 15;
    } else if (dados.categorias.size <= 2) {
      score += 8;
    }

    // 5. Valores médios muito altos (10 pontos)
    if (dados.mediaTransacao > 15000) {
      score += 10;
    } else if (dados.mediaTransacao > 8000) {
      score += 5;
    }

    // 6. Categorias de alto risco (15 pontos)
    const categoriasAltoRisco = dados.categorias.filter((cat: string) => 
      HIGH_RISK_INTANGIBLE_CATEGORIES.includes(cat)
    );
    if (categoriasAltoRisco.length > 0) {
      score += Math.min(15, categoriasAltoRisco.length * 5);
    }

    return Math.min(score, 100);
  }
}
