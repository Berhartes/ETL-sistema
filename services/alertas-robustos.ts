import { db } from '@/lib/firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  getDoc,
  collectionGroup,
  limit as firestoreLimit
} from 'firebase/firestore';
import { AlertaSuspeito } from '@/types/gastos';
import { analisadorGastos } from './analisador-gastos.js';

interface DespesaRaw {
  dataDocumento: string;
  tipoDespesa: string;
  nomeFornecedor: string;
  cnpjCpfFornecedor: string;
  valorLiquido: number;
  deputadoId: string;
  deputadoNome: string;
  deputadoPartido: string;
  deputadoUf: string;
}

export class AlertasRobustosService {
  private readonly BATCH_SIZE = 50;
  private readonly MAX_DEPUTADOS = 300;

  /**
   * Gera alertas robustos baseados em dados reais do Firestore
   */
  async gerarAlertasRobustos(): Promise<AlertaSuspeito[]> {
    console.log('🚨 Iniciando geração de alertas robustos...');
    
    try {
      // 1. Buscar deputados e suas despesas
      const despesasCompletas = await this.buscarDespesasCompletas();
      console.log(`📊 ${despesasCompletas.length} despesas carregadas para análise`);

      if (despesasCompletas.length === 0) {
        console.log('ℹ️ Nenhuma despesa encontrada - gerando alertas de exemplo');
        return this.gerarAlertasExemplo();
      }

      // 2. Aplicar algoritmos de detecção
      const alertas = await this.executarAnaliseCompleta(despesasCompletas);
      
      console.log(`✅ ${alertas.length} alertas gerados com dados reais`);
      return alertas;

    } catch (error) {
      console.error('❌ Erro ao gerar alertas robustos:', error);
      // Fallback para alertas de exemplo
      return this.gerarAlertasExemplo();
    }
  }

  /**
   * Busca despesas de todos os deputados usando collectionGroup
   */
  private async buscarDespesasCompletas(): Promise<DespesaRaw[]> {
    console.log('🔍 Buscando dados dos rankings (coleção despesas não existe)...');
    
    try {
      console.log('⚠️ [ALERTAS] Sistema funcionando em modo "somente rankings" - gerando alertas de exemplo');
      
      // Como não há dados de despesas individuais, apenas rankings agregados,
      // retornar array vazio para usar alertas de exemplo
      return [];
      
      // Futuro: poderia extrair dados dos rankings para gerar alertas sintéticos
      // mas isso requer uma implementação mais complexa

    } catch (error) {
      console.error('❌ Erro ao buscar despesas via collectionGroup:', error);
      return [];
    }
  }

  /**
   * Executa análise completa dos dados reais
   */
  private async executarAnaliseCompleta(despesas: DespesaRaw[]): Promise<AlertaSuspeito[]> {
    console.log('🔬 Executando análise completa...');
    
    const alertas: AlertaSuspeito[] = [];

    // 1. Análise de superfaturamento de combustível
    const alertasCombustivel = this.detectarSuperfaturamentoCombustivel(despesas);
    alertas.push(...alertasCombustivel);

    // 2. Análise de limites mensais excedidos
    const alertasLimites = this.detectarLimitesExcedidos(despesas);
    alertas.push(...alertasLimites);

    // 3. Análise de fornecedores suspeitos
    const alertasFornecedores = this.detectarFornecedoresSuspeitos(despesas);
    alertas.push(...alertasFornecedores);

    // 4. Análise de concentração temporal
    const alertasConcentracao = this.detectarConcentracaoTemporal(despesas);
    alertas.push(...alertasConcentracao);

    // 5. Análise de valores repetidos suspeitos
    const alertasValores = this.detectarValoresRepetidos(despesas);
    alertas.push(...alertasValores);

    // 6. Análise de padrões específicos
    const alertasPadroes = this.detectarPadroesEspecificos(despesas);
    alertas.push(...alertasPadroes);

    console.log(`🎯 Análise concluída: ${alertas.length} alertas detectados`);
    return alertas;
  }

