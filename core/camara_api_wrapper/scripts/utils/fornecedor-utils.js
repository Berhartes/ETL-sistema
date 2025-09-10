/**
 * CommonJS version of fornecedor-utils for scripts
 * Funções helper para cálculos derivados de fornecedores
 */

/**
 * Calcula total recebido a partir da timeline compactada
 * Compatível com ambos os formatos: timeline (novo) e recebimentoPorMes (legado)
 */
function getTotalRecebido(perfil) {
  // Novo formato: timeline array compactado
  if (perfil.timeline && Array.isArray(perfil.timeline)) {
    return perfil.timeline.reduce((sum, [_, valor]) => sum + (valor || 0), 0)
  }
  
  // Formato legado: recebimentoPorMes Record (compatibilidade)
  if (perfil.recebimentoPorMes) {
    return Object.values(perfil.recebimentoPorMes).reduce(
      (sum, mes) => sum + (mes.valor || 0), 
      0
    )
  }
  
  return 0
}

/**
 * Calcula número total de transações a partir da timeline compactada
 * Compatível com ambos os formatos: timeline (novo) e recebimentoPorMes (legado)
 */
function getNumeroTransacoes(perfil) {
  // Novo formato: timeline array compactado
  if (perfil.timeline && Array.isArray(perfil.timeline)) {
    return perfil.timeline.reduce((sum, [_, __, transacoes]) => sum + (transacoes || 0), 0)
  }
  
  // Formato legado: recebimentoPorMes Record (compatibilidade)
  if (perfil.recebimentoPorMes) {
    return Object.values(perfil.recebimentoPorMes).reduce(
      (sum, mes) => sum + (mes.transacoes || 0), 
      0
    )
  }
  
  return 0
}

/**
 * Calcula número de deputados atendidos
 */
function getNumeroDeputados(perfil) {
  return perfil.relacionamentoDeputados?.quantidade || 0
}

module.exports = {
  getTotalRecebido,
  getNumeroTransacoes,
  getNumeroDeputados
}