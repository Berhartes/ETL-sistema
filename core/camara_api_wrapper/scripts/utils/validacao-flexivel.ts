/**
 * Sistema de Validação Flexível - Nunca Descarta Dados
 * 
 * Este sistema substitui validações rígidas por correções automáticas.
 * Filosofia: Todo dado pode ser aproveitado com a correção adequada.
 */

export interface DespesaBruta {
  ano?: number | string | null;
  mes?: number | string | null;
  dataDocumento?: string | null;
  valorLiquido?: string | number | null;
  cnpjCpfFornecedor?: string | null;
  nomeFornecedor?: string | null;
  tipoDespesa?: string | null;
  valorDocumento?: string | number | null;
  urlDocumento?: string | null;
}

export interface ResultadoValidacao {
  despesaCorrigida: DespesaBruta;
  observacoes: string[];
  scoreQualidade: number; // 0-100
  foiCorrigida: boolean;
}

/**
 * Classe principal para validação flexível de despesas
 */
export class ValidacaoFlexivel {
  private estatisticas = {
    totalProcessadas: 0,
    totalCorrigidas: 0,
    corrrecoesPorTipo: new Map<string, number>()
  };

  /**
   * Valida e corrige uma despesa - NUNCA retorna null
   */
  public validarECorrigir(despesa: DespesaBruta): ResultadoValidacao {
    this.estatisticas.totalProcessadas++;
    
    const observacoes: string[] = [];
    let scoreQualidade = 100;
    let foiCorrigida = false;
    
    const despesaCorrigida: DespesaBruta = { ...despesa };

    // 1. Corrigir ANO
    const resultadoAno = this.corrigirAno(despesaCorrigida);
    if (resultadoAno.foiCorrigido) {
      observacoes.push(resultadoAno.observacao);
      scoreQualidade -= resultadoAno.penalidade;
      foiCorrigida = true;
      this.contarCorrecao('ano');
    }

    // 2. Corrigir MÊS
    const resultadoMes = this.corrigirMes(despesaCorrigida);
    if (resultadoMes.foiCorrigido) {
      observacoes.push(resultadoMes.observacao);
      scoreQualidade -= resultadoMes.penalidade;
      foiCorrigida = true;
      this.contarCorrecao('mes');
    }

    // 3. Corrigir DATA DOCUMENTO
    const resultadoData = this.corrigirDataDocumento(despesaCorrigida);
    if (resultadoData.foiCorrigido) {
      observacoes.push(resultadoData.observacao);
      scoreQualidade -= resultadoData.penalidade;
      foiCorrigida = true;
      this.contarCorrecao('dataDocumento');
    }

    // 4. Corrigir VALOR LÍQUIDO
    const resultadoValor = this.corrigirValorLiquido(despesaCorrigida);
    if (resultadoValor.foiCorrigido) {
      observacoes.push(resultadoValor.observacao);
      scoreQualidade -= resultadoValor.penalidade;
      foiCorrigida = true;
      this.contarCorrecao('valorLiquido');
    }

    // 5. Corrigir NOME FORNECEDOR
    const resultadoNome = this.corrigirNomeFornecedor(despesaCorrigida);
    if (resultadoNome.foiCorrigido) {
      observacoes.push(resultadoNome.observacao);
      scoreQualidade -= resultadoNome.penalidade;
      foiCorrigida = true;
      this.contarCorrecao('nomeFornecedor');
    }

    // 6. Corrigir TIPO DESPESA
    const resultadoTipo = this.corrigirTipoDespesa(despesaCorrigida);
    if (resultadoTipo.foiCorrigido) {
      observacoes.push(resultadoTipo.observacao);
      scoreQualidade -= resultadoTipo.penalidade;
      foiCorrigida = true;
      this.contarCorrecao('tipoDespesa');
    }

    if (foiCorrigida) {
      this.estatisticas.totalCorrigidas++;
    }

    return {
      despesaCorrigida,
      observacoes,
      scoreQualidade: Math.max(0, Math.min(100, scoreQualidade)),
      foiCorrigida
    };
  }

  // === MÉTODOS DE CORREÇÃO ESPECÍFICOS ===

