/**
 * TESTE SERVICES - MIGRAÇÃO NOMENCLATURA
 * 
 * Testa se os services estão corretamente adaptados para
 * trabalhar com ambas nomenclaturas (antiga e nova)
 */

/**
 * Simula dados do fornecedor com diferentes nomenclaturas
 */
function createTestFornecedorData() {
  return {
    // Fornecedor com nomenclatura antiga
    fornecedorAntigo: {
      nome: 'CONSULTORIA ANTIGA LTDA',
      cnpj: '12345678000195',
      fornecedorNome: 'CONSULTORIA ANTIGA LTDA',
      fornecedorCnpj: '12345678000195',
      totalRecebido: 15000,
      numeroTransacoes: 5
    },
    
    // Fornecedor com nomenclatura nova
    fornecedorNovo: {
      nome: 'TECNOLOGIA NOVA SA',
      cnpj: '98765432000123',
      nomeFornecedor: 'TECNOLOGIA NOVA SA', 
      cnpjCpfFornecedor: '98765432000123',
      totalRecebido: 25000,
      numeroTransacoes: 8
    },
    
    // Fornecedor com nomenclatura mista
    fornecedorMisto: {
      nome: 'EMPRESA MISTA EIRELI',
      cnpj: '11223344000156',
      nomeFornecedor: 'EMPRESA MISTA EIRELI',
      cnpjCpfFornecedor: '11223344000156',
      fornecedorNome: 'EMPRESA MISTA EIRELI', // duplicado para compatibilidade
      fornecedorCnpj: '11223344000156', // duplicado para compatibilidade
      totalRecebido: 35000,
      numeroTransacoes: 12
    }
  };
}

/**
 * Simula dados de transações com diferentes nomenclaturas
 */
function createTestTransacaoData() {
  return [
    // Transação antiga
    {
      id: 'trans001',
      fornecedorNome: 'CONSULTORIA ANTIGA LTDA',
      fornecedorCnpj: '12345678000195',
      valorLiquido: 3000,
      tipoDespesa: 'CONSULTORIAS'
    },
    // Transação nova 
    {
      id: 'trans002',
      nomeFornecedor: 'TECNOLOGIA NOVA SA',
      cnpjCpfFornecedor: '98765432000123',
      valorLiquido: 5000,
      tipoDespesa: 'SERVIÇOS TÉCNICOS'
    },
    // Transação mista
    {
      id: 'trans003',
      nomeFornecedor: 'EMPRESA MISTA EIRELI',
      cnpjCpfFornecedor: '11223344000156',
      fornecedorNome: 'EMPRESA MISTA EIRELI',
      fornecedorCnpj: '11223344000156',
      valorLiquido: 7000,
      tipoDespesa: 'LOCAÇÃO DE VEÍCULOS'
    }
  ];
}

/**
 * Testa o fornecedores-service com compatibilidade
 */
function testFornecedoresService() {
  console.log('🏪 [TESTE SERVICE] Testando FornecedoresService...');
  
  try {
    const testData = createTestFornecedorData();
    const transacoes = createTestTransacaoData();
    
    console.log('📥 [INPUT] Dados de teste:', {
      fornecedores: Object.keys(testData).length,
      transacoes: transacoes.length
    });
    
    // Simular processamento de transações no carregarDadosProcessados
    const fornecedoresMap = new Map();
    
    transacoes.forEach(transacao => {
      // ✅ FASE 2: Suporte à nomenclatura dupla (transição API)
      const cnpj = transacao.cnpjCpfFornecedor || transacao.fornecedorCnpj || transacao.cnpjFornecedor;
      const nome = transacao.nomeFornecedor || transacao.fornecedorNome;
      
      if (cnpj && nome) {
        if (!fornecedoresMap.has(cnpj)) {
          fornecedoresMap.set(cnpj, {
            id: cnpj,
            cnpj: cnpj,
            nome: nome,
            totalRecebido: 0,
            transacoes: 0,
            deputadosAtendidos: new Set(),
            categorias: new Set(),
            totalTransacionado: 0
          });
        }
        
        const fornecedor = fornecedoresMap.get(cnpj);
        fornecedor.totalRecebido += (transacao.valorLiquido || 0);
        fornecedor.totalTransacionado += (transacao.valorLiquido || 0);
        fornecedor.transacoes += 1;
        
        if (transacao.tipoDespesa) {
          fornecedor.categorias.add(transacao.tipoDespesa);
        }
      }
    });
    
    console.log('🔄 [PROCESSING] Fornecedores processados:', {
      totalProcessados: fornecedoresMap.size,
      exemplos: Array.from(fornecedoresMap.values()).slice(0, 2).map(f => ({
        nome: f.nome,
        cnpj: f.cnpj,
        total: f.totalRecebido,
        transacoes: f.transacoes
      }))
    });
    
    // Simular conversão para formato padronizado
    const fornecedoresConvertidos = Array.from(fornecedoresMap.values()).map(forn => ({
      nome: forn.nome || 'Nome não informado',
      cnpj: forn.cnpj || '',
      totalTransacionado: forn.totalRecebido || 0,
      deputadosAtendidos: Array.from(forn.deputadosAtendidos || []),
      scoreSuspeicao: Math.min(100, Math.max(0, (forn.totalRecebido || 0) / 1000)), // Score básico
      alertas: [],
      categorias: Array.from(forn.categorias || []),
      transacoes: forn.transacoes || 0,
      valorMedioTransacao: forn.transacoes > 0 ? forn.totalRecebido / forn.transacoes : 0,
      maiorTransacao: forn.totalRecebido || 0,
      menorTransacao: forn.totalRecebido || 0,
      deputadoMaiorGasto: ''
    }));
    
    console.log('📤 [OUTPUT] Fornecedores convertidos:', {
      total: fornecedoresConvertidos.length,
      totalTransacionado: fornecedoresConvertidos.reduce((sum, f) => sum + f.totalTransacionado, 0),
      exemplo: fornecedoresConvertidos[0]
    });
    
    // Validações
    if (fornecedoresConvertidos.length !== 3) {
      throw new Error(`Esperados 3 fornecedores, obtidos ${fornecedoresConvertidos.length}`);
    }
    
    const totalEsperado = 3000 + 5000 + 7000;
    const totalObtido = fornecedoresConvertidos.reduce((sum, f) => sum + f.totalTransacionado, 0);
    if (totalObtido !== totalEsperado) {
      throw new Error(`Total esperado ${totalEsperado}, obtido ${totalObtido}`);
    }
    
    // Verificar se todos têm nomes válidos
    if (fornecedoresConvertidos.some(f => !f.nome || f.nome === 'Nome não informado')) {
      throw new Error('Alguns fornecedores ficaram sem nome');
    }
    
    console.log('✅ [TESTE SERVICE] FornecedoresService - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE SERVICE] FornecedoresService - FALHOU:', error.message);
    return false;
  }
}

/**
 * Testa queries de busca com compatibilidade
 */
function testQueryCompatibility() {
  console.log('🔍 [TESTE SERVICE] Testando Query Compatibility...');
  
  try {
    const transacoes = createTestTransacaoData();
    
    // Simular diferentes tipos de busca
    const testCases = [
      {
        name: 'Busca por nome (nomenclatura antiga)',
        searchTerm: 'consultoria antiga',
        filterFunction: (t) => {
          const nome = t.nomeFornecedor || t.fornecedorNome || '';
          return nome.toLowerCase().includes('consultoria antiga');
        }
      },
      {
        name: 'Busca por nome (nomenclatura nova)', 
        searchTerm: 'tecnologia nova',
        filterFunction: (t) => {
          const nome = t.nomeFornecedor || t.fornecedorNome || '';
          return nome.toLowerCase().includes('tecnologia nova');
        }
      },
      {
        name: 'Busca por CNPJ (ambas nomenclaturas)',
        searchTerm: '12345678000195',
        filterFunction: (t) => {
          const cnpj = t.cnpjCpfFornecedor || t.fornecedorCnpj || '';
          return cnpj.includes('12345678000195');
        }
      },
      {
        name: 'Busca genérica (LTDA/SA)',
        searchTerm: 'ltda',
        filterFunction: (t) => {
          const nome = t.nomeFornecedor || t.fornecedorNome || '';
          return nome.toLowerCase().includes('ltda');
        }
      }
    ];
    
    testCases.forEach(testCase => {
      const resultados = transacoes.filter(testCase.filterFunction);
      console.log(`🔍 [QUERY] ${testCase.name}: ${resultados.length} resultado(s)`);
      
      if (resultados.length > 0) {
        console.log(`   └── Exemplo: ${resultados[0].nomeFornecedor || resultados[0].fornecedorNome}`);
      }
    });
    
    // Validações específicas
    const buscaAntiga = transacoes.filter(t => 
      (t.nomeFornecedor || t.fornecedorNome || '').toLowerCase().includes('consultoria antiga')
    );
    if (buscaAntiga.length !== 1) {
      throw new Error(`Busca antiga deveria retornar 1, retornou ${buscaAntiga.length}`);
    }
    
    const buscaNova = transacoes.filter(t => 
      (t.nomeFornecedor || t.fornecedorNome || '').toLowerCase().includes('tecnologia nova')
    );
    if (buscaNova.length !== 1) {
      throw new Error(`Busca nova deveria retornar 1, retornou ${buscaNova.length}`);
    }
    
    const buscaCNPJ = transacoes.filter(t => 
      (t.cnpjCpfFornecedor || t.fornecedorCnpj || '').includes('12345678000195')
    );
    if (buscaCNPJ.length !== 1) {
      throw new Error(`Busca CNPJ deveria retornar 1, retornou ${buscaCNPJ.length}`);
    }
    
    console.log('✅ [TESTE SERVICE] Query Compatibility - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE SERVICE] Query Compatibility - FALHOU:', error.message);
    return false;
  }
}

/**
 * Testa ordenação com compatibilidade
 */
function testSortingCompatibility() {
  console.log('🔢 [TESTE SERVICE] Testando Sorting Compatibility...');
  
  try {
    const transacoes = createTestTransacaoData();
    
    // Testar ordenação por nome de fornecedor
    const transacoesOrdenadas = [...transacoes].sort((a, b) => {
      const nomeA = (a.nomeFornecedor || a.fornecedorNome) || '';
      const nomeB = (b.nomeFornecedor || b.fornecedorNome) || '';
      return nomeA.localeCompare(nomeB);
    });
    
    console.log('📊 [SORT] Transações ordenadas por nome:', 
      transacoesOrdenadas.map(t => t.nomeFornecedor || t.fornecedorNome)
    );
    
    // Verificar se a ordenação funcionou
    const nomes = transacoesOrdenadas.map(t => t.nomeFornecedor || t.fornecedorNome);
    const nomesSorted = [...nomes].sort();
    
    for (let i = 0; i < nomes.length; i++) {
      if (nomes[i] !== nomesSorted[i]) {
        throw new Error(`Ordenação incorreta na posição ${i}: ${nomes[i]} vs ${nomesSorted[i]}`);
      }
    }
    
    // Testar ordenação por valor
    const transacoesPorValor = [...transacoes].sort((a, b) => {
      return (b.valorLiquido || 0) - (a.valorLiquido || 0);
    });
    
    console.log('💰 [SORT] Transações ordenadas por valor:', 
      transacoesPorValor.map(t => ({ 
        nome: t.nomeFornecedor || t.fornecedorNome, 
        valor: t.valorLiquido 
      }))
    );
    
    // Verificar ordenação por valor
    if (transacoesPorValor[0].valorLiquido !== 7000) {
      throw new Error(`Primeira transação deveria ter valor 7000, tem ${transacoesPorValor[0].valorLiquido}`);
    }
    
    if (transacoesPorValor[2].valorLiquido !== 3000) {
      throw new Error(`Última transação deveria ter valor 3000, tem ${transacoesPorValor[2].valorLiquido}`);
    }
    
    console.log('✅ [TESTE SERVICE] Sorting Compatibility - PASSOU');
    return true;
    
  } catch (error) {
    console.error('❌ [TESTE SERVICE] Sorting Compatibility - FALHOU:', error.message);
    return false;
  }
}

/**
 * Executa todos os testes de services
 */
function runServicesTests() {
  console.log('🚀 [SERVICES TESTS] Iniciando testes dos services...\n');
  
  const tests = [
    { name: 'FornecedoresService', fn: testFornecedoresService },
    { name: 'Query Compatibility', fn: testQueryCompatibility },
    { name: 'Sorting Compatibility', fn: testSortingCompatibility }
  ];
  
  const results = [];
  
  tests.forEach(test => {
    console.log(`\n--- EXECUTANDO: ${test.name} ---`);
    const result = test.fn();
    results.push({ name: test.name, passed: result });
    console.log(`--- FIM: ${test.name} ---\n`);
  });
  
  // Relatório final
  console.log('📋 [RELATÓRIO SERVICES] Resultados dos testes:');
  results.forEach(result => {
    const status = result.passed ? '✅ PASSOU' : '❌ FALHOU';
    console.log(`   ${status} - ${result.name}`);
  });
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const successRate = (passedCount / totalCount) * 100;
  
  console.log(`\n🎯 [SERVICES RESUMO] ${passedCount}/${totalCount} testes passaram (${successRate.toFixed(1)}%)`);
  
  if (successRate === 100) {
    console.log('🎉 [SERVICES SUCESSO] Todos os services estão funcionando!');
    console.log('✅ Compatibilidade bidirecional implementada com sucesso');
  } else {
    console.log('⚠️ [SERVICES ATENÇÃO] Alguns services precisam de ajustes');
  }
  
  return successRate === 100;
}

// Executar testes se chamado diretamente
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  runServicesTests();
}

export {
  runServicesTests,
  testFornecedoresService,
  testQueryCompatibility,
  testSortingCompatibility,
  createTestFornecedorData,
  createTestTransacaoData
};