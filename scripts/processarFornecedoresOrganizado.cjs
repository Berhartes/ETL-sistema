/**
 * Script para processar e organizar dados de fornecedores no Firestore
 * 
 * Este script:
 * 1. Busca todos os deputados e suas despesas espalhadas no Firestore
 * 2. Agrega dados por CNPJ de fornecedor
 * 3. Calcula métricas e scores de suspeição
 * 4. Armazena na coleção 'perfisFornecedores' otimizada
 * 
 * Uso: npm run process:fornecedores-organizado
 */

const admin = require('firebase-admin');
const path = require('path');

// Configuração do Firebase Admin
const serviceAccount = require('../config/serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();

// Configurações
const CONFIG = {
  LEGISLATURA_ATUAL: '57',
  ANOS_PROCESSAMENTO: [2022, 2023, 2024, 2025],
  BATCH_SIZE: 500, // Tamanho do lote para processamento
  MIN_VALOR_TRANSACAO: 1, // Valor mínimo para considerar transação
  SCORE_THRESHOLDS: {
    POUCOS_DEPUTADOS_CRITICO: 2,
    POUCOS_DEPUTADOS_MEDIO: 5,
    VALOR_ALTO_TRANSACAO: 20000,
    VALOR_MUITO_ALTO: 50000,
    VOLUME_ALTO_CONCENTRADO: 100000
  }
};

/**
 * Converte valor para número
 */
function parseValor(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') {
    const parsed = parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.'));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Calcula score de suspeição para um fornecedor
 */
function calcularScoreSuspeicao(fornecedor) {
  let score = 0;
  const { numDeputados, mediaTransacao, volumeTotal, numTransacoes } = fornecedor;

  // 1. Concentração de deputados (40 pontos máximo)
  if (numDeputados <= CONFIG.SCORE_THRESHOLDS.POUCOS_DEPUTADOS_CRITICO) {
    score += 40;
  } else if (numDeputados <= CONFIG.SCORE_THRESHOLDS.POUCOS_DEPUTADOS_MEDIO) {
    score += 20;
  }

  // 2. Valor médio por transação (30 pontos máximo)
  if (mediaTransacao >= CONFIG.SCORE_THRESHOLDS.VALOR_MUITO_ALTO) {
    score += 30;
  } else if (mediaTransacao >= CONFIG.SCORE_THRESHOLDS.VALOR_ALTO_TRANSACAO) {
    score += 15;
  }

  // 3. Volume alto com concentração (30 pontos máximo)
  if (volumeTotal >= CONFIG.SCORE_THRESHOLDS.VOLUME_ALTO_CONCENTRADO && numDeputados <= 3) {
    score += 30;
  } else if (volumeTotal >= CONFIG.SCORE_THRESHOLDS.VOLUME_ALTO_CONCENTRADO) {
    score += 15;
  }

  // 4. Padrões suspeitos adicionais (20 pontos máximo)
  const ratioVolumeDeputados = volumeTotal / numDeputados;
  if (ratioVolumeDeputados > 200000) {
    score += 20;
  } else if (ratioVolumeDeputados > 100000) {
    score += 10;
  }

  // 5. Frequência vs Volume (10 pontos máximo)
  if (numTransacoes < 5 && volumeTotal > 50000) {
    score += 10; // Poucas transações com volume alto
  }

  return Math.min(score, 100); // Máximo 100
}

/**
 * Gera alertas baseados no score e métricas
 */
function gerarAlertas(fornecedor, score) {
  const alertas = [];
  const { numDeputados, mediaTransacao, volumeTotal, numTransacoes } = fornecedor;

  if (score >= 80) alertas.push('Suspeição crítica - investigar urgentemente');
  if (score >= 60) alertas.push('Padrão suspeito detectado');
  
  if (numDeputados === 1) {
    alertas.push('Fornecedor exclusivo de um deputado');
  } else if (numDeputados <= 2) {
    alertas.push('Atende muito poucos deputados');
  }

  if (mediaTransacao >= CONFIG.SCORE_THRESHOLDS.VALOR_MUITO_ALTO) {
    alertas.push('Valores muito altos por transação');
  } else if (mediaTransacao >= CONFIG.SCORE_THRESHOLDS.VALOR_ALTO_TRANSACAO) {
    alertas.push('Valores acima da média por transação');
  }

  if (volumeTotal >= CONFIG.SCORE_THRESHOLDS.VOLUME_ALTO_CONCENTRADO && numDeputados <= 3) {
    alertas.push('Alto volume concentrado em poucos deputados');
  }

  if (numTransacoes < 5 && volumeTotal > 50000) {
    alertas.push('Poucas transações com volume alto');
  }

  const ratioVolumeDeputados = volumeTotal / numDeputados;
  if (ratioVolumeDeputados > 200000) {
    alertas.push('Volume muito alto por deputado atendido');
  }

  return alertas;
}

/**
 * Busca todos os deputados da legislatura atual
 */
async function buscarDeputados() {
  console.log(`📋 Buscando deputados da legislatura ${CONFIG.LEGISLATURA_ATUAL}...`);
  
  const deputadosRef = db.collection(`congressoNacional/camaraDeputados/legislatura/${CONFIG.LEGISLATURA_ATUAL}/deputados`);
  const snapshot = await deputadosRef.get();
  
  const deputados = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    deputados.push({
      id: doc.id,
      nome: data.nome || data.nomeCivil || `Deputado ${doc.id}`,
      partido: data.siglaPartido || 'N/A',
      uf: data.siglaUf || 'N/A'
    });
  });

  console.log(`✅ ${deputados.length} deputados encontrados`);
  return deputados;
}