  private corrigirAno(despesa: DespesaBruta): { foiCorrigido: boolean; observacao: string; penalidade: number } {
    if (despesa.ano && !isNaN(Number(despesa.ano))) {
      const anoNum = Number(despesa.ano);
      if (anoNum >= 2000 && anoNum <= new Date().getFullYear()) {
        return { foiCorrigido: false, observacao: '', penalidade: 0 };
      }
    }

    // Tentar extrair ano da data do documento
    if (despesa.dataDocumento) {
      const dataDoc = new Date(despesa.dataDocumento);
      if (!isNaN(dataDoc.getTime())) {
        despesa.ano = dataDoc.getFullYear();
        return { 
          foiCorrigido: true, 
          observacao: `Ano derivado da dataDocumento: ${despesa.ano}`,
          penalidade: 5
        };
      }
    }

    // Fallback: usar ano atual
    despesa.ano = new Date().getFullYear();
    return { 
      foiCorrigido: true, 
      observacao: `Ano indefinido, usado ano atual: ${despesa.ano}`,
      penalidade: 15
    };
  }

  private corrigirMes(despesa: DespesaBruta): { foiCorrigido: boolean; observacao: string; penalidade: number } {
    if (despesa.mes && !isNaN(Number(despesa.mes))) {
      const mesNum = Number(despesa.mes);
      if (mesNum >= 1 && mesNum <= 12) {
        return { foiCorrigido: false, observacao: '', penalidade: 0 };
      }
    }

    // Tentar extrair mês da data do documento
    if (despesa.dataDocumento) {
      const dataDoc = new Date(despesa.dataDocumento);
      if (!isNaN(dataDoc.getTime())) {
        despesa.mes = dataDoc.getMonth() + 1;
        return { 
          foiCorrigido: true, 
          observacao: `Mês derivado da dataDocumento: ${despesa.mes}`,
          penalidade: 5
        };
      }
    }

    // Fallback: usar mês atual
    despesa.mes = new Date().getMonth() + 1;
    return { 
      foiCorrigido: true, 
      observacao: `Mês indefinido, usado mês atual: ${despesa.mes}`,
      penalidade: 15
    };
  }

  private corrigirDataDocumento(despesa: DespesaBruta): { foiCorrigido: boolean; observacao: string; penalidade: number } {
    if (despesa.dataDocumento) {
      const dataDoc = new Date(despesa.dataDocumento);
      if (!isNaN(dataDoc.getTime())) {
        // Data válida, verificar se está em um range razoável
        const ano = dataDoc.getFullYear();
        if (ano >= 2000 && ano <= new Date().getFullYear() + 1) {
          return { foiCorrigido: false, observacao: '', penalidade: 0 };
        }
      }
    }

    // Tentar construir data a partir do ano e mês
    if (despesa.ano && despesa.mes) {
      const anoNum = Number(despesa.ano);
      const mesNum = Number(despesa.mes);
      if (!isNaN(anoNum) && !isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
        // Usar dia 15 como padrão (meio do mês)
        const dataReconstruida = new Date(anoNum, mesNum - 1, 15);
        despesa.dataDocumento = dataReconstruida.toISOString().split('T')[0];
        return { 
          foiCorrigido: true, 
          observacao: `Data reconstruída partir do ano/mês: ${despesa.dataDocumento}`,
          penalidade: 10
        };
      }
    }

    // Fallback: usar data atual
    despesa.dataDocumento = new Date().toISOString().split('T')[0];
    return { 
      foiCorrigido: true, 
      observacao: `Data indefinida, usada data atual: ${despesa.dataDocumento}`,
      penalidade: 20
    };
  }

  private corrigirValorLiquido(despesa: DespesaBruta): { foiCorrigido: boolean; observacao: string; penalidade: number } {
    if (despesa.valorLiquido) {
      const valor = Number(despesa.valorLiquido);
      if (!isNaN(valor) && valor > 0) {
        despesa.valorLiquido = valor;
        return { foiCorrigido: false, observacao: '', penalidade: 0 };
      }
    }

    // Tentar usar valorDocumento como alternativa
    if (despesa.valorDocumento) {
      const valorDoc = Number(despesa.valorDocumento);
      if (!isNaN(valorDoc) && valorDoc > 0) {
        despesa.valorLiquido = valorDoc;
        return { 
          foiCorrigido: true, 
          observacao: `Valor líquido derivado do valorDocumento: ${despesa.valorLiquido}`,
          penalidade: 5
        };
      }
    }

    // Fallback: valor mínimo simbólico
    despesa.valorLiquido = 0.01;
    return { 
      foiCorrigido: true, 
      observacao: `Valor indefinido, usado valor mínimo simbólico: ${despesa.valorLiquido}`,
      penalidade: 25
    };
  }

  private corrigirNomeFornecedor(despesa: DespesaBruta): { foiCorrigido: boolean; observacao: string; penalidade: number } {
    if (despesa.nomeFornecedor && despesa.nomeFornecedor.trim().length > 0) {
      // Nome válido, apenas limpar
      despesa.nomeFornecedor = despesa.nomeFornecedor.trim().replace(/\s+/g, ' ');
      return { foiCorrigido: false, observacao: '', penalidade: 0 };
    }

    // Fallback: nome genérico baseado no CNPJ se disponível
    if (despesa.cnpjCpfFornecedor && despesa.cnpjCpfFornecedor.trim().length > 0) {
      const cnpjLimpo = despesa.cnpjCpfFornecedor.replace(/\D/g, '');
      despesa.nomeFornecedor = `Fornecedor ${cnpjLimpo.substring(0, 6)}`;
      return { 
        foiCorrigido: true, 
        observacao: `Nome gerado baseado no CNPJ: ${despesa.nomeFornecedor}`,
        penalidade: 15
      };
    }

    // Fallback final: nome genérico
    despesa.nomeFornecedor = 'Fornecedor Não Identificado';
    return { 
      foiCorrigido: true, 
      observacao: `Nome indefinido, usado nome genérico: ${despesa.nomeFornecedor}`,
      penalidade: 20
    };
  }

  private corrigirTipoDespesa(despesa: DespesaBruta): { foiCorrigido: boolean; observacao: string; penalidade: number } {
    if (despesa.tipoDespesa && despesa.tipoDespesa.trim().length > 0) {
      // Tipo válido, apenas limpar
      despesa.tipoDespesa = despesa.tipoDespesa.trim().replace(/\s+/g, ' ');
      return { foiCorrigido: false, observacao: '', penalidade: 0 };
    }

    // Fallback: tipo genérico
    despesa.tipoDespesa = 'Despesa Não Especificada';
    return { 
      foiCorrigido: true, 
      observacao: `Tipo indefinido, usado tipo genérico: ${despesa.tipoDespesa}`,
      penalidade: 10
    };
  }

  // === MÉTODOS DE ESTATÍSTICAS ===

  private contarCorrecao(tipo: string): void {
    const atual = this.estatisticas.corrrecoesPorTipo.get(tipo) || 0;
    this.estatisticas.corrrecoesPorTipo.set(tipo, atual + 1);
  }

  public obterEstatisticas() {
    const percentualCorrigidas = this.estatisticas.totalProcessadas > 0 
      ? (this.estatisticas.totalCorrigidas / this.estatisticas.totalProcessadas * 100).toFixed(2)
      : '0.00';

    const corrrecoesPorTipo: Record<string, number> = {};
    for (const [tipo, quantidade] of this.estatisticas.corrrecoesPorTipo) {
      corrrecoesPorTipo[tipo] = quantidade;
    }

    return {
      totalProcessadas: this.estatisticas.totalProcessadas,
      totalCorrigidas: this.estatisticas.totalCorrigidas,
      percentualCorrigidas,
      corrrecoesPorTipo
    };
  }

  public limparEstatisticas(): void {
    this.estatisticas = {
      totalProcessadas: 0,
      totalCorrigidas: 0,
      corrrecoesPorTipo: new Map<string, number>()
    };
  }
}

// Singleton para uso global
export const validacaoFlexivel = new ValidacaoFlexivel();