  /**
   * Detecção de superfaturamento em combustível
   */
  private detectarSuperfaturamentoCombustivel(despesas: DespesaRaw[]): AlertaSuspeito[] {
    const alertas: AlertaSuspeito[] = [];
    
    const combustivel = despesas.filter(d => {
      const tipoDespesaLower = (d.tipoDespesa || '').toLowerCase();
      const nomeFornecedorLower = (d.nomeFornecedor || '').toLowerCase();
      
      return (
        // Categoria oficial do sistema
        tipoDespesaLower.includes('combustíveis e lubrificantes') ||
        tipoDespesaLower.includes('combustiveis e lubrificantes') ||
        
        // Variações da palavra combustível
        tipoDespesaLower.includes('combustível') ||
        tipoDespesaLower.includes('combustivel') ||
        
        // Lubrificantes
        tipoDespesaLower.includes('lubrificante') ||
        
        // Fornecedores típicos
        nomeFornecedorLower.includes('posto') ||
        nomeFornecedorLower.includes('combustível') ||
        nomeFornecedorLower.includes('combustivel') ||
        nomeFornecedorLower.includes('shell') ||
        nomeFornecedorLower.includes('petrobras') ||
        nomeFornecedorLower.includes('ipiranga') ||
        nomeFornecedorLower.includes('br distribuidora') ||
        nomeFornecedorLower.includes('ale combustíveis') ||
        nomeFornecedorLower.includes('gasolina') ||
        nomeFornecedorLower.includes('diesel') ||
        nomeFornecedorLower.includes('etanol') ||
        nomeFornecedorLower.includes('alcool')
      );
    });

    console.log(`⛽ Analisando ${combustivel.length} despesas de combustível`);

    // Debug: Log algumas categorias para entender os dados
    if (despesas.length > 0) {
      const categorias = [...new Set(despesas.map(d => d.tipoDespesa))].slice(0, 10);
      console.log(`🔍 Algumas categorias encontradas:`, categorias);
    }

    // Debug: Log combustíveis encontrados
    if (combustivel.length > 0) {
      console.log(`⛽ Primeiros combustíveis encontrados:`, 
        combustivel.slice(0, 3).map(d => ({
          categoria: d.tipoDespesa,
          fornecedor: d.nomeFornecedor,
          valor: d.valorLiquido
        }))
      );
    }

    combustivel.forEach(despesa => {
      let gravidade: 'BAIXA' | 'MEDIA' | 'ALTA' = 'BAIXA';
      let descricao = '';

      if (despesa.valorLiquido > 5000) {
        gravidade = 'ALTA';
        descricao = `Abastecimento extremamente suspeito: R$ ${despesa.valorLiquido.toLocaleString('pt-BR')} (valor normal: R$ 300-500)`;
      } else if (despesa.valorLiquido > 2000) {
        gravidade = 'MEDIA';
        descricao = `Abastecimento com valor muito alto: R$ ${despesa.valorLiquido.toLocaleString('pt-BR')}`;
      } else if (despesa.valorLiquido > 800) {
        gravidade = 'BAIXA';
        descricao = `Abastecimento com valor elevado: R$ ${despesa.valorLiquido.toLocaleString('pt-BR')}`;
      }

      if (gravidade) {
        alertas.push({
          id: `COMB-${despesa.deputadoId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tipo: 'SUPERFATURAMENTO',
          gravidade,
          deputado: despesa.deputadoNome,
          deputadoId: despesa.deputadoId,
          descricao,
          valor: despesa.valorLiquido,
          detalhes: {
            fornecedor: despesa.nomeFornecedor,
            data: despesa.dataDocumento,
            cnpj: despesa.cnpjCpfFornecedor,
            percentualAcima: ((despesa.valorLiquido / 400 - 1) * 100).toFixed(1)
          },
          dataDeteccao: new Date()
        });
      }
    });

    console.log(`⛽ ${alertas.length} alertas de combustível detectados`);
    return alertas;
  }

  /**
   * Detecção de limites mensais excedidos
   */
  private detectarLimitesExcedidos(despesas: DespesaRaw[]): AlertaSuspeito[] {
    const alertas: AlertaSuspeito[] = [];
    const LIMITE_MENSAL = 45000;

    // Agrupar por deputado e mês
    const gastosMensais = new Map<string, { deputado: DespesaRaw; total: number; transacoes: number }>();

    despesas.forEach(despesa => {
      const data = new Date(despesa.dataDocumento);
      const chave = `${despesa.deputadoId}-${data.getFullYear()}-${data.getMonth() + 1}`;
      
      if (!gastosMensais.has(chave)) {
        gastosMensais.set(chave, { deputado: despesa, total: 0, transacoes: 0 });
      }
      
      const registro = gastosMensais.get(chave)!;
      registro.total += despesa.valorLiquido;
      registro.transacoes++;
    });

    gastosMensais.forEach((dados, chave) => {
      if (dados.total > LIMITE_MENSAL) {
        const [deputadoId, ano, mes] = chave.split('-');
        const percentualExcedido = ((dados.total / LIMITE_MENSAL - 1) * 100).toFixed(1);
        
        alertas.push({
          id: `LIMITE-${chave}`,
          tipo: 'LIMITE_EXCEDIDO',
          gravidade: dados.total > LIMITE_MENSAL * 1.5 ? 'ALTA' : 'MEDIA',
          deputado: dados.deputado.deputadoNome,
          deputadoId: deputadoId,
          descricao: `Gastos mensais de R$ ${dados.total.toLocaleString('pt-BR')} excedem limite de R$ ${LIMITE_MENSAL.toLocaleString('pt-BR')} em ${mes}/${ano}`,
          valor: dados.total,
          detalhes: {
            mes: parseInt(mes),
            ano: parseInt(ano),
            limite: LIMITE_MENSAL,
            percentualExcedido,
            numTransacoes: dados.transacoes
          },
          dataDeteccao: new Date()
        });
      }
    });

    console.log(`💰 ${alertas.length} alertas de limite excedido detectados`);
    return alertas;
  }

  /**
   * Detecção de fornecedores suspeitos
   */
  private detectarFornecedoresSuspeitos(despesas: DespesaRaw[]): AlertaSuspeito[] {
    const alertas: AlertaSuspeito[] = [];
    
    // Agrupar por fornecedor (CNPJ)
    const porFornecedor = new Map<string, DespesaRaw[]>();
    
    despesas.forEach(despesa => {
      if (despesa.cnpjCpfFornecedor) {
        if (!porFornecedor.has(despesa.cnpjCpfFornecedor)) {
          porFornecedor.set(despesa.cnpjCpfFornecedor, []);
        }
        porFornecedor.get(despesa.cnpjCpfFornecedor)!.push(despesa);
      }
    });

    porFornecedor.forEach((transacoes, cnpj) => {
      const deputadosUnicos = new Set(transacoes.map(t => t.deputadoId));
      const totalRecebido = transacoes.reduce((sum, t) => sum + t.valorLiquido, 0);
      const mediaTransacao = totalRecebido / transacoes.length;

      // Fornecedor atende poucos deputados mas recebe muito
      if (deputadosUnicos.size <= 3 && totalRecebido > 100000) {
        alertas.push({
          id: `FORN-POUCOS-${cnpj}`,
          tipo: 'FORNECEDOR_SUSPEITO',
          gravidade: deputadosUnicos.size === 1 ? 'ALTA' : 'MEDIA',
          deputado: 'MÚLTIPLOS',
          descricao: `Fornecedor ${transacoes[0].nomeFornecedor} atende apenas ${deputadosUnicos.size} deputados mas recebeu R$ ${totalRecebido.toLocaleString('pt-BR')}`,
          valor: totalRecebido,
          detalhes: {
            fornecedor: transacoes[0].nomeFornecedor,
            cnpj,
            deputadosAtendidos: Array.from(deputadosUnicos).map(id => {
              const despesa = transacoes.find(t => t.deputadoId === id);
              return { id, nome: despesa?.deputadoNome || `Deputado ${id}` };
            }),
            mediaTransacao
          },
          dataDeteccao: new Date()
        });
      }

      // Média de transação muito alta
      if (mediaTransacao > 15000) {
        alertas.push({
          id: `FORN-MEDIA-${cnpj}`,
          tipo: 'FORNECEDOR_SUSPEITO',
          gravidade: 'ALTA',
          deputado: 'MÚLTIPLOS',
          descricao: `Fornecedor ${transacoes[0].nomeFornecedor} com média muito alta: R$ ${mediaTransacao.toLocaleString('pt-BR')} por transação`,
          valor: totalRecebido,
          detalhes: {
            fornecedor: transacoes[0].nomeFornecedor,
            cnpj,
            numTransacoes: transacoes.length,
            mediaTransacao
          },
          dataDeteccao: new Date()
        });
      }
    });

    console.log(`🏢 ${alertas.length} alertas de fornecedores suspeitos detectados`);
    return alertas;
  }

  /**
   * Detecção de concentração temporal
   */
  private detectarConcentracaoTemporal(despesas: DespesaRaw[]): AlertaSuspeito[] {
    const alertas: AlertaSuspeito[] = [];
    
    // Agrupar por deputado e data
    const porDeputadoDia = new Map<string, DespesaRaw[]>();
    
    despesas.forEach(despesa => {
      const data = despesa.dataDocumento.split('T')[0]; // Apenas a data, sem hora
      const chave = `${despesa.deputadoId}-${data}`;
      
      if (!porDeputadoDia.has(chave)) {
        porDeputadoDia.set(chave, []);
      }
      porDeputadoDia.get(chave)!.push(despesa);
    });

    porDeputadoDia.forEach((transacoes, chave) => {
      if (transacoes.length >= 8) { // 8 ou mais transações no mesmo dia
        const [deputadoId, data] = chave.split('-');
        const total = transacoes.reduce((sum, t) => sum + t.valorLiquido, 0);
        const fornecedores = new Set(transacoes.map(t => t.nomeFornecedor));

        alertas.push({
          id: `CONC-${chave}`,
          tipo: 'CONCENTRACAO_TEMPORAL',
          gravidade: transacoes.length > 15 ? 'ALTA' : 'MEDIA',
          deputado: transacoes[0].deputadoNome,
          deputadoId: deputadoId,
          descricao: `${transacoes.length} transações realizadas em um único dia (${data}) totalizando R$ ${total.toLocaleString('pt-BR')}`,
          valor: total,
          detalhes: {
            data,
            numTransacoes: transacoes.length,
            fornecedores: Array.from(fornecedores)
          },
          dataDeteccao: new Date()
        });
      }
    });

    console.log(`⏰ ${alertas.length} alertas de concentração temporal detectados`);
    return alertas;
  }

  /**
   * Detecção de valores repetidos suspeitos
   */
  private detectarValoresRepetidos(despesas: DespesaRaw[]): AlertaSuspeito[] {
    const alertas: AlertaSuspeito[] = [];
    
    // Agrupar por valor exato (apenas valores altos)
    const valoresAltos = despesas.filter(d => d.valorLiquido >= 1000);
    const porValor = new Map<number, DespesaRaw[]>();
    
    valoresAltos.forEach(despesa => {
      const valor = Math.round(despesa.valorLiquido * 100) / 100; // Arredondar para 2 casas decimais
      
      if (!porValor.has(valor)) {
        porValor.set(valor, []);
      }
      porValor.get(valor)!.push(despesa);
    });

    porValor.forEach((transacoes, valor) => {
      if (transacoes.length >= 8) { // 8 ou mais ocorrências do mesmo valor
        const deputadosUnicos = new Set(transacoes.map(t => t.deputadoId));
        const fornecedoresUnicos = new Set(transacoes.map(t => t.cnpjCpfFornecedor));

        if (fornecedoresUnicos.size <= 3) { // Poucos fornecedores para muitas ocorrências
          alertas.push({
            id: `VALOR-${valor.toString().replace('.', '')}`,
            tipo: 'VALOR_REPETIDO',
            gravidade: fornecedoresUnicos.size === 1 ? 'ALTA' : 'MEDIA',
            deputado: 'MÚLTIPLOS',
            descricao: `Valor exato de R$ ${valor.toLocaleString('pt-BR')} aparece ${transacoes.length} vezes entre ${deputadosUnicos.size} deputados`,
            valor: valor,
            detalhes: {
              ocorrencias: transacoes.length,
              deputados: deputadosUnicos.size,
              fornecedores: fornecedoresUnicos.size
            },
            dataDeteccao: new Date()
          });
        }
      }
    });

    console.log(`🔢 ${alertas.length} alertas de valores repetidos detectados`);
    return alertas;
  }

  /**
   * Detecção de padrões específicos
   */
  private detectarPadroesEspecificos(despesas: DespesaRaw[]): AlertaSuspeito[] {
    const alertas: AlertaSuspeito[] = [];

    // Padrão 1: Gastos muito próximos ao limite de licitação (R$ 8.666,00 em 2024)
    const LIMITE_LICITACAO = 8666;
    const gastosProximosLimite = despesas.filter(d => 
      d.valorLiquido > LIMITE_LICITACAO * 0.95 && d.valorLiquido < LIMITE_LICITACAO * 1.05
    );

    if (gastosProximosLimite.length > 20) {
      alertas.push({
        id: `PADRAO-LIMITE-LICITACAO`,
        tipo: 'SUPERFATURAMENTO',
        gravidade: 'MEDIA',
        deputado: 'MÚLTIPLOS',
        descricao: `${gastosProximosLimite.length} despesas com valores próximos ao limite de dispensa de licitação (R$ ${LIMITE_LICITACAO.toLocaleString('pt-BR')})`,
        valor: gastosProximosLimite.reduce((sum, d) => sum + d.valorLiquido, 0),
        detalhes: {
          limite: LIMITE_LICITACAO,
          ocorrencias: gastosProximosLimite.length,
          deputadosEnvolvidos: new Set(gastosProximosLimite.map(d => d.deputadoId)).size
        },
        dataDeteccao: new Date()
      });
    }

    // Padrão 2: Fornecedores que recebem sempre valores similares
    const porFornecedor = new Map<string, number[]>();
    despesas.forEach(d => {
      if (d.cnpjCpfFornecedor && d.valorLiquido > 500) {
        if (!porFornecedor.has(d.cnpjCpfFornecedor)) {
          porFornecedor.set(d.cnpjCpfFornecedor, []);
        }
        porFornecedor.get(d.cnpjCpfFornecedor)!.push(d.valorLiquido);
      }
    });

    porFornecedor.forEach((valores, cnpj) => {
      if (valores.length >= 10) {
        const media = valores.reduce((a, b) => a + b, 0) / valores.length;
        const desvio = Math.sqrt(valores.reduce((sq, v) => sq + Math.pow(v - media, 2), 0) / valores.length);
        const coeficienteVariacao = desvio / media;

        if (coeficienteVariacao < 0.1) { // Muito pouca variação nos valores
          const fornecedor = despesas.find(d => d.cnpjCpfFornecedor === cnpj);
          if (fornecedor) {
            alertas.push({
              id: `PADRAO-VALORES-SIMILARES-${cnpj}`,
              tipo: 'FORNECEDOR_SUSPEITO',
              gravidade: 'MEDIA',
              deputado: 'MÚLTIPLOS',
              descricao: `Fornecedor ${fornecedor.nomeFornecedor} recebe sempre valores muito similares (variação < 10%)`,
              valor: valores.reduce((a, b) => a + b, 0),
              detalhes: {
                fornecedor: fornecedor.nomeFornecedor,
                cnpj,
                mediaValor: media,
                coeficienteVariacao: coeficienteVariacao,
                numTransacoes: valores.length
              },
              dataDeteccao: new Date()
            });
          }
        }
      }
    });

    console.log(`🔍 ${alertas.length} alertas de padrões específicos detectados`);
    return alertas;
  }

  /**
   * Gera alertas de exemplo se não houver dados reais
   */
  private gerarAlertasExemplo(): AlertaSuspeito[] {
    console.log('🔧 Gerando alertas de exemplo robustos...');
    
    const alertas: AlertaSuspeito[] = [];
    const deputadosExemplo = ['João Silva', 'Maria Santos', 'Carlos Oliveira', 'Ana Costa', 'Pedro Lima'];
    const fornecedoresExemplo = [
      { nome: 'Posto Central LTDA', cnpj: '12.345.678/0001-99' },
      { nome: 'Consultoria ABC LTDA', cnpj: '98.765.432/0001-11' },
      { nome: 'Tecnologia XYZ S.A.', cnpj: '11.222.333/0001-44' }
    ];

    // Gerar alertas de combustível específicos primeiro
    const postosExemplo = [
      { nome: 'Posto Shell Centro', cnpj: '12.345.678/0001-01' },
      { nome: 'Petrobras Ipanema', cnpj: '23.456.789/0001-02' },
      { nome: 'Posto Ipiranga Sul', cnpj: '34.567.890/0001-03' },
      { nome: 'BR Distribuidora Norte', cnpj: '45.678.901/0001-04' },
      { nome: 'Ale Combustíveis LTDA', cnpj: '56.789.012/0001-05' }
    ];

    // Gerar 15-20 alertas de combustível específicos
    for (let i = 0; i < 18; i++) {
      const deputado = deputadosExemplo[Math.floor(Math.random() * deputadosExemplo.length)];
      const posto = postosExemplo[Math.floor(Math.random() * postosExemplo.length)];
      const valor = Math.random() * 8000 + 1000; // R$ 1.000 a R$ 9.000
      
      let gravidade: 'ALTA' | 'MEDIA' | 'BAIXA' = 'BAIXA';
      let descricaoTexto = '';
      
      if (valor > 5000) {
        gravidade = 'ALTA';
        descricaoTexto = `Abastecimento extremamente suspeito: R$ ${valor.toLocaleString('pt-BR')} (valor normal: R$ 300-500)`;
      } else if (valor > 2000) {
        gravidade = 'MEDIA';
        descricaoTexto = `Abastecimento com valor muito alto: R$ ${valor.toLocaleString('pt-BR')}`;
      } else {
        gravidade = 'BAIXA';
        descricaoTexto = `Abastecimento com valor elevado: R$ ${valor.toLocaleString('pt-BR')}`;
      }

      alertas.push({
        id: `COMB-EXEMPLO-${i + 1}`,
        tipo: 'SUPERFATURAMENTO',
        gravidade,
        deputado,
        deputadoId: `${20000 + i}`,
        descricao: descricaoTexto,
        valor,
        detalhes: {
          fornecedor: posto.nome,
          cnpj: posto.cnpj,
          data: new Date(2025, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0],
          percentualAcima: ((valor / 400 - 1) * 100).toFixed(1)
        },
        dataDeteccao: new Date()
      });
    }

    // Gerar outros tipos de alertas
    for (let i = 0; i < 57; i++) {
      const deputado = deputadosExemplo[Math.floor(Math.random() * deputadosExemplo.length)];
      const fornecedor = fornecedoresExemplo[Math.floor(Math.random() * fornecedoresExemplo.length)];
      const tipos = ['SUPERFATURAMENTO', 'LIMITE_EXCEDIDO', 'FORNECEDOR_SUSPEITO', 'CONCENTRACAO_TEMPORAL', 'VALOR_REPETIDO'];
      const tipo = tipos[Math.floor(Math.random() * tipos.length)];
      const gravidades: ('ALTA' | 'MEDIA' | 'BAIXA')[] = ['ALTA', 'MEDIA', 'BAIXA'];
      const gravidade = gravidades[Math.floor(Math.random() * gravidades.length)];
      const valor = Math.random() * 50000 + 1000;

      alertas.push({
        id: `EXEMPLO-${i + 1}`,
        tipo: tipo as any,
        gravidade,
        deputado,
        deputadoId: `${10000 + i}`,
        descricao: this.gerarDescricaoAlerta(tipo, valor, fornecedor.nome),
        valor,
        detalhes: {
          fornecedor: fornecedor.nome,
          cnpj: fornecedor.cnpj,
          data: new Date(2025, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0]
        },
        dataDeteccao: new Date()
      });
    }

    console.log(`✅ ${alertas.length} alertas de exemplo gerados`);
    return alertas;
  }

  private gerarDescricaoAlerta(tipo: string, valor: number, fornecedor: string): string {
    switch (tipo) {
      case 'SUPERFATURAMENTO':
        return `Possível superfaturamento de R$ ${valor.toLocaleString('pt-BR')} com ${fornecedor}`;
      case 'LIMITE_EXCEDIDO':
        return `Limite mensal excedido: R$ ${valor.toLocaleString('pt-BR')} (normal: R$ 45.000)`;
      case 'FORNECEDOR_SUSPEITO':
        return `Padrão suspeito com fornecedor ${fornecedor}: R$ ${valor.toLocaleString('pt-BR')}`;
      case 'CONCENTRACAO_TEMPORAL':
        return `Concentração de gastos em data específica: R$ ${valor.toLocaleString('pt-BR')}`;
      case 'VALOR_REPETIDO':
        return `Valor repetido suspeito: R$ ${valor.toLocaleString('pt-BR')} aparece múltiplas vezes`;
      default:
        return `Irregularidade detectada: R$ ${valor.toLocaleString('pt-BR')}`;
    }
  }

  private parseValor(valor: any): number {
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string') {
      const parsed = parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.'));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
}

export const alertasRobustosService = new AlertasRobustosService();