/**
 * Busca despesas de um deputado em um ano específico
 */
async function buscarDespesasDeputado(deputadoId, ano) {
  const despesas = [];
  
  for (let mes = 1; mes <= 12; mes++) {
    const mesStr = String(mes).padStart(2, '0');
    const despesasPath = `congressoNacional/camaraDeputados/perfilComplementar/despesas/${deputadoId}/ano/${ano}/mes/${mesStr}/all_despesas`;
    
    try {
      const despesasDoc = await db.doc(despesasPath).get();
      
      if (despesasDoc.exists) {
        const data = despesasDoc.data();
        if (data && Array.isArray(data.despesas)) {
          despesas.push(...data.despesas);
        }
      }
    } catch (error) {
      // Ignorar erros de documentos inexistentes
    }
  }

  return despesas;
}

/**
 * Processa dados de fornecedores agregando por CNPJ
 */
async function processarFornecedores() {
  console.log('🔄 Iniciando processamento de fornecedores...');
  
  const deputados = await buscarDeputados();
  const fornecedoresMap = new Map();
  let totalDespesasProcessadas = 0;
  let deputadosProcessados = 0;

  console.log(`📊 Processando despesas de ${deputados.length} deputados para os anos: ${CONFIG.ANOS_PROCESSAMENTO.join(', ')}`);

  // Processar cada deputado
  for (const deputado of deputados) {
    console.log(`👤 Processando ${deputado.nome} (${++deputadosProcessados}/${deputados.length})`);
    
    // Processar cada ano
    for (const ano of CONFIG.ANOS_PROCESSAMENTO) {
      const despesas = await buscarDespesasDeputado(deputado.id, ano);
      
      if (despesas.length > 0) {
        console.log(`  📅 ${ano}: ${despesas.length} despesas encontradas`);
        totalDespesasProcessadas += despesas.length;
      }

      // Processar cada despesa
      despesas.forEach(despesa => {
        const cnpj = despesa.cnpjCpfFornecedor?.trim();
        const nomeFornecedor = despesa.nomeFornecedor?.trim();
        const valor = parseValor(despesa.valorLiquido);
        const categoria = despesa.tipoDespesa || 'Não especificado';
        const dataDocumento = despesa.dataDocumento;

        // Validar dados mínimos
        if (!cnpj || cnpj.length < 11 || cnpj === '00000000000000' || valor < CONFIG.MIN_VALOR_TRANSACAO) {
          return;
        }

        // Inicializar fornecedor se não existe
        if (!fornecedoresMap.has(cnpj)) {
          fornecedoresMap.set(cnpj, {
            cnpj,
            nome: nomeFornecedor || 'Nome não informado',
            valorTotalGasto: 0,
            quantidadeTransacoes: 0,
            deputadosAtendidos: new Set(),
            deputadosPorValor: {},
            categoriasGasto: new Set(),
            transacoesPorAno: {},
            primeiraTransacao: null,
            ultimaTransacao: null,
            valores: [] // Para calcular estatísticas
          });
        }

        const fornecedor = fornecedoresMap.get(cnpj);
        
        // Atualizar dados do fornecedor
        fornecedor.valorTotalGasto += valor;
        fornecedor.quantidadeTransacoes += 1;
        fornecedor.deputadosAtendidos.add(deputado.nome);
        fornecedor.categoriasGasto.add(categoria);
        fornecedor.valores.push(valor);

        // Somar por deputado
        if (!fornecedor.deputadosPorValor[deputado.nome]) {
          fornecedor.deputadosPorValor[deputado.nome] = 0;
        }
        fornecedor.deputadosPorValor[deputado.nome] += valor;

        // Somar por ano
        if (!fornecedor.transacoesPorAno[ano]) {
          fornecedor.transacoesPorAno[ano] = { valor: 0, quantidade: 0 };
        }
        fornecedor.transacoesPorAno[ano].valor += valor;
        fornecedor.transacoesPorAno[ano].quantidade += 1;

        // Atualizar datas
        if (dataDocumento) {
          const data = new Date(dataDocumento);
          if (!fornecedor.primeiraTransacao || data < new Date(fornecedor.primeiraTransacao)) {
            fornecedor.primeiraTransacao = dataDocumento;
          }
          if (!fornecedor.ultimaTransacao || data > new Date(fornecedor.ultimaTransacao)) {
            fornecedor.ultimaTransacao = dataDocumento;
          }
        }
      });
    }

    // Log a cada 50 deputados processados
    if (deputadosProcessados % 50 === 0) {
      console.log(`📈 Progresso: ${deputadosProcessados}/${deputados.length} deputados - ${fornecedoresMap.size} fornecedores únicos encontrados`);
    }
  }

  console.log(`\n📊 Processamento concluído:`);
  console.log(`   • ${totalDespesasProcessadas} despesas processadas`);
  console.log(`   • ${fornecedoresMap.size} fornecedores únicos encontrados`);

  return fornecedoresMap;
}

