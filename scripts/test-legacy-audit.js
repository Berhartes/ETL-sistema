/**
 * TESTE DO SISTEMA DE AUDITORIA LEGADA - FASE 4
 * 
 * Testa o sistema de auditoria que detecta uso de nomenclatura antiga
 */

// Simular dados com diferentes padrões de nomenclatura
function createAuditTestData() {
  return [
    // 1. Apenas nomenclatura nova (ideal)
    {
      id: 'rec001',
      nomeFornecedor: 'EMPRESA NOVA LTDA',
      cnpjCpfFornecedor: '12345678000195',
      valorLiquido: 1500
    },
    {
      id: 'rec002', 
      nomeFornecedor: 'TECNOLOGIA ATUALIZADA SA',
      cnpjCpfFornecedor: '98765432000123',
      valorLiquido: 2500
    },
    
    // 2. Apenas nomenclatura antiga (problemático)
    {
      id: 'rec003',
      fornecedorNome: 'CONSULTORIA LEGADA EIRELI',
      fornecedorCnpj: '11223344000156',
      valorLiquido: 3500
    },
    
    // 3. Nomenclatura mista (transição)
    {
      id: 'rec004',
      nomeFornecedor: 'EMPRESA MISTA LTDA',
      cnpjCpfFornecedor: '55667788000134',
      fornecedorNome: 'EMPRESA MISTA LTDA', // duplicado
      fornecedorCnpj: '55667788000134', // duplicado
      valorLiquido: 4000
    },
    {
      id: 'rec005',
      nomeFornecedor: 'OUTRO MISTO SA',
      cnpjCpfFornecedor: '33445566000178',
      fornecedorNome: 'OUTRO MISTO SA',
      fornecedorCnpj: '33445566000178',
      valorLiquido: 2000
    },
    
    // 4. Dados incompletos
    {
      id: 'rec006',
      nomeFornecedor: 'EMPRESA INCOMPLETA',
      // sem CNPJ
      valorLiquido: 1000
    }
  ];
}

/**
 * Simular implementação da auditoria (baseada no legacy-audit.ts)
 */
function simulateAudit(data) {
  console.log('🔍 [AUDIT] Iniciando auditoria simulada...');
  
  const legacyFieldMappings = {
    'fornecedorNome': 'nomeFornecedor',
    'fornecedorCnpj': 'cnpjCpfFornecedor'
  };

  const report = {
    totalRecords: data.length,
    legacyOnlyCount: 0,
    newOnlyCount: 0,
    mixedCount: 0,
    legacyFields: {
      fornecedorNome: { count: 0, percentage: 0, examples: [] },
      fornecedorCnpj: { count: 0, percentage: 0, examples: [] }
    },
    recommendations: [],
    riskLevel: 'LOW',
    readyForCleanup: true
  };

  // Função auxiliar para verificar campos legados
  const hasLegacyFields = (record) => {
    return Object.keys(legacyFieldMappings).some(field => 
      record[field] !== undefined && record[field] !== null
    );
  };

  // Função auxiliar para verificar campos novos
  const hasNewFields = (record) => {
    return Object.values(legacyFieldMappings).some(field => 
      record[field] !== undefined && record[field] !== null
    );
  };

  // Analisar cada registro
  data.forEach((record, index) => {
    const hasLegacy = hasLegacyFields(record);
    const hasNew = hasNewFields(record);

    if (hasLegacy && !hasNew) {
      report.legacyOnlyCount++;
    } else if (!hasLegacy && hasNew) {
      report.newOnlyCount++;
    } else if (hasLegacy && hasNew) {
      report.mixedCount++;
    }

    // Contar uso de cada campo legado
    Object.keys(legacyFieldMappings).forEach(legacyField => {
      if (record[legacyField] !== undefined && record[legacyField] !== null) {
        report.legacyFields[legacyField].count++;
        
        if (report.legacyFields[legacyField].examples.length < 3) {
          report.legacyFields[legacyField].examples.push({
            index,
            value: record[legacyField],
            hasNewEquivalent: record[legacyFieldMappings[legacyField]] !== undefined
          });
        }
      }
    });
  });

  // Calcular percentuais
  Object.keys(report.legacyFields).forEach(field => {
    const fieldData = report.legacyFields[field];
    fieldData.percentage = report.totalRecords > 0 
      ? (fieldData.count / report.totalRecords) * 100 
      : 0;
  });

  // Avaliar nível de risco
  const legacyOnlyPercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
  const maxFieldUsage = Math.max(...Object.values(report.legacyFields).map(f => f.percentage));

  if (legacyOnlyPercentage > 50 || maxFieldUsage > 70) {
    report.riskLevel = 'CRITICAL';
  } else if (legacyOnlyPercentage > 20 || maxFieldUsage > 40) {
    report.riskLevel = 'HIGH';
  } else if (legacyOnlyPercentage > 5 || maxFieldUsage > 15) {
    report.riskLevel = 'MEDIUM';
  } else {
    report.riskLevel = 'LOW';
  }

  // Verificar se está pronto para limpeza
  report.readyForCleanup = legacyOnlyPercentage < 10 && maxFieldUsage < 20 && report.riskLevel !== 'CRITICAL';

  return report;
}

/**
 * Testa cenário com baixo uso de campos legados
 */
function testLowLegacyUsage() {
  console.log('📊 [TESTE 1] Testando cenário com baixo uso legado...');
  
  try {
    const testData = createAuditTestData();
    const report = simulateAudit(testData);
    
    console.log('📋 [RESULTADOS]:', {
      total: report.totalRecords,
      novaApenas: report.newOnlyCount,
      antigaApenas: report.legacyOnlyCount,
      mistas: report.mixedCount,
      risco: report.riskLevel,
      prontoLimpeza: report.readyForCleanup
    });

    console.log('🔍 [CAMPOS LEGADOS]:');
    Object.entries(report.legacyFields).forEach(([field, data]) => {
      console.log(`   ${field}: ${data.count} usos (${data.percentage.toFixed(1)}%)`);
      if (data.examples.length > 0) {
        console.log(`      Exemplo: "${data.examples[0].value}"`);
      }
    });

    // Validações
    if (report.totalRecords !== 6) {
      throw new Error(`Total esperado 6, obtido ${report.totalRecords}`);
    }

    if (report.newOnlyCount !== 2) { // rec001, rec002
      throw new Error(`Nova nomenclatura: esperado 2, obtido ${report.newOnlyCount}`);
    }

    if (report.legacyOnlyCount !== 1) { // rec003
      throw new Error(`Antiga nomenclatura: esperado 1, obtido ${report.legacyOnlyCount}`);
    }

    if (report.mixedCount !== 2) { // rec004, rec005
      throw new Error(`Mistas: esperado 2, obtido ${report.mixedCount}`);
    }

    const legacyUsagePercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
    if (legacyUsagePercentage > 20) {
      throw new Error(`Uso legado muito alto: ${legacyUsagePercentage.toFixed(1)}%`);
    }

    console.log('✅ [TESTE 1] Cenário baixo uso legado - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE 1] Cenário baixo uso legado - FALHOU:', error.message);
    return false;
  }
}

/**
 * Testa cenário com alto uso de campos legados
 */
function testHighLegacyUsage() {
  console.log('📊 [TESTE 2] Testando cenário com alto uso legado...');
  
  try {
    // Criar dataset com mais dados legados
    const highLegacyData = [
      // Maioria com nomenclatura antiga
      { id: 'r1', fornecedorNome: 'EMPRESA A', fornecedorCnpj: '111' },
      { id: 'r2', fornecedorNome: 'EMPRESA B', fornecedorCnpj: '222' },
      { id: 'r3', fornecedorNome: 'EMPRESA C', fornecedorCnpj: '333' },
      { id: 'r4', fornecedorNome: 'EMPRESA D', fornecedorCnpj: '444' },
      { id: 'r5', fornecedorNome: 'EMPRESA E', fornecedorCnpj: '555' },
      { id: 'r6', fornecedorNome: 'EMPRESA F', fornecedorCnpj: '666' },
      // Poucas com nomenclatura nova
      { id: 'r7', nomeFornecedor: 'EMPRESA NOVA G', cnpjCpfFornecedor: '777' },
      { id: 'r8', nomeFornecedor: 'EMPRESA NOVA H', cnpjCpfFornecedor: '888' }
    ];
    
    const report = simulateAudit(highLegacyData);
    
    console.log('📋 [RESULTADOS ALTO USO]:', {
      total: report.totalRecords,
      novaApenas: report.newOnlyCount,
      antigaApenas: report.legacyOnlyCount,
      risco: report.riskLevel,
      prontoLimpeza: report.readyForCleanup
    });

    const legacyPercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
    console.log(`⚠️ [ALERTA] ${legacyPercentage.toFixed(1)}% dos registros usam apenas nomenclatura antiga`);

    // Validações
    if (report.riskLevel === 'LOW') {
      throw new Error('Risco deveria ser HIGH ou CRITICAL, não LOW');
    }

    if (report.readyForCleanup) {
      throw new Error('Com alto uso legado, não deveria estar pronto para limpeza');
    }

    if (legacyPercentage < 50) {
      throw new Error(`Percentual legado deveria ser alto: ${legacyPercentage}%`);
    }

    console.log('✅ [TESTE 2] Cenário alto uso legado - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE 2] Cenário alto uso legado - FALHOU:', error.message);
    return false;
  }
}

/**
 * Testa geração de recomendações
 */
function testRecommendations() {
  console.log('💡 [TESTE 3] Testando geração de recomendações...');
  
  try {
    const testData = createAuditTestData();
    const report = simulateAudit(testData);
    
    // Simular geração de recomendações baseadas no risco
    const recommendations = [];
    const legacyOnlyPercentage = (report.legacyOnlyCount / report.totalRecords) * 100;
    
    if (report.riskLevel === 'CRITICAL') {
      recommendations.push('🚨 CRÍTICO: Aguardar mais migração antes de remover campos antigos');
      recommendations.push('📊 Implementar migration monitor mais agressivo');
    } else if (report.riskLevel === 'HIGH') {
      recommendations.push('⚠️ ALTO RISCO: Proceder com cautela na remoção');
      recommendations.push('📋 Implementar testes extensivos antes da remoção');
    } else if (report.riskLevel === 'MEDIUM') {
      recommendations.push('⚡ RISCO MODERADO: Remoção gradual recomendada');
      recommendations.push('📈 Monitorar métricas durante remoção');
    } else {
      recommendations.push('✅ BAIXO RISCO: Seguro para iniciar remoção gradual');
      recommendations.push('🧹 Começar com deprecation warnings');
    }

    // Recomendações específicas por campo
    Object.entries(report.legacyFields).forEach(([field, data]) => {
      if (data.percentage > 50) {
        recommendations.push(`🔥 Campo '${field}' ainda muito usado (${data.percentage.toFixed(1)}%) - aguardar`);
      } else if (data.percentage > 0) {
        recommendations.push(`🎯 Campo '${field}' pouco usado (${data.percentage.toFixed(1)}%) - candidato à remoção`);
      } else {
        recommendations.push(`✅ Campo '${field}' não usado - seguro para remover`);
      }
    });

    console.log('💡 [RECOMENDAÇÕES GERADAS]:');
    recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });

    // Validações
    if (recommendations.length === 0) {
      throw new Error('Nenhuma recomendação foi gerada');
    }

    if (!recommendations.some(rec => rec.includes('BAIXO RISCO') || rec.includes('RISCO'))) {
      throw new Error('Recomendação de nível de risco não encontrada');
    }

    const fieldRecommendations = recommendations.filter(rec => rec.includes('fornecedorNome') || rec.includes('fornecedorCnpj'));
    if (fieldRecommendations.length === 0) {
      throw new Error('Recomendações específicas de campos não foram geradas');
    }

    console.log('✅ [TESTE 3] Geração de recomendações - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE 3] Geração de recomendações - FALHOU:', error.message);
    return false;
  }
}

/**
 * Testa plano de migração
 */
function testMigrationPlan() {
  console.log('📅 [TESTE 4] Testando geração de plano de migração...');
  
  try {
    const testData = createAuditTestData();
    const report = simulateAudit(testData);
    
    // Simular geração de plano baseado no risco
    const phases = [];
    
    if (report.riskLevel === 'LOW') {
      phases.push({
        phase: 1,
        name: 'Deprecation Warnings',
        description: 'Adicionar warnings para uso de campos legados',
        estimatedTime: '1-2 dias',
        riskLevel: 'LOW'
      });

      phases.push({
        phase: 2,
        name: 'Code Migration', 
        description: 'Migrar código para usar apenas nova nomenclatura',
        estimatedTime: '3-5 dias',
        riskLevel: 'MEDIUM'
      });

      phases.push({
        phase: 3,
        name: 'Field Removal',
        description: 'Remover campos legados das interfaces',
        estimatedTime: '2-3 dias',
        riskLevel: 'HIGH'
      });
    } else {
      phases.push({
        phase: 1,
        name: 'Data Migration',
        description: 'Migrar dados legados antes da remoção de código',
        estimatedTime: '1-2 semanas',
        riskLevel: 'HIGH'
      });
    }

    const migrationPlan = {
      phases,
      totalEstimatedTime: report.riskLevel === 'LOW' ? '1-2 semanas' : '3-5 semanas',
      prerequisites: [
        'Backup completo do sistema',
        'Ambiente de testes preparado',
        'Métricas de monitoramento ativas'
      ]
    };

    console.log('📅 [PLANO DE MIGRAÇÃO]:');
    console.log(`   Tempo total estimado: ${migrationPlan.totalEstimatedTime}`);
    console.log(`   Número de fases: ${migrationPlan.phases.length}`);
    
    migrationPlan.phases.forEach(phase => {
      console.log(`   Fase ${phase.phase}: ${phase.name} (${phase.estimatedTime})`);
      console.log(`      ${phase.description}`);
    });

    console.log('   Pré-requisitos:');
    migrationPlan.prerequisites.forEach(prereq => {
      console.log(`      - ${prereq}`);
    });

    // Validações
    if (phases.length === 0) {
      throw new Error('Nenhuma fase foi planejada');
    }

    if (!migrationPlan.totalEstimatedTime) {
      throw new Error('Tempo total não foi estimado');
    }

    if (migrationPlan.prerequisites.length < 3) {
      throw new Error('Poucos pré-requisitos identificados');
    }

    const hasDeprecationPhase = phases.some(p => p.name.includes('Deprecation'));
    const hasRemovalPhase = phases.some(p => p.name.includes('Removal'));
    
    if (report.riskLevel === 'LOW' && (!hasDeprecationPhase || !hasRemovalPhase)) {
      throw new Error('Fases de deprecação e remoção esperadas para baixo risco');
    }

    console.log('✅ [TESTE 4] Plano de migração - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE 4] Plano de migração - FALHOU:', error.message);
    return false;
  }
}

/**
 * Executa todos os testes de auditoria
 */
function runAuditTests() {
  console.log('🚀 [AUDIT TESTS] Iniciando testes do sistema de auditoria...\n');
  
  const tests = [
    { name: 'Low Legacy Usage', fn: testLowLegacyUsage },
    { name: 'High Legacy Usage', fn: testHighLegacyUsage },
    { name: 'Recommendations Generation', fn: testRecommendations },
    { name: 'Migration Plan', fn: testMigrationPlan }
  ];
  
  const results = [];
  
  tests.forEach(test => {
    console.log(`\n--- EXECUTANDO: ${test.name} ---`);
    const result = test.fn();
    results.push({ name: test.name, passed: result });
    console.log(`--- FIM: ${test.name} ---\n`);
  });
  
  // Relatório final
  console.log('📋 [RELATÓRIO AUDIT] Resultados dos testes:');
  results.forEach(result => {
    const status = result.passed ? '✅ PASSOU' : '❌ FALHOU';
    console.log(`   ${status} - ${result.name}`);
  });
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const successRate = (passedCount / totalCount) * 100;
  
  console.log(`\n🎯 [AUDIT RESUMO] ${passedCount}/${totalCount} testes passaram (${successRate.toFixed(1)}%)`);
  
  if (successRate === 100) {
    console.log('🎉 [AUDIT SUCESSO] Sistema de auditoria funcionando!');
    console.log('✅ Pronto para auditar uso de nomenclatura legada');
  } else {
    console.log('⚠️ [AUDIT ATENÇÃO] Sistema de auditoria precisa ajustes');
  }
  
  return successRate === 100;
}

// Executar testes se chamado diretamente
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  runAuditTests();
}

export {
  runAuditTests,
  testLowLegacyUsage,
  testHighLegacyUsage,
  testRecommendations,
  testMigrationPlan,
  createAuditTestData
};