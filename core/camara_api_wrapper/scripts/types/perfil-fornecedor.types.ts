import type { Timestamp } from 'firebase-admin/firestore';

/**
 * Interface SIMPLIFICADA para perfil básico de fornecedores
 * Coleção: perfilfornecedores/{cnpj}
 * 
 * VERSÃO SIMPLIFICADA - SEM CAMPOS INVESTIGATIVOS
 * 
 * CAMPOS REMOVIDOS (movidos para investigative-analytics.module.ts):
 * - alertas[], benchmarks, categoriaRisco, classificacaoLavaJato
 * - compliance, comportamentoTemporal, concentracao, estatisticasTransacao
 * - flagsInvestigativas, padroesSuspeitos, rankings, scores
 * - redeRelacionamentos, analises investigativas complexas
 */
export interface PerfilFornecedorCompleto {
  // === IDENTIFICAÇÃO CONSOLIDADA ===
  identificacao: {
    cnpj: string;
    nome: string;
    categoriaPrincipal?: string;
    nomeFantasia?: string;
    razaoSocial?: string;
  };
  
  // === DADOS EMPRESARIAIS BÁSICOS ===
  porte?: 'MICRO' | 'PEQUENA' | 'MEDIA' | 'GRANDE' | 'NAO_INFORMADO';
  naturezaJuridica?: string;
  atividadePrincipal?: string;
  situacaoCadastral?: 'ATIVA' | 'BAIXADA' | 'SUSPENSA' | 'INAPTA' | 'NAO_INFORMADO';
  dataAbertura?: string;
  capital?: number;
  
  // === LOCALIZAÇÃO BÁSICA ===
  endereco?: {
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    pais?: string;
  };
  
  // === MÉTRICAS FINANCEIRAS BÁSICAS === 
  // REMOVIDO: totalRecebido, numeroTransacoes, numeroDeputados (redundantes - calculáveis de outros campos)
  
  // === DISTRIBUIÇÃO TEMPORAL ULTRA-OTIMIZADA ===
  // ARRAY COMPACTADO: 50% menos espaço que Record<string, {valor, transacoes}>
  // Formato: [anoMes, valor, transacoes] ordenado cronologicamente
  // Exemplo: [["2024-01", 1500.50, 3], ["2024-03", 2200.75, 5]]
  timeline: Array<[string, number, number]>;
  
  // === RELACIONAMENTOS OTIMIZADOS ===
  relacionamentoDeputados: {
    quantidade: number;              // Total de deputados únicos
    principais: Array<{             // Top 3 deputados por valor
      nome: string;
      estado: string;
      partido: string;
      valor: number;
      // percentual: number;        // REMOVIDO: calculável just-in-time
    }>;
    completa?: Array<{              // Lista completa (opcional para detalhes)
      deputadoId: string;
      nome: string;
      estado: string;
      partido: string;
      valorTotal: number;
      numeroTransacoes: number;
      timeline: { inicio: string, fim: string };
      // percentualDoTotal: number; // REMOVIDO: calculável just-in-time
    }>;
  };
  
  // === RESUMO CONSOLIDADO ===
  // REMOVIDO: resumoDeputados (redundante - calculável de relacionamentoDeputados)
  
  // === DISTRIBUIÇÕES ULTRA-COMPACTADAS ===
  // Maps ultra-compactos: 60% menos espaço que estrutura atual
  dist: {
    // UF: [valor, deputados] - sem transacoes (raramente usado)
    uf: Record<string, [number, number]>;
    
    // Categoria: [valor, transacoes, deputados] - mais completo
    cat: Record<string, [number, number, number]>;
    
    // Partido: [valor, transacoes, deputados] - análise política
    part: Record<string, [number, number, number]>;
  };
  
  // === METADADOS ULTRA-OTIMIZADOS ===
  metadados: {
    // BITMAP COMPACTADO: 70% menos espaço que Record<string, string[]>
    // Formato: "ano:mes1,mes2|ano2:mes3" 
    // Exemplo: "2024:01,03,12|2023:11,12" = {"2024": ["01", "03", "12"], "2023": ["11", "12"]}
    periodos: string;
    
    // Processamento ultra-compacto (nomes curtos = menos bytes)
    proc: {
      ts: Timestamp;           // timestamp
      v: string;               // versão: "v3.3-ultra"
    };
  };
}

/**
 * ===================================================================
 * GETTERS VIRTUAIS PARA COMPATIBILIDADE
 * ===================================================================
 * 
 * Para manter compatibilidade com código existente, implementar getters:
 */