/**
 * Calcula estatísticas finais e scores para cada fornecedor
 */
function calcularEstatisticasFinais(fornecedoresMap) {
  console.log('🧮 Calculando estatísticas finais...');
  
  const fornecedoresProcessados = [];

  fornecedoresMap.forEach((fornecedor, cnpj) => {
    // Converter Sets para Arrays
    const deputadosAtendidos = Array.from(fornecedor.deputadosAtendidos);
    const categoriasGasto = Array.from(fornecedor.categoriasGasto);
    
    // Calcular estatísticas
    const valores = fornecedor.valores.sort((a, b) => a - b);
    const numDeputados = deputadosAtendidos.length;
    const numTransacoes = fornecedor.quantidadeTransacoes;
    const volumeTotal = fornecedor.valorTotalGasto;
    const mediaTransacao = volumeTotal / numTransacoes;

    // Estatísticas de valores
    const valorMinimo = valores[0];
    const valorMaximo = valores[valores.length - 1];
    const valorMediano = valores[Math.floor(valores.length / 2)];

    // Encontrar deputado com maior gasto
    const deputadoMaiorGasto = Object.entries(fornecedor.deputadosPorValor)
      .reduce((maior, atual) => atual[1] > maior[1] ? atual : maior, ['', 0]);

    // Calcular score de suspeição
    const metricas = { numDeputados, mediaTransacao, volumeTotal, numTransacoes };
    const indiceSuspeicao = calcularScoreSuspeicao(metricas);
    
    // Gerar alertas
    const alertas = gerarAlertas(metricas, indiceSuspeicao);

    // Criar objeto final com campos compatíveis com a página
    const fornecedorFinal = {
      cnpj,
      nome: fornecedor.nome,
      
      // Campos principais (nomenclatura compatível com a página)
      totalRecebido: volumeTotal, // Página busca totalRecebido
      valorTotalGasto: volumeTotal, // Manter para compatibilidade
      numTransacoes: numTransacoes, // Página busca numTransacoes  
      quantidadeTransacoes: numTransacoes, // Manter para compatibilidade
      
      // Deputados (formato otimizado)
      deputadosAtendidos,
      deputadosNomes: deputadosAtendidos, // Alias para compatibilidade
      deputadosPorValor: fornecedor.deputadosPorValor,
      
      // Categorias (formato compatível)
      categorias: categoriasGasto, // Página busca categorias
      categoriasGasto, // Manter para compatibilidade
      
      // Estatísticas de transações (campos que a página busca)
      mediaTransacao: Math.round(mediaTransacao * 100) / 100,
      valorMedioTransacao: Math.round(mediaTransacao * 100) / 100, // Alias
      maiorTransacao: valorMaximo, // Página busca maiorTransacao
      menorTransacao: valorMinimo, // Página busca menorTransacao
      valorMinimo, // Manter original
      valorMaximo, // Manter original
      valorMediano,
      
      // Análise de deputados
      deputadoMaiorGasto: {
        nome: deputadoMaiorGasto[0],
        valor: deputadoMaiorGasto[1]
      },
      
      // Score e alertas (campos que a página usa)
      indiceSuspeicao,
      scoreSuspeicao: indiceSuspeicao, // Alias para compatibilidade
      alertas,
      razoesSuspeita: alertas, // Alias para compatibilidade
      
      // Dados temporais
      transacoesPorAno: fornecedor.transacoesPorAno,
      primeiraTransacao: fornecedor.primeiraTransacao,
      ultimaTransacao: fornecedor.ultimaTransacao,
      
      // Metadados
      processadoEm: new Date().toISOString(),
      versaoProcessamento: '2.0'
    };

    fornecedoresProcessados.push(fornecedorFinal);
  });

  // Ordenar por volume total (maior para menor)
  fornecedoresProcessados.sort((a, b) => b.valorTotalGasto - a.valorTotalGasto);

  console.log(`✅ Estatísticas calculadas para ${fornecedoresProcessados.length} fornecedores`);
  
  // Log estatísticas gerais
  const totalVolume = fornecedoresProcessados.reduce((sum, f) => sum + f.valorTotalGasto, 0);
  const fornecedoresSuspeitos = fornecedoresProcessados.filter(f => f.indiceSuspeicao >= 50);
  const fornecedoresCriticos = fornecedoresProcessados.filter(f => f.indiceSuspeicao >= 80);
  
  console.log(`📈 Estatísticas gerais:`);
  console.log(`   • Volume total: R$ ${totalVolume.toLocaleString('pt-BR')}`);
  console.log(`   • Fornecedores suspeitos (≥50): ${fornecedoresSuspeitos.length}`);
  console.log(`   • Fornecedores críticos (≥80): ${fornecedoresCriticos.length}`);
  console.log(`   • Top 5 por volume:`);
  
  fornecedoresProcessados.slice(0, 5).forEach((f, i) => {
    console.log(`     ${i + 1}. ${f.nome} - R$ ${f.valorTotalGasto.toLocaleString('pt-BR')} (Score: ${f.indiceSuspeicao})`);
  });

  return fornecedoresProcessados;
}

/**
 * Salva fornecedores na coleção otimizada do Firestore
 */
async function salvarFornecedoresFirestore(fornecedores) {
  console.log(`💾 Salvando ${fornecedores.length} fornecedores no Firestore...`);
  
  let batch = db.batch();
  let batchCount = 0;
  let totalSalvos = 0;

  for (const fornecedor of fornecedores) {
    const docRef = db.collection('perfisFornecedores').doc(fornecedor.cnpj);
    batch.set(docRef, fornecedor);
    batchCount++;

    // Commit a cada 500 documentos (limite do Firestore)
    if (batchCount >= CONFIG.BATCH_SIZE) {
      await batch.commit();
      totalSalvos += batchCount;
      console.log(`   💾 ${totalSalvos} fornecedores salvos...`);
      
      // Criar novo batch após commit
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Commit final se houver documentos restantes
  if (batchCount > 0) {
    await batch.commit();
    totalSalvos += batchCount;
  }

  console.log(`✅ ${totalSalvos} fornecedores salvos na coleção 'perfisFornecedores'`);
}

/**
 * Cria índices otimizados para a página de fornecedores
 */
async function criarIndicesOtimizados(fornecedores) {
  console.log('🗂️ Criando índices otimizados...');
  
  // 1. Ranking por volume (Top fornecedores)
  const rankingVolume = fornecedores
    .slice(0, 100) // Top 100
    .map((f, index) => ({
      posicao: index + 1,
      cnpj: f.cnpj,
      nome: f.nome,
      totalRecebido: f.totalRecebido,
      indiceSuspeicao: f.indiceSuspeicao,
      numDeputados: f.deputadosAtendidos.length
    }));

  // 2. Ranking por suspeição (Top suspeitos)
  const rankingSuspeicao = fornecedores
    .filter(f => f.indiceSuspeicao >= 30)
    .sort((a, b) => b.indiceSuspeicao - a.indiceSuspeicao)
    .slice(0, 100)
    .map((f, index) => ({
      posicao: index + 1,
      cnpj: f.cnpj,
      nome: f.nome,
      indiceSuspeicao: f.indiceSuspeicao,
      totalRecebido: f.totalRecebido,
      alertas: f.alertas
    }));

  // 3. Estatísticas por categoria
  const estatisticasCategorias = {};
  fornecedores.forEach(f => {
    f.categorias.forEach(categoria => {
      if (!estatisticasCategorias[categoria]) {
        estatisticasCategorias[categoria] = {
          categoria,
          totalFornecedores: 0,
          volumeTotal: 0,
          fornecedoresSuspeitos: 0
        };
      }
      estatisticasCategorias[categoria].totalFornecedores++;
      estatisticasCategorias[categoria].volumeTotal += f.totalRecebido;
      if (f.indiceSuspeicao >= 50) {
        estatisticasCategorias[categoria].fornecedoresSuspeitos++;
      }
    });
  });

  // 4. Cache de deputados mais ativos
  const deputadosRanking = {};
  fornecedores.forEach(f => {
    f.deputadosAtendidos.forEach(deputado => {
      if (!deputadosRanking[deputado]) {
        deputadosRanking[deputado] = {
          nome: deputado,
          fornecedoresAtendidos: 0,
          volumeTotal: 0
        };
      }
      deputadosRanking[deputado].fornecedoresAtendidos++;
      deputadosRanking[deputado].volumeTotal += (f.deputadosPorValor[deputado] || 0);
    });
  });

  const topDeputados = Object.values(deputadosRanking)
    .sort((a, b) => b.volumeTotal - a.volumeTotal)
    .slice(0, 50);

  // Salvar índices
  const indices = {
    rankingVolume,
    rankingSuspeicao,
    estatisticasCategorias: Object.values(estatisticasCategorias)
      .sort((a, b) => b.volumeTotal - a.volumeTotal),
    topDeputados,
    geradoEm: new Date().toISOString()
  };

  await db.collection('indicesFornecedores').doc('rankings').set(indices);
  console.log(`📈 Índices criados: ${rankingVolume.length} top volume, ${rankingSuspeicao.length} top suspeitos`);
  
  return indices;
}

/**
 * Cria estruturas otimizadas para filtros da página
 */
async function criarEstruturasFiltragem(fornecedores) {
  console.log('🔍 Criando estruturas para filtragem otimizada...');
  
  // 1. Listas para filtros
  const todosCNPJs = fornecedores.map(f => ({ cnpj: f.cnpj, nome: f.nome }));
  const todasCategorias = [...new Set(fornecedores.flatMap(f => f.categorias))].sort();
  const todosDeputados = [...new Set(fornecedores.flatMap(f => f.deputadosAtendidos))].sort();
  
  // 2. Fornecedores por faixas de valor
  const faixasValor = {
    ate10k: fornecedores.filter(f => f.totalRecebido <= 10000),
    entre10k50k: fornecedores.filter(f => f.totalRecebido > 10000 && f.totalRecebido <= 50000),
    entre50k100k: fornecedores.filter(f => f.totalRecebido > 50000 && f.totalRecebido <= 100000),
    acima100k: fornecedores.filter(f => f.totalRecebido > 100000)
  };
  
  // 3. Fornecedores por score
  const faixasScore = {
    baixo: fornecedores.filter(f => f.indiceSuspeicao < 40),
    medio: fornecedores.filter(f => f.indiceSuspeicao >= 40 && f.indiceSuspeicao < 70),
    alto: fornecedores.filter(f => f.indiceSuspeicao >= 70)
  };
  
  // 4. Fornecedores por número de deputados
  const faixasDeputados = {
    um: fornecedores.filter(f => f.deputadosAtendidos.length === 1),
    dois_tres: fornecedores.filter(f => f.deputadosAtendidos.length >= 2 && f.deputadosAtendidos.length <= 3),
    quatro_dez: fornecedores.filter(f => f.deputadosAtendidos.length >= 4 && f.deputadosAtendidos.length <= 10),
    acima_dez: fornecedores.filter(f => f.deputadosAtendidos.length > 10)
  };

  // 5. Fornecedores com alertas específicos
  const alertasComuns = [...new Set(fornecedores.flatMap(f => f.alertas))];
  const fornecedoresPorAlerta = {};
  alertasComuns.forEach(alerta => {
    fornecedoresPorAlerta[alerta] = fornecedores.filter(f => f.alertas.includes(alerta));
  });

  const estruturas = {
    listas: {
      todosCNPJs,
      todasCategorias,
      todosDeputados,
      alertasComuns
    },
    faixas: {
      valor: Object.keys(faixasValor).reduce((acc, key) => {
        acc[key] = { 
          total: faixasValor[key].length,
          cnpjs: faixasValor[key].map(f => f.cnpj)
        };
        return acc;
      }, {}),
      score: Object.keys(faixasScore).reduce((acc, key) => {
        acc[key] = { 
          total: faixasScore[key].length,
          cnpjs: faixasScore[key].map(f => f.cnpj)
        };
        return acc;
      }, {}),
      deputados: Object.keys(faixasDeputados).reduce((acc, key) => {
        acc[key] = { 
          total: faixasDeputados[key].length,
          cnpjs: faixasDeputados[key].map(f => f.cnpj)
        };
        return acc;
      }, {})
    },
    alertas: Object.keys(fornecedoresPorAlerta).reduce((acc, alerta) => {
      acc[alerta] = {
        total: fornecedoresPorAlerta[alerta].length,
        cnpjs: fornecedoresPorAlerta[alerta].map(f => f.cnpj)
      };
      return acc;
    }, {}),
    geradoEm: new Date().toISOString()
  };

  await db.collection('indicesFornecedores').doc('filtros').set(estruturas);
  console.log(`🗂️ Estruturas de filtragem criadas: ${todasCategorias.length} categorias, ${todosDeputados.length} deputados`);
  
  return estruturas;
}

/**
 * Salva metadados expandidos do processamento
 */
async function salvarMetadados(fornecedores, indices) {
  const totalDeputadosUnicos = new Set(fornecedores.flatMap(f => f.deputadosAtendidos)).size;
  const categorias = [...new Set(fornecedores.flatMap(f => f.categorias))];
  
  const metadata = {
    // Estatísticas básicas
    totalFornecedores: fornecedores.length,
    fornecedoresSuspeitos: fornecedores.filter(f => f.indiceSuspeicao >= 50).length,
    fornecedoresCriticos: fornecedores.filter(f => f.indiceSuspeicao >= 80).length,
    fornecedoresNormais: fornecedores.filter(f => f.indiceSuspeicao < 30).length,
    
    // Volumes e transações
    volumeTotal: fornecedores.reduce((sum, f) => sum + f.totalRecebido, 0),
    transacoesTotais: fornecedores.reduce((sum, f) => sum + f.numTransacoes, 0),
    valorMedioFornecedor: fornecedores.reduce((sum, f) => sum + f.totalRecebido, 0) / fornecedores.length,
    deputadosMediosPorFornecedor: fornecedores.reduce((sum, f) => sum + f.deputadosAtendidos.length, 0) / fornecedores.length,
    
    // Análise temporal
    totalDeputadosProcessados: totalDeputadosUnicos,
    anosProcessados: CONFIG.ANOS_PROCESSAMENTO,
    categoriasEncontradas: categorias.length,
    
    // Top performers
    top5FornecedoresPorVolume: fornecedores.slice(0, 5).map(f => ({
      nome: f.nome,
      cnpj: f.cnpj,
      valor: f.totalRecebido,
      score: f.indiceSuspeicao
    })),
    
    top5Suspeitos: fornecedores
      .filter(f => f.indiceSuspeicao >= 50)
      .sort((a, b) => b.indiceSuspeicao - a.indiceSuspeicao)
      .slice(0, 5)
      .map(f => ({
        nome: f.nome,
        cnpj: f.cnpj,
        score: f.indiceSuspeicao,
        valor: f.totalRecebido
      })),
    
    // Metadados técnicos
    processadoEm: new Date().toISOString(),
    ultimaAtualizacao: { seconds: Date.now() / 1000 },
    versaoScript: '2.0',
    configProcessamento: CONFIG
  };

  await db.collection('metadados').doc('fornecedoresProcessamento').set(metadata);
  console.log(`📊 Metadados expandidos salvos:`, {
    totalFornecedores: metadata.totalFornecedores,
    suspeitos: metadata.fornecedoresSuspeitos,
    volume: `R$ ${(metadata.volumeTotal / 1000000).toFixed(1)}M`
  });
}

/**
 * Função principal
 */
async function main() {
  const startTime = Date.now();
  
  console.log('🚀 PROCESSAMENTO DE FORNECEDORES ORGANIZADO');
  console.log('=' .repeat(50));
  console.log(`📅 Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`🔧 Configuração: Anos ${CONFIG.ANOS_PROCESSAMENTO.join(', ')}, Legislatura ${CONFIG.LEGISLATURA_ATUAL}`);
  console.log('');

  try {
    // 1. Processar fornecedores
    const fornecedoresMap = await processarFornecedores();
    
    // 2. Calcular estatísticas finais
    const fornecedores = calcularEstatisticasFinais(fornecedoresMap);
    
    // 3. Criar índices otimizados para a página
    const indices = await criarIndicesOtimizados(fornecedores);
    
    // 4. Criar estruturas de filtragem
    const estruturasFiltragem = await criarEstruturasFiltragem(fornecedores);
    
    // 5. Salvar fornecedores no Firestore
    await salvarFornecedoresFirestore(fornecedores);
    
    // 6. Salvar metadados expandidos
    await salvarMetadados(fornecedores, indices);
    
    const endTime = Date.now();
    const duracao = Math.round((endTime - startTime) / 1000);
    
    console.log('');
    console.log('🎉 PROCESSAMENTO CONCLUÍDO COM SUCESSO!');
    console.log('=' .repeat(50));
    console.log(`⏱️  Duração: ${duracao} segundos`);
    console.log(`📁 Coleções: perfisFornecedores, indicesFornecedores, metadados`);
    console.log(`📊 Fornecedores processados: ${fornecedores.length}`);
    console.log(`🚨 Fornecedores suspeitos: ${fornecedores.filter(f => f.indiceSuspeicao >= 50).length}`);
    console.log(`🔗 Acesse: http://127.0.0.1:5173/gastos/fornecedores`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Erro durante o processamento:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().then(() => {
    console.log('✅ Script finalizado');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Erro fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  processarFornecedores,
  calcularEstatisticasFinais,
  salvarFornecedoresFirestore,
  main
};