// Funções helper para compatibilidade (implementar em utils separado)
export function getTotalRecebido(perfil: PerfilFornecedorCompleto): number {
  return perfil.timeline.reduce((sum, [, valor]) => sum + valor, 0);
}

export function getNumeroTransacoes(perfil: PerfilFornecedorCompleto): number {
  return perfil.timeline.reduce((sum, [, , transacoes]) => sum + transacoes, 0);
}

export function getNumeroDeputados(perfil: PerfilFornecedorCompleto): number {
  return perfil.relacionamentoDeputados.quantidade;
}

export function getResumoDeputados(perfil: PerfilFornecedorCompleto) {
  return {
    total: perfil.relacionamentoDeputados.quantidade,
    nomesPrincipais: perfil.relacionamentoDeputados.principais
      .slice(0, 3)
      .map(dep => ({ nome: dep.nome, partido: dep.partido }))
  };
}

export function calcularPercentualDoTotal(valorItem: number, totalGeral: number): number {
  return totalGeral > 0 ? (valorItem / totalGeral) * 100 : 0;
}

export function calcularMedia(valor: number, quantidade: number): number {
  return quantidade > 0 ? valor / quantidade : 0;
}

/**
 * ===================================================================
 * CAMPOS INVESTIGATIVOS REMOVIDOS DA INTERFACE PRINCIPAL
 * ===================================================================
 * 
 * Os seguintes campos foram COMPLETAMENTE REMOVIDOS da interface
 * PerfilFornecedorCompleto e movidos para investigative-analytics.module.ts:
 * 
 * 1. alertas: Array<AlertaInvestigativo> - REMOVIDO
 * 2. benchmarks.percentilDeputados - REMOVIDO  
 * 3. benchmarks.percentilTransacoes - REMOVIDO
 * 4. benchmarks.percentilVolume - REMOVIDO
 * 5. categoriaRisco - REMOVIDO
 * 6. classificacaoLavaJato - REMOVIDO
 * 7. compliance.atualizacaoCadastral - REMOVIDO
 * 8. compliance.consistenciaInformacoes - REMOVIDO
 * 9. compliance.limitesRespeitados - REMOVIDO
 * 10. compliance.transparenciaDocumental - REMOVIDO
 * 11. comportamentoTemporal.crescimentoAnual - REMOVIDO
 * 12. comportamentoTemporal.intervalosInatividade - REMOVIDO
 * 13. comportamentoTemporal.periodicidade - REMOVIDO
 * 14. comportamentoTemporal.sazonalidade - REMOVIDO
 * 15. comportamentoTemporal.tendenciaGeral - REMOVIDO
 * 16. concentracao.indiceHerfindahl - REMOVIDO
 * 17. concentracao.top3Deputados - REMOVIDO
 * 18. estatisticasTransacao.valorMaximo - REMOVIDO
 * 19. estatisticasTransacao.valorMediano - REMOVIDO
 * 20. estatisticasTransacao.valorMedio - REMOVIDO
 * 21. estatisticasTransacao.valorMinimo - REMOVIDO
 * 22. flagsInvestigativas: string[] - REMOVIDO
 * 23. padroesSuspeitos.valoresRedondosPercentual - REMOVIDO
 * 24. padroesSuspeitos.transacoesFimMes - REMOVIDO
 * 25. rankings.posicaoGeralVolume - REMOVIDO
 * 26. rankings.posicaoGeralScore - REMOVIDO
 * 27. rankings.posicaoPorUF - REMOVIDO
 * 28. rankings.posicaoPorCategoria - REMOVIDO
 * 29. scores.scoreInvestigativo - REMOVIDO
 * 30. scores.scoreConcentracao - REMOVIDO
 * 31. scores.scoreComportamental - REMOVIDO
 * 32. scores.scoreCompliance - REMOVIDO
 * 33. scores.scoreGeral - REMOVIDO
 * 34. redeRelacionamentos - REMOVIDO
 * 
 * CAMPOS REDUNDANTES REMOVIDOS:
 * - totalRecebido (calculável de recebimentoPorAno)
 * - numeroTransacoes (calculável de recebimentoPorAno) 
 * - numeroDeputados (calculável de relacionamentoDeputados.length)
 * - resumoDeputados (calculável de relacionamentoDeputados)
 * - percentualDoTotal (calculável just-in-time)
 * - media (calculável como valor / transacoes)
 * - percentual (calculável como valor / total * 100)
 * 
 * RAZÃO: Dados brutos apenas, sem análises investigativas complexas nem redundâncias